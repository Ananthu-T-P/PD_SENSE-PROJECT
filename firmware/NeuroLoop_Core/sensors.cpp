/*
 * ============================================================================
 * sensors.cpp — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * Implementation of everything declared in sensors.h:
 *
 *   SECTION 1  Bring-up, calibration, I2C health (dropout tolerant)
 *   SECTION 2  IMU sampling, tap detection, tremor FFT, gait/freeze FSM
 *   SECTION 3  APDS9960 gesture polling (medication-event recording)
 *
 * Preserved from the validated prototype (do not regress):
 *   - adaptive boot-calibration baseline (calRMS)
 *   - FFT PSD band gating (3-6 Hz / 6-8 Hz), consecutive-window
 *     confirmation, EMA smoothing
 *   - tap detection: moving-average filter, hysteresis edge crossing,
 *     175 ms inter-tap debounce
 *   - gait: Kalman-smoothed gyro, adaptive step threshold, FOG timers
 *
 * Changed in the rebuild:
 *   - gait FSM exposes FREEZE_CANDIDATE and RECOVERY (same validated
 *     timers, now named states) and generates exactly ONE pending freeze
 *     event per episode (with real duration)
 *   - tremor output carries an explicit TremorQuality state; contaminated/
 *     low-signal/invalid windows are states, never fake zeros
 *   - disease-band labels removed (no "PD"/"ET" strings anywhere)
 *   - calibration can FAIL on movement contamination (returns false)
 *   - sampling rate is measured and exported for `test timing`
 * ============================================================================
 */

#include "sensors.h"
#include "config.h"

#include <Wire.h>
#include <esp_task_wdt.h>
#include <AccelAndGyro.h>
#include <LightProximityAndGesture.h>
#include <arduinoFFT.h>
#include <SimpleKalmanFilter.h>

/* ------------------------------------------------------------------ */
/* SECTION 0 — shared objects and module state                         */
/* ------------------------------------------------------------------ */

SensorState gSensor;

static AccelAndGyro imu;              // MYOSA board, I2C 0x69
static LightProximityAndGesture apds; // MYOSA board, I2C 0x39

#define G_CONV 980.0f                 // MYOSA accel lib returns cm/s^2 -> g

/* circular IMU sample buffers (also the FFT window) */
static float axBuf[FFT_SAMPLES], ayBuf[FFT_SAMPLES], azBuf[FFT_SAMPLES];
static uint16_t bufIdx   = 0;
static bool     bufFull  = false;

/* calibration baseline */
static float calAx = 0, calAy = 0, calAz = 0, calGx = 0;

/* measured sample rate bookkeeping */
static unsigned long rateWinStartMs = 0;
static uint32_t      rateWinCount   = 0;

/* gait */
static SimpleKalmanFilter kalmanGyro(2, 2, 0.01);
static float prevGyroFilt = 0, maxGyroWindow = 1.0f;
static long  stepTs[8]; static int stepIdx = 0, stepWin = 0;
static unsigned long cadWinStart = 0, lowCadStart = 0;
static int   fogExitCount = 0;

/* FFT workspace */
static double vReal[FFT_SAMPLES], vImag[FFT_SAMPLES];
static ArduinoFFT<double> FFT(vReal, vImag, FFT_SAMPLES, SAMPLE_RATE_HZ);
static float prevTremorScore = 0;
static int   tremorConf = 0;

/* tap detector */
static float   tapMa[TAP_FILTER_N] = {0};
static int     tapMaIdx = 0;
static bool    tapMaPrimed = false, tapArmed = true;
static long    tapTs[TAP_TARGET_COUNT];
static unsigned long lastTapMs = 0;

/* gesture debounce */
static unsigned long lastGestureMs = 0;

/* health re-check pacing */
static unsigned long lastHealthMs = 0;

const char* gaitPhaseName(GaitPhase p) {
  switch (p) {
    case GAIT_RESTING:          return "REST";
    case GAIT_WALKING:          return "WALK";
    case GAIT_FREEZE_CANDIDATE: return "CAND";
    case GAIT_FREEZE:           return "FREEZE";
    case GAIT_RECOVERY:         return "RECOV";
  }
  return "?";
}

