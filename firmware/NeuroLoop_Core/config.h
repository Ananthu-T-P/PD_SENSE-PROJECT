/*
 * ============================================================================
 * config.h — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * Single source of truth for pin assignments and all tunable runtime
 * constants, including the telemetry layer.
 *
 * SECURITY MODEL (final architecture):
 *   This file must never contain a Supabase service/anon key. The device
 *   authenticates to the PD-SENSE backend with DEVICE_ID + DEVICE_TOKEN
 *   only. Wifi credentials live here as PLACEHOLDERS — put real values in
 *   before flashing and do not commit them (see docs/SECURITY.md).
 *
 * Hardware: MYOSA motherboard (ESP32) + MPU6050 (0x69), APDS9960 (0x39),
 *           SSD1306 OLED (0x3C), buzzer + haptic actuator on GPIO.
 * ============================================================================
 */

#ifndef NEUROLOOP_CONFIG_H
#define NEUROLOOP_CONFIG_H

/* ------------------------------------------------------------------------ */
/* Device identity                                                           */
/* ------------------------------------------------------------------------ */
#define DEVICE_NAME          "PD-SENSE"
#define FW_VERSION           "7.0-rebuild"

/* ------------------------------------------------------------------------ */
/* Pin map                                                                   */
/* ------------------------------------------------------------------------ */
#define PIN_BUZZER           25      // ACTIVE buzzer (built-in oscillator): on/off
#define PIN_HAPTIC           26      // haptic actuator, toggled with RAS pulse
#define PIN_I2C_SDA          21
#define PIN_I2C_SCL          22

/* I2C device addresses (verified by `test i2c` on the bench) */
#define I2C_ADDR_MPU6050     0x69
#define I2C_ADDR_APDS9960    0x39
#define I2C_ADDR_OLED        0x3C

/* ------------------------------------------------------------------------ */
/* IMU sampling / FFT                                                        */
/* ------------------------------------------------------------------------ */
#define SAMPLE_RATE_HZ       100.0f  // MPU6050 sample rate
#define FFT_SAMPLES          256     // FFT window (2.56 s per window at 100 Hz)

/* ------------------------------------------------------------------------ */
/* Tremor classification (band activity; NOT a disease diagnosis)            */
/* ------------------------------------------------------------------------ */
#define TREMOR_CRITICAL      9.5f    // score >= this triggers the local alert cue
#define TREMOR_RETRIGGER_MS  5000    // min gap between repeated local alerts

/* ------------------------------------------------------------------------ */
/* Gait / freezing-of-gait                                                   */
/* ------------------------------------------------------------------------ */
#define FOG_CADENCE_HZ       0.5f    // cadence below this while walking = candidate
#define FOG_CONFIRM_MS       2000    // candidate must persist this long -> FREEZE
#define FOG_EXIT_CADENCE_HZ  1.0f    // cadence above this starts recovery
#define FOG_EXIT_WINDOWS     3       // consecutive windows in recovery -> exit

/* ------------------------------------------------------------------------ */
/* Tap test (bradykinesia)                                                   */
/* ------------------------------------------------------------------------ */
#define TAP_TARGET_COUNT     20
#define TAP_DEBOUNCE_MS      175
#define TAP_THRESHOLD_MULT   1.8f
#define TAP_HYSTERESIS       0.6f
#define TAP_FILTER_N         4
#define TAP_TEST_TIMEOUT_MS  30000
#define TEST_RESET_DELAY_MS  3000

/* ------------------------------------------------------------------------ */
/* Serial                                                                    */
/* ------------------------------------------------------------------------ */
#define SERIAL_BAUD          115200
#define SERIAL_STATUS_MS     1000    // throttled one-line status (human reader)
#define SERIAL_LINE_MAX      64      // command line buffer

/* ------------------------------------------------------------------------ */
/* Display                                                                   */
/* ------------------------------------------------------------------------ */
#define DISPLAY_REFRESH_MS   250     // OLED repaint cadence (independent of serial)
#define EVENT_OVERLAY_MS     2500    // event overlay hold time

/* ------------------------------------------------------------------------ */
/* APDS9960 gesture (medication-event recording)                             */
/* ------------------------------------------------------------------------ */
#define APDS_INIT_RETRIES    4
#define APDS_INIT_DELAY_MS   250
#define GESTURE_POLL_MS      200
#define GESTURE_DEBOUNCE_MS  1500
/* Only this gesture records a medication event. Everything else is ignored.
 * Valid values: LEFT RIGHT UP DOWN NEAR FAR                              */
#define MED_EVENT_GESTURE    GESTURE_DOWN
#define MED_EVENT_COOLDOWN_MS 30000  // duplicate protection for medication events

