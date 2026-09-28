# PD-SENSE / NeuroLoop — Firmware

**Current target:** `firmware/NeuroLoop_Core` (FW version `7.0-rebuild`).
Everything below describes the code as it exists.

## Boot path

```
setup():  Serial → watchdog(10 s, IDF v5 API) → GPIO (buzzer/haptic LOW)
          → OLED init (failure never blocks sensing) → sensors init
          (APDS failure never blocks IMU) → telemetryInit() (NON-blocking)
          → runCalibration()  → MONITORING
loop():   handleSerial() → handleGesture() → sensorsHealthTick()
          → imuSampleTick() (100 Hz self-paced) → gait/tremor (MONITOR)
          → tap pipeline (TAP_TEST) → updateEvents() → cueTick()
          → telemetryTick() → throttled status line → OLED refresh
```

## Application states

`BOOT → CALIBRATION → MONITORING`, plus `TAP_TEST` on demand and `FAULT`
(IMU absent — other subsystems keep running; recovery is automatic via the
5 s health tick, which triggers recalibration).

Calibration is a real state with an OLED countdown (`HOLD STILL`, 5…1).
Movement above 3× the running baseline fails it: `CALIBRATION FAILED /
MOVE DETECTED`. Three failures → monitoring continues with the degraded
baseline floor, flagged `CAL FAILED` on serial status and the system page
— never silently.

## Sensor pipeline (preserved from the validated prototype)

- 100 Hz I2C sampling with spike gate (|a|>8 g / |g|>500°/s samples are
  dropped, never recorded as zero) and measured-rate/timing stats.
- Adaptive baseline `calRMS` from calibration; thresholds are relative.
- Tremor: 256-sample magnitude FFT, Hamming, 3–6 / 6–8 Hz band gating,
  3-consecutive-window confirmation, EMA smoothing. Output carries an
  explicit quality: `VALID | LOW_SIGNAL | MOTION_CONTAMINATED | INVALID`.
- Disease labels removed: the device reports tremor-band activity only.
- Tap: z-axis moving average, hysteresis edge detect, 175 ms debounce,
  ITI mean/CoV grade 0–4. Incomplete → INCOMPLETE, never a fake grade.
- Gait FSM: `REST → WALKING → FREEZE_CANDIDATE → FREEZE → RECOVERY →
  WALKING`. Candidate/exit windows are the same validated timers; one
  episode produces exactly ONE `freeze` event with its real duration.
- Jerk: |d|a|/dt| peak kept for the experimental impact/fall-candidate
  heuristic (impact > 3 g/s → 3 s stillness → `possible_fall` event).

## OLED (SSD1306 128×64)

Paged UI, serial-selectable (`page 0..4`, `v` cycles):

| Page | Contents |
|---|---|
| 0 STATUS | tremor primary + gait + net state + sensor dots |
| 1 TREMOR | index /10, dominant Hz, quality |
| 2 GAIT | state, cadence, today's freeze count |
| 3 TAP | live progress bar + countdown; result (GRADE n / INCOMPLETE) |
| 4 SYSTEM | IMU/APDS/NET, queue depth/loss, sent/failed, uptime, fw |

Overlays (2.5 s): `MED EVENT RECORDED`, `FREEZE EVENT RECORDED`,
cue states `FREEZE CUE` / `TREMOR ALERT`. All strings are sized to the
panel (size-1 ≤ 21 chars; nothing renders outside 128×64).

## Serial diagnostic console

Full command reference: `docs/SERIAL_COMMANDS.md`. `help`, `status`,
`test all` (13 checks), per-subsystem tests, `page N`, sensing `sensors`
/`timing`/`memory`/`network`/`telemetry`/`events`. `dev` simulation is
compile-gated (`ENABLE_DEV_DIAGNOSTICS 0`) and drives actuators only.

## Telemetry

See `docs/FIRMWARE_TELEMETRY.md`: schema_version 2 wire contracts,
bounded queues, paced WiFi FSM, NTP, event idempotency, TLS policy.

## Building / flashing

Arduino IDE (or arduino-cli), ESP32 MYOSA profile; libraries:
AccelAndGyro, LightProximityAndGesture, oled (MYOSA kit), arduinoFFT,
SimpleKalmanFilter, ESP32 core with IDF-V5 watchdog API. Fill `config.h`
locally (WiFi + API_BASE_URL + DEVICE_ID + DEVICE_TOKEN) — placeholders
are committed on purpose; never commit the real one.