/* wire format name (telemetry/JSON) — distinct from the short OLED name */
static const char* gaitWireName(GaitPhase p) {
  switch (p) {
    case GAIT_RESTING:          return "REST";
    case GAIT_WALKING:          return "WALKING";
    case GAIT_FREEZE_CANDIDATE: return "FREEZE_CANDIDATE";
    case GAIT_FREEZE:           return "FREEZE";
    case GAIT_RECOVERY:         return "RECOVERY";
  }
  return "REST";
}

const char* gestureName(uint8_t code) {
  switch (code) {
    case GESTURE_LEFT:  return "LEFT";
    case GESTURE_RIGHT: return "RIGHT";
    case GESTURE_UP:    return "UP";
    case GESTURE_DOWN:  return "DOWN";
    case GESTURE_NEAR:  return "NEAR";
    case GESTURE_FAR:   return "FAR";
  }
  return "---";
}

const char* tremorQualityName(TremorQuality q) {
  switch (q) {
    case TQ_VALID:               return "VALID";
    case TQ_LOW_SIGNAL:          return "LOW_SIGNAL";
    case TQ_MOTION_CONTAMINATED: return "MOTION_CONTAMINATED";
    case TQ_INVALID:             return "INVALID";
  }
  return "INVALID";
}

/* exposed for the telemetry layer */
const char* gaitWireNamePub(GaitPhase p) { return gaitWireName(p); }

/* ------------------------------------------------------------------ */
/* SECTION 1 — bring-up, calibration, I2C health                       */
/* ------------------------------------------------------------------ */

static bool apdsConfigureGesture() {
  if (!apds.enableGestureSensor(DISABLE)) return false; // also applies LED_BOOST_300
  if (!apds.setGestureGain(GGAIN_4X)) return false;
  if (!apds.setGestureLedDrive(LED_DRIVE_100MA)) return false;
  return true;
}

bool sensorsInit() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(I2C_CLOCK_HZ);
  Wire.setTimeOut(I2C_TIMEOUT_MS);   // a stuck SDA can no longer hang the loop

  gSensor.imuOk = imu.begin(false);

  /* APDS9960: retry begin() with a settling delay — the board is slow to
   * answer right after power-up on the shared bus. A failure here does NOT
   * stop the IMU pipeline; it only disables gestures. */
  gSensor.apdsOk = false;
  gSensor.apdsGestureOn = false;
  for (int attempt = 1; attempt <= APDS_INIT_RETRIES && !gSensor.apdsOk; attempt++) {
    if (attempt > 1) delay(APDS_INIT_DELAY_MS);
    if (apds.begin()) {
      gSensor.apdsOk = true;
      gSensor.apdsGestureOn = apdsConfigureGesture();
    }
  }
  return gSensor.imuOk;   // coordinator decides what "healthy enough" means
}

bool imuPing()  { return imu.ping(); }
bool apdsPing() { return apds.ping(); }

/* Raw readout for the diagnostic console (PASS/FAIL evidence). */
void imuReadRaw(float& ax, float& ay, float& az, float& gx, float& gy, float& gz) {
  ax = imu.getAccelX(false) / G_CONV;
  ay = imu.getAccelY(false) / G_CONV;
  az = imu.getAccelZ(false) / G_CONV;
  gx = imu.getGyroX(false);
  gy = 0;   // MYOSA lib getGyroY() has a scale bug — documented, not used
  gz = 0;
}

/* Adaptive calibration: mean offsets + resting RMS while the device is held
 * still. Movement above CAL_MOVE_LIMIT_MULT x running baseline FAILS the
 * calibration (returns false) so the caller can show CALIBRATION FAILED /
 * MOVE DETECTED instead of proceeding on garbage thresholds. */