/* ------------------------------------------------------------------------ */
/* Buzzer / RAS cueing                                                       */
/* ------------------------------------------------------------------------ */
#define RAS_CADENCE_HZ       1.0f
#define RAS_MAX_MS           10000
#define TAP_CLICK_MS         30
#define ALERT_BEEP_MS        120

/* ------------------------------------------------------------------------ */
/* I2C robustness                                                            */
/* ------------------------------------------------------------------------ */
#define I2C_CLOCK_HZ         100000
#define I2C_TIMEOUT_MS       50
#define SENSOR_HEALTH_MS     5000

/* ------------------------------------------------------------------------ */
/* Watchdog (IDF v5 API)                                                     */
/* ------------------------------------------------------------------------ */
#define WDT_TIMEOUT_S        10

/* ------------------------------------------------------------------------ */
/* Calibration                                                               */
/* ------------------------------------------------------------------------ */
#define CAL_COUNTDOWN_S      5
#define CAL_MOVE_LIMIT_MULT  3.0f    // RMS above baseline*this during cal -> MOVE DETECTED

/* ------------------------------------------------------------------------ */
/* TELEMETRY — ESP32 -> PD-SENSE backend API -> Supabase                     */
/* ------------------------------------------------------------------------ */
#define TELEMETRY_ENABLED       1    // set 0 to compile the layer out completely

/* TODO(setup): fill in before flashing. Never commit real credentials. */
#define WIFI_SSID               "YOUR_WIFI_SSID"
#define WIFI_PASS               "YOUR_WIFI_PASSWORD"

#define API_BASE_URL            "http://192.168.1.XXX:3000"   // <-- your laptop LAN IP
#define DEVICE_ID               "pd-sense-01"
#define DEVICE_TOKEN            "PASTE_DEVICE_TOKEN_HERE"     // MUST match DEVICE_SEED token above

#define ALLOW_INSECURE_TLS      0    // 0 = require valid TLS on https URLs
                                     // (see docs/SECURITY.md — TLS on LAN caveat)

/* Root CA PEM for https backends (e.g. ISRG Root X1 for Let's Encrypt).
 * Empty on a plain-HTTP LAN backend. If https is used with no CA set,
 * telemetry refuses the connection loudly instead of skipping validation. */
#define API_ROOT_CA_PEM         ""

#define UPLOAD_INTERVAL_MS      15000   // one summarized telemetry packet / 15 s
#define HTTP_TIMEOUT_MS         5000

/* Bounded FIFO queues (static RAM, no heap churn) */
#define TLM_QUEUE_LEN           12    // telemetry packets  (12 x 15 s = 3 min)
#define EVT_QUEUE_LEN           8     // discrete events
#define TLM_PACKET_MAX          420   // bytes per serialized packet
#define EVT_PACKET_MAX          560

/* Retry/backoff for queued uploads (never blocks the sensor loop) */
#define TLM_RETRY_BASE_MS       5000
#define TLM_RETRY_MAX_MS        60000

/* WiFi reconnect pacing (paced FSM — never disconnect/begin in a tight loop) */
#define WIFI_CHECK_MS           5000
#define WIFI_RECONNECT_GAP_MS   20000

/* NTP: device timestamps are UTC when synced; device_ms is always sent and
 * backend received_at remains the authoritative ingest clock. */
#define NTP_SERVER              "pool.ntp.org"
#define NTP_SYNC_INTERVAL_MS    3600000UL

/* ------------------------------------------------------------------------ */
/* Alert thresholds evaluated on-device for LOCAL cues and events.           */
/* Persisted cloud alerts are owned by the backend (docs/ALERTS.md).         */
/* ------------------------------------------------------------------------ */
#define FREEZE_EVENT_MIN_MS     1000   // ignore freeze blips shorter than this
#define FALL_JERK_THRESHOLD     3.0f   // g/s (PLACEHOLDER — calibrate on hardware!)
#define STILL_AFTER_FALL_MS     3000
#define HIGH_TREMOR_SCORE       6.5f   // used to tag telemetry quality notes only

/* ------------------------------------------------------------------------ */
/* Development diagnostics (sensor simulation)                               */
/* Normal patient operation is ALWAYS real-sensor driven. Simulation exists  */
/* only when compiled with ENABLE_DEV_DIAGNOSTICS 1 and is then reachable    */
/* only via `dev ...` serial commands, clearly tagged source=dev.            */
/* ------------------------------------------------------------------------ */
#define ENABLE_DEV_DIAGNOSTICS  0

#endif // NEUROLOOP_CONFIG_H
