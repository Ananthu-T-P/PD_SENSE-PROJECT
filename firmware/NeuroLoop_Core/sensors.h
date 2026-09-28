/*
 * ============================================================================
 * sensors.h — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * Owns all physical sensor interaction:
 *   - MPU6050 (100 Hz sampling, FFT tremor band analysis, tap detection,
 *     gait/cadence + freezing-of-gait state machine)
 *   - APDS9960 (gesture -> medication-event recording)
 *
 * Nothing in here knows about display, buzzer, serial commands, networking
 * or the application coordinator — it only fills the SensorState struct
 * below, which everything else reads from.
 *
 * Preserved from the validated prototype (do not regress):
 *   - adaptive boot-calibration baseline (calRMS) instead of fixed thresholds
 *   - FFT PSD band gating for tremor-band activity
 *   - tap hysteresis + debounce edge detection
 *   - Kalman-filtered gyro cadence estimation
 * ============================================================================
 */

#ifndef NEUROLOOP_SENSORS_H
#define NEUROLOOP_SENSORS_H

#include <Arduino.h>

/* Gesture codes returned by gesturePoll() (0 = nothing) */
enum GestureCode : uint8_t {
  GESTURE_NONE  = 0,
  GESTURE_LEFT  = 1,
  GESTURE_RIGHT = 2,
  GESTURE_UP    = 3,
  GESTURE_DOWN  = 4,
  GESTURE_NEAR  = 5,
  GESTURE_FAR   = 6
};

/* Gait state machine.
 * FREEZE_CANDIDATE: walking history but cadence has collapsed; waiting out
 *                   the FOG_CONFIRM_MS confirmation window.
 * RECOVERY: cadence is recovering; waiting out FOG_EXIT_WINDOWS windows
 *           before declaring the episode over. */
enum GaitPhase : uint8_t {
  GAIT_RESTING           = 0,
  GAIT_WALKING           = 1,
  GAIT_FREEZE_CANDIDATE  = 2,
  GAIT_FREEZE            = 3,
  GAIT_RECOVERY          = 4
};

/* Tremor measurement quality. Drives both OLED and telemetry: invalid or
 * contaminated windows are a STATE, never silently a zero score. */
enum TremorQuality : uint8_t {
  TQ_INVALID              = 0,   // IMU fault / never computed
  TQ_VALID                = 1,   // clean window, stable estimate
  TQ_LOW_SIGNAL           = 2,   // window processed but almost no power
  TQ_MOTION_CONTAMINATED  = 3    // gross body movement dominates the window
};

/*
 * All live sensor-derived values in one place.
 * Read-only for the rest of the firmware.
 */
struct SensorState {
  /* health */
  bool     imuOk        = false;
  bool     apdsOk       = false;
  bool     apdsGestureOn = false;

  /* IMU instant values (g / deg/s) */
  bool     imuSampling  = false;
  float    imuRMS       = 0.0f;   // short-window RMS of calibrated accel, in g
  float    calRMS       = 0.01f;  // adaptive baseline captured at calibration

  /* sampling integrity (measured, for `test timing`) */
  float    sampleRateHz = 0.0f;   // measured actual rate over the last second
  unsigned long sampleCountTotal = 0;
  uint32_t timingMinUs = 0xFFFFFFFF;   // accepted-sample period stats
  uint32_t timingMaxUs = 0;
  double   timingSumUs  = 0.0;
  double   timingSumSqUs = 0.0;
  uint32_t timingN = 0;

  /* tap test */
  float    tapSignal    = 0.0f;
  uint16_t tapCount     = 0;
  unsigned long tapStartMs = 0;   // set by tapReset()
  unsigned long tapEndMs   = 0;   // set when target reached

  /* gait */
  GaitPhase gaitPhase   = GAIT_RESTING;
  float    cadence      = 0.0f;   // steps per second over a rolling window
  bool     freezeActive = false;
  unsigned long freezeStartMs = 0;
  unsigned long lastFreezeDurationMs = 0;  // valid once, read-and-clear by events layer
  bool     freezeEventPending = false;

  /* impact / fall candidate (explicitly experimental) */
  float    jerkNow      = 0.0f;   // g/s, |derivative of accel magnitude|
  float    jerkPeak     = 0.0f;   // decaying peak
  bool     movingNow    = false;

  /* tremor (updated once per FFT window) */
  bool          tremorValid  = false;
  float         tremorScore  = 0.0f;
  float         tremorFreq   = 0.0f;
  TremorQuality tremorQuality = TQ_INVALID;
  uint32_t      tremorWindowSeq = 0;   // increments once per computed window
};

extern SensorState gSensor;

/* --- bring-up ------------------------------------------------------------ */
bool sensorsInit();        // init I2C + MPU6050 + APDS9960 (APDS with retries)
typedef void (*CalProgressFn)(int secondsLeft);   // calibration countdown hook
bool imuCalibrate(CalProgressFn cb = nullptr);    // false if movement contaminated it
void timingStatsReset();
void sensorsHealthTick();  // periodic re-ping / disconnect detection, non-blocking

/* --- IMU sampling --------------------------------------------------------- */
void imuSetActive(bool on);
void imuSampleTick();      // call every loop(); self-paced at SAMPLE_RATE_HZ

/* --- diagnostics ---------------------------------------------------------- */
bool imuPing();            // single I2C ping
bool apdsPing();
void imuReadRaw(float& ax, float& ay, float& az, float& gx, float& gy, float& gz);

/* --- tap detection ---------------------------------------------------------*/
void tapReset();
bool tapTick();            // true exactly once per valid tap
int  tapScoreBK(char* labelBuf, size_t labelLen); // grade 0-4, -1 = incomplete

/* --- tremor FFT ------------------------------------------------------------*/
void tremorReset();
bool tremorWindowReady();
void tremorCompute();

/* --- gait -------------------------------------------------------------------*/
void gaitReset();
void gaitTick();

/* --- APDS9960 gesture --------------------------------------------------------*/
GestureCode gesturePoll();

/* --- helpers ------------------------------------------------------------------*/
const char* gaitPhaseName(GaitPhase p);
const char* gestureName(uint8_t code);
const char* tremorQualityName(TremorQuality q);
const char* gaitWireNamePub(GaitPhase p);   // wire-format name ("WALKING", used by telemetry)

#endif // NEUROLOOP_SENSORS_H