bool imuCalibrate(CalProgressFn cb) {
  if (!gSensor.imuOk) return false;

  /* 700 samples x 10 ms = 7 s: 5 s offset capture + 2 s baseline RMS */
  float sx = 0, sy = 0, sz = 0, sg = 0;
  for (int i = 0; i < 500; i++) {
    sx += imu.getAccelX(false); sy += imu.getAccelY(false); sz += imu.getAccelZ(false);
    sg += imu.getGyroX(false);
    if (cb && (i % 50 == 0)) cb((int)((700 - i) + 99) / 100);
    delay(10);
    esp_task_wdt_reset();
  }
  calAx = sx / 500.0f; calAy = sy / 500.0f; calAz = sz / 500.0f; calGx = sg / 500.0f;

  double rsum = 0;
  bool moved = false;
  float runningMaxRms = 0;
  for (int i = 0; i < 200; i++) {
    float ax = (imu.getAccelX(false) - calAx) / G_CONV;
    float ay = (imu.getAccelY(false) - calAy) / G_CONV;
    float az = (imu.getAccelZ(false) - calAz) / G_CONV;
    float r = sqrtf(ax * ax + ay * ay + az * az);
    rsum += (double)r * r;
    if (cb && (i % 50 == 0)) cb((int)((200 - i) + 99) / 100);
    if (i > 20) {   // let the baseline establish, then watch for contamination
      float baseline = sqrtf((float)(rsum / (double)(i + 1)));
      if (baseline > 0.01f && r > baseline * CAL_MOVE_LIMIT_MULT) moved = true;
      if (r > runningMaxRms) runningMaxRms = r;
    }
    delay(10);
    esp_task_wdt_reset();
  }
  if (moved) {
    Serial.printf("ERR  calibration contaminated (peak RMS %.3f g)\r\n", runningMaxRms);
    return false;
  }

  gSensor.calRMS = sqrtf((float)(rsum / 200.0));
  if (gSensor.calRMS < 0.01f) gSensor.calRMS = 0.01f;   // floor: never trigger on ~0

  Serial.printf("CAL  calRMS=%.4f g  tapHi=%.3f g\r\n",
                gSensor.calRMS, gSensor.calRMS * TAP_THRESHOLD_MULT);
  return true;
}

/* Periodic disconnect detection. A dropped sensor degrades to a visible
 * error state and a re-init attempt — the main loop never blocks here,
 * and one sensor's failure never takes the other down. */
void sensorsHealthTick() {
  unsigned long now = millis();
  if (now - lastHealthMs < SENSOR_HEALTH_MS) return;
  lastHealthMs = now;

  static uint8_t imuMiss = 0, apdsMiss = 0;

  if (imu.ping()) { imuMiss = 0; gSensor.imuOk = true; }
  else if (++imuMiss >= 2 && gSensor.imuOk) {
    gSensor.imuOk = false;
    gSensor.imuSampling = false;
    Serial.println("ERR  MPU6050 dropped off I2C");
  }

  bool apdsAlive = apds.ping();
  if (apdsAlive) {
    apdsMiss = 0;
    if (!gSensor.apdsGestureOn) gSensor.apdsGestureOn = apdsConfigureGesture();
    gSensor.apdsOk = true;
  } else if (++apdsMiss >= 2) {
    if (gSensor.apdsOk) Serial.println("ERR  APDS9960 dropped off I2C");
    gSensor.apdsOk = false;
    gSensor.apdsGestureOn = false;
    if (apds.begin()) {   // one immediate full re-init for fast recovery
      gSensor.apdsOk = true;
      gSensor.apdsGestureOn = apdsConfigureGesture();
      if (gSensor.apdsGestureOn) Serial.println("OK   APDS9960 recovered");
    }
  }
}

/* ------------------------------------------------------------------ */
/* SECTION 2 — IMU sampling, tap, tremor FFT, gait                     */
/* ------------------------------------------------------------------ */

void imuSetActive(bool on) {
  gSensor.imuSampling = on && gSensor.imuOk;
  if (on) { bufIdx = 0; bufFull = false; prevGyroFilt = 0; }
}

void imuSampleTick() {
  if (!gSensor.imuSampling || !gSensor.imuOk) return;
  static unsigned long lastUs = 0;
  unsigned long us = micros();
  if (us - lastUs < (unsigned long)(1000000.0f / SAMPLE_RATE_HZ)) return;
  lastUs = us;

  float ax = (imu.getAccelX(false) - calAx) / G_CONV;
  float ay = (imu.getAccelY(false) - calAy) / G_CONV;
  float az = (imu.getAccelZ(false) - calAz) / G_CONV;
  float gx =  imu.getGyroX(false) - calGx;

  /* sanity gate: reject impossible spikes (I2C glitch) — sample dropped,
     never recorded as a zero */
  if (fabsf(ax) > 8 || fabsf(ay) > 8 || fabsf(az) > 8 || fabsf(gx) > 500) return;

  /* measured sample rate (1 s windows) + period stats for `test timing` */
  gSensor.sampleCountTotal++;
  rateWinCount++;
  if (millis() - rateWinStartMs >= 1000) {
    gSensor.sampleRateHz = (float)rateWinCount * 1000.0f / (float)(millis() - rateWinStartMs);
    rateWinCount  = 0;
    rateWinStartMs = millis();
  }
  {
    static unsigned long prevSampleUs = 0;
    if (prevSampleUs) {
      uint32_t dt = us - prevSampleUs;
      if (dt < gSensor.timingMinUs) gSensor.timingMinUs = dt;
      if (dt > gSensor.timingMaxUs) gSensor.timingMaxUs = dt;
      gSensor.timingSumUs  += dt;
      gSensor.timingSumSqUs += (double)dt * dt;
      gSensor.timingN++;
    }
    prevSampleUs = us;
  }

  /* jerk: d|a|/dt for the experimental impact/fall-candidate heuristic */
  {
    float mag = sqrtf(ax * ax + ay * ay + az * az);
    static float prevMag = 0;
    gSensor.jerkNow = fabsf(mag - prevMag) * SAMPLE_RATE_HZ;
    prevMag = mag;
    gSensor.jerkPeak = max(gSensor.jerkPeak * 0.98f, gSensor.jerkNow);
  }

  axBuf[bufIdx] = ax; ayBuf[bufIdx] = ay; azBuf[bufIdx] = az;
  bufIdx++;
  if (bufIdx >= FFT_SAMPLES) { bufIdx = 0; bufFull = true; }

  /* short-window RMS (last 50 samples) */
  double sum = 0;
  for (int i = 0; i < 50; i++) {
    int k = (bufIdx - 1 - i + FFT_SAMPLES) % FFT_SAMPLES;
    sum += axBuf[k] * axBuf[k] + ayBuf[k] * ayBuf[k] + azBuf[k] * azBuf[k];
  }
  gSensor.imuRMS = sqrtf((float)(sum / 50.0));
  gSensor.movingNow = (gSensor.imuRMS > gSensor.calRMS * 1.5f);

  /* gyro channel for gait: Kalman-smoothed, adaptive peak reference */
  maxGyroWindow = max(maxGyroWindow * 0.99f, fabsf(gx));
  if (maxGyroWindow < 1.0f) maxGyroWindow = 1.0f;
  float gyFilt = kalmanGyro.updateEstimate(gx);

  /* step = falling edge through the adaptive threshold while moving */
  float stepThr = constrain(0.6f * maxGyroWindow, 0.3f, 100.0f);
  if ((gSensor.gaitPhase == GAIT_WALKING || gSensor.gaitPhase == GAIT_FREEZE_CANDIDATE ||
       gSensor.gaitPhase == GAIT_RECOVERY) &&
      prevGyroFilt > stepThr && gyFilt <= stepThr) {
    stepTs[stepIdx % 8] = millis(); stepIdx++; stepWin++;
  }
  prevGyroFilt = gyFilt;
}

/* --- tap test -------------------------------------------------------*/
void tapReset() {
  gSensor.tapCount  = 0;
  gSensor.tapSignal = 0;
  gSensor.tapStartMs = millis();
  gSensor.tapEndMs   = 0;
  memset(tapMa, 0, sizeof(tapMa));
  tapMaIdx = 0; tapMaPrimed = false; tapArmed = true;
  lastTapMs = 0;
  memset(tapTs, 0, sizeof(tapTs));
}

/* One call per loop iteration. Returns true exactly once per valid tap.
 * Signal: z-axis deviation from the calibration baseline, lightly
 * moving-averaged. A tap counts only on a rising crossing of the upper
 * threshold while armed; the detector re-arms only after the signal falls
 * back below the lower (hysteresis) threshold AND the debounce window has
 * passed — mechanical bounce cannot double-count. */
bool tapTick() {
  if (!gSensor.imuSampling || !gSensor.imuOk) return false;

  int k = (bufIdx - 1 + FFT_SAMPLES) % FFT_SAMPLES;
  float azDev = azBuf[k];

  tapMa[tapMaIdx] = azDev;
  tapMaIdx = (tapMaIdx + 1) % TAP_FILTER_N;
  if (tapMaIdx == 0) tapMaPrimed = true;
  float filt = 0;
  int n = tapMaPrimed ? TAP_FILTER_N : (tapMaIdx == 0 ? TAP_FILTER_N : tapMaIdx);
  if (n == 0) return false;
  for (int i = 0; i < n; i++) filt += tapMa[i];
  filt /= n;
  gSensor.tapSignal = filt;

  const float hi = gSensor.calRMS * TAP_THRESHOLD_MULT;
  const float lo = hi * TAP_HYSTERESIS;
  const unsigned long now = millis();

  if (!tapArmed) {
    if (fabsf(filt) < lo) tapArmed = true;
    return false;
  }
  if (fabsf(filt) >= hi && (now - lastTapMs) >= TAP_DEBOUNCE_MS) {
    tapArmed    = false;
    lastTapMs   = now;
    if (gSensor.tapCount < TAP_TARGET_COUNT) {
      tapTs[gSensor.tapCount] = (long)now;
      gSensor.tapCount++;
      if (gSensor.tapCount >= TAP_TARGET_COUNT) gSensor.tapEndMs = now;
      return true;
    }
  }
  return false;
}

/* Bradykinesia grade from inter-tap-interval mean/variance (0–4).
 * An INCOMPLETE test returns -1 — never a fabricated grade. */
int tapScoreBK(char* labelBuf, size_t labelLen) {
  if (gSensor.tapCount < (uint16_t)TAP_TARGET_COUNT) {
    if (labelBuf) snprintf(labelBuf, labelLen, "INCOMPLETE");
    return -1;
  }
  float iti[TAP_TARGET_COUNT - 1], mean = 0;
  for (int i = 0; i < TAP_TARGET_COUNT - 1; i++) {
    iti[i] = (tapTs[i + 1] - tapTs[i]) / 1000.0f;
    mean += iti[i];
  }
  mean /= (TAP_TARGET_COUNT - 1);
  float var = 0;
  for (int i = 0; i < TAP_TARGET_COUNT - 1; i++) var += (iti[i] - mean) * (iti[i] - mean);
  float cov = sqrtf(var / (TAP_TARGET_COUNT - 1)) / mean;

  int grade;
  if      (mean < 0.45f && cov < 0.15f) grade = 0;
  else if (mean < 0.55f || cov < 0.25f) grade = 1;
  else if (mean < 0.70f || cov < 0.35f) grade = 2;
  else if (mean < 0.90f)                grade = 3;
  else                                  grade = 4;

  static const char* LABELS[] = {"Normal", "Slight", "Mild", "Moderate", "Severe"};
  if (labelBuf) snprintf(labelBuf, labelLen, "%s", LABELS[grade]);
  return grade;
}

/* --- tremor FFT ------------------------------------------------------*/
void tremorReset() {
  bufIdx = 0; bufFull = false;
  tremorConf = 0; prevTremorScore = 0;
  gSensor.tremorValid  = false;
  gSensor.tremorScore  = 0;
  gSensor.tremorFreq   = 0;
  gSensor.tremorQuality = TQ_INVALID;
}

bool tremorWindowReady() {
  if (!bufFull) return false;
  bufFull = false;   // consume the flag; buffer keeps circular-filling
  return true;
}

/* One 256-sample window -> tremor-band activity score.
 * Carried forward in substance from the validated prototype: PSD band
 * gating (3-6 Hz / 6-8 Hz), 3-consecutive-window confirmation, EMA
 * smoothing. The rebuild change: every window lands in an explicit
 * TremorQuality state instead of silently decaying toward zero. */
void tremorCompute() {
  gSensor.tremorWindowSeq++;
  if (!gSensor.imuOk) {
    gSensor.tremorValid   = false;
    gSensor.tremorQuality = TQ_INVALID;
    return;
  }

  if (gSensor.imuRMS > gSensor.calRMS * 1.8f) {
    tremorConf = 0;
    gSensor.tremorValid   = false;
    gSensor.tremorQuality = TQ_MOTION_CONTAMINATED;
    gSensor.tremorScore  *= 0.95f;   // decay display value, flagged as such
    return;
  }

  double mean = 0;
  for (int i = 0; i < FFT_SAMPLES; i++) {
    vReal[i] = sqrt(axBuf[i] * axBuf[i] + ayBuf[i] * ayBuf[i] + azBuf[i] * azBuf[i]);
    mean += vReal[i];
  }
  mean /= FFT_SAMPLES;
  for (int i = 0; i < FFT_SAMPLES; i++) { vReal[i] -= mean; vImag[i] = 0; }

  FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
  FFT.compute(FFTDirection::Forward);
  FFT.complexToMagnitude();

  double psdTotal = 0, psdBandA = 0, psdBandB = 0, domPsd = 0;
  int domBin = 0;
  for (int k = 1; k < FFT_SAMPLES / 2; k++) {
    double p = (vReal[k] * vReal[k]) / FFT_SAMPLES;
    float freq = k * (SAMPLE_RATE_HZ / FFT_SAMPLES);
    psdTotal += p;
    if (freq >= 3.0f && freq <= 6.0f) psdBandA += p;   // lower tremor band
    if (freq >  6.0f && freq <= 8.0f) psdBandB += p;   // upper tremor band
    if (p > domPsd) { domPsd = p; domBin = k; }
  }

  if (psdTotal < 0.0001) {
    gSensor.tremorValid   = false;
    gSensor.tremorQuality = TQ_LOW_SIGNAL;   // real state: almost no movement power
    return;
  }

  gSensor.tremorFreq = domBin * (SAMPLE_RATE_HZ / FFT_SAMPLES);

  float rawA  = min(10.0f, (float)((psdBandA / psdTotal) * 80.0));
  float rawB  = min(10.0f, (float)((psdBandB / psdTotal) * 80.0));
  float raw   = max(rawA, rawB);

  if (raw > 1.0f) tremorConf++; else tremorConf = 0;

  if (tremorConf >= 3) {                          // 3 consecutive gated windows
    prevTremorScore = 0.4f * raw + 0.6f * prevTremorScore;
    gSensor.tremorScore  = prevTremorScore;
    gSensor.tremorValid  = true;
    gSensor.tremorQuality = TQ_VALID;
  } else {
    gSensor.tremorValid  = false;
    gSensor.tremorScore  = prevTremorScore *= 0.95f;
    gSensor.tremorQuality = TQ_LOW_SIGNAL;   // below confirmation gate
  }
}

/* --- gait / freeze-of-gait -------------------------------------------*/
void gaitReset() {
  gSensor.gaitPhase = GAIT_RESTING;
  gSensor.cadence = 0;
  gSensor.freezeActive = false;
  gSensor.freezeStartMs = 0;
  gSensor.lastFreezeDurationMs = 0;
  gSensor.freezeEventPending = false;
  stepIdx = 0; stepWin = 0;
  cadWinStart = millis(); lowCadStart = 0; fogExitCount = 0;
  maxGyroWindow = 1.0f;
}

/* Gait FSM — the validated REST/WALK/FREEZE timers from the prototype,
 * now exposing the in-between states the timers were already measuring:
 *
 *   REST ──RMS>walk──► WALK ──cadence<thr for FOG_CONFIRM_MS──► FREEZE
 *                          │(during the confirm window)
 *                          └──► FREEZE_CANDIDATE ──cadence recovers──► WALK
 *
 *   FREEZE ──cadence>exit for 1st window──► RECOVERY ──N windows──► WALK
 *            (during recovery a re-collapse returns to FREEZE and the
 *             episode continues — one physical episode = one event)
 *
 * Exactly ONE freeze event is armed per episode: onset latches
 * freezeActive + freezeStartMs; final exit publishes
 * lastFreezeDurationMs + freezeEventPending (read-and-clear).        */
void gaitTick() {
  if (!gSensor.imuOk) return;
  const unsigned long now = millis();

  /* cadence window: steps/second over a rolling 4 s window */
  if (now - cadWinStart >= 4000) {
    gSensor.cadence = stepWin / 4.0f;
    stepWin = 0;
    cadWinStart = now;
  }

  const float walkThr = gSensor.calRMS * 2.0f;
  const float restThr = gSensor.calRMS * 1.5f;

  switch (gSensor.gaitPhase) {
    case GAIT_RESTING:
    case GAIT_WALKING:
      if (gSensor.imuRMS > walkThr)      gSensor.gaitPhase = GAIT_WALKING;
      else if (gSensor.imuRMS < restThr) gSensor.gaitPhase = GAIT_RESTING;

      if (gSensor.gaitPhase == GAIT_WALKING && gSensor.cadence < FOG_CADENCE_HZ) {
        /* collapse began — enter candidate while the confirmation window runs */
        if (!lowCadStart) lowCadStart = now;
        gSensor.gaitPhase = GAIT_FREEZE_CANDIDATE;
      } else if (gSensor.gaitPhase == GAIT_WALKING) {
        lowCadStart = 0;
      }
      break;

    case GAIT_FREEZE_CANDIDATE:
      if (gSensor.cadence >= FOG_CADENCE_HZ || gSensor.imuRMS > walkThr) {
        gSensor.gaitPhase = GAIT_WALKING;   // noisy sample rejected
        lowCadStart = 0;
      } else if (now - lowCadStart > FOG_CONFIRM_MS) {
        gSensor.gaitPhase     = GAIT_FREEZE;
        gSensor.freezeActive  = true;
        gSensor.freezeStartMs = now;
        fogExitCount = 0;
        Serial.println("EVT  freeze onset (candidate confirmed)");
      }
      break;

    case GAIT_FREEZE:
      if (gSensor.cadence > FOG_EXIT_CADENCE_HZ) {
        gSensor.gaitPhase = GAIT_RECOVERY;
        fogExitCount = 1;
      }
      break;

    case GAIT_RECOVERY:
      if (gSensor.cadence > FOG_EXIT_CADENCE_HZ) {
        if (++fogExitCount >= FOG_EXIT_WINDOWS) {
          /* episode over — publish ONE event with the real duration */
          gSensor.gaitPhase = GAIT_WALKING;
          gSensor.freezeActive = false;
          gSensor.lastFreezeDurationMs = now - gSensor.freezeStartMs;
          gSensor.freezeEventPending = true;
          fogExitCount = 0;
          Serial.printf("EVT  freeze resolved after %lu ms\r\n",
                        (unsigned long)gSensor.lastFreezeDurationMs);
        }
      } else {
        /* re-collapse during recovery: continue the same episode */
        gSensor.gaitPhase = GAIT_FREEZE;
        fogExitCount = 0;
      }
      break;
  }
}

/* ------------------------------------------------------------------ */
/* SECTION 3 — APDS9960 gesture polling                                */
/* ------------------------------------------------------------------ */

/* Non-blocking from the caller's point of view: isGestureAvailable() is
 * checked first, so with no hand moving this costs one I2C register read.
 * A debounce window makes one physical swipe register exactly once.
 * This is a SENSOR DIAGNOSTIC source — a gesture here is raw information;
 * the coordinator alone decides which gesture maps to a medication event. */
void timingStatsReset() {
  gSensor.timingMinUs = 0xFFFFFFFF;
  gSensor.timingMaxUs = 0;
  gSensor.timingSumUs = 0.0;
  gSensor.timingSumSqUs = 0.0;
  gSensor.timingN = 0;
}

GestureCode gesturePoll() {
  if (!gSensor.apdsOk || !gSensor.apdsGestureOn) return GESTURE_NONE;

  const unsigned long now = millis();
  static unsigned long lastPollMs = 0;
  if (now - lastPollMs < GESTURE_POLL_MS) return GESTURE_NONE;
  lastPollMs = now;
  if (now - lastGestureMs < GESTURE_DEBOUNCE_MS) return GESTURE_NONE;

  char* g = apds.getGesture(false);   // returns "NONE" instantly when idle

  /* TIMEOUT = hand lingered but no clean swipe decoded; soft-reset the
   * engine if it keeps stalling (decode state machine can stick). */
  static uint8_t stuckTimeouts = 0;
  if (strcmp(g, "TIMEOUT") == 0) {
    lastGestureMs = now;
    if (++stuckTimeouts >= 4) {
      stuckTimeouts = 0;
      apds.enableGestureSensor(DISABLE);
      apds.setGestureGain(GGAIN_4X);
      apds.setGestureLedDrive(LED_DRIVE_100MA);
      Serial.println("EVT  gesture engine reset (was stalling on timeouts)");
    }
    return GESTURE_NONE;
  }

  GestureCode code = GESTURE_NONE;
  if      (strcmp(g, "LEFT")  == 0) code = GESTURE_LEFT;
  else if (strcmp(g, "RIGHT") == 0) code = GESTURE_RIGHT;
  else if (strcmp(g, "UP")    == 0) code = GESTURE_UP;
  else if (strcmp(g, "DOWN")  == 0) code = GESTURE_DOWN;
  else if (strcmp(g, "NEAR")  == 0) code = GESTURE_NEAR;
  else if (strcmp(g, "FAR")   == 0) code = GESTURE_FAR;

  if (code != GESTURE_NONE) { lastGestureMs = now; stuckTimeouts = 0; }
  return code;
}
