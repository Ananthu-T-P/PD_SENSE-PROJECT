# Firmware Spec — ESP32 (MYOSA Mini stack)

## Why this exists

The original PD-SENSE prototype had one core usability bug: raw 50 Hz
serial output scrolls past faster than a human (or a classroom evaluator)
can read it, and there was no way to run an isolated test on demand. This
rewrite fixes both with a state machine, throttled output, and manual
keyboard-triggered tests.

## State machine

| State | Trigger (serial key) | Behavior |
|---|---|---|
| `IDLE` | `0`, or automatic after a test window ends | No active sampling loop; waiting for a mode key |
| `TREMOR_TEST` | `1` | FFT-based tremor scoring from MPU6050 accel/gyro for a fixed test window (e.g. 15 s), then auto-return to `IDLE` |
| `TAP_TEST` | `2` | Tap-count/rate detection from MPU6050 for a fixed test window, then auto-return to `IDLE` |
| `GAIT_TEST` | `3` | Gait/freeze detection from MPU6050 for a fixed test window, then auto-return to `IDLE` |
| `MANUAL` | `4` | Accepts comma-separated serial input in place of sensor sampling; stays in `MANUAL` until `0` |

Rules:
- Only one state is active at a time.
- Every timed test state auto-returns to `IDLE` after its window plus a
  short reset delay — it does not wait for the user to press `0`.
- `0` is a hard reset to `IDLE` from any state at any time.

## Manual data-entry mode

Format: comma-separated values typed into the serial monitor, e.g.:

```
8,3,freeze
```

Interpreted as: tremor score, tap count/rate, gait status — matching
whatever the equivalent real-sensor tuple would be for that test. Manual
mode exists because real tremor and gait patterns can't easily be
physically demonstrated on demand in a classroom setting; typing a value
simulates the reading without needing a person with Parkinson's present.

**Non-negotiable:** a manually entered tuple must be passed into the exact
same `evaluateAndAct()` call a real sensor-derived tuple would produce. Do
not write a separate "manual mode response" path — that would mean the
demo doesn't actually demonstrate the real system's behavior.

## `evaluateAndAct()`

Single shared function, called identically regardless of data origin
(real sensor or manual entry):

- **High tremor score** → buzzer beep.
- **Gait freeze detected** → actuator pulse implementing RAS (rhythmic
  auditory/tactile stimulation) — the standard cueing technique used to
  help a freezing gait resume movement.

Exact thresholds for "high tremor score" should be defined as named
constants near the top of the firmware file, not inline magic numbers, so
they can be tuned during testing without hunting through the code.

## Serial output

- Throttle to **~200 ms** between prints, regardless of underlying sample
  rate. This is the direct fix for the original scrolling problem.
- Print current mode, latest score(s), and any action just taken
  (`evaluateAndAct()` firing), so a human watching serial output can follow
  what happened without needing the dashboard open.

## `/data` endpoint (frozen contract)

Served via `WebServer.h`. `GET /data` returns JSON reflecting current
state only — no history, no pagination:

```json
{
  "mode": "TREMOR_TEST",
  "tremor_score": 8,
  "bradykinesia_grade": 2,
  "gait_status": "normal"
}
```

Field notes:
- `mode` — one of `IDLE`, `TREMOR_TEST`, `TAP_TEST`, `GAIT_TEST`, `MANUAL`.
- `tremor_score` — numeric, FFT-derived (or manually entered equivalent).
- `bradykinesia_grade` — numeric grade derived from tap-test data.
- `gait_status` — string, e.g. `normal` / `freeze`.

This schema is depended on by the dashboard (polling every ~300 ms), the
doctor-website poller, the analytics layer, and the future chatbot. Treat
any field rename, type change, or removal as a breaking change requiring
this document to be updated first and every consumer checked.

## Sensor suite reference

| Sensor | Role |
|---|---|
| MPU6050 (accel/gyro) | Tremor (FFT), tap detection, gait |
| APDS9960 | Gesture-based medication logging |
| DHT22 | Temperature/humidity |
| SGP30 or MQ-series | Air quality |
| BMP280 | Pressure |
| OLED | On-device status display |
| Buzzer | Audible feedback (`evaluateAndAct()` tremor response) |
| Actuator | Haptic RAS feedback (`evaluateAndAct()` gait-freeze response) |

## Explicitly out of scope

The original EOI's on-device TinyML tremor classifier is cut for this
version. Tremor detection here is **FFT-only**. Do not add a model file,
inference call, or training data pipeline to firmware without a written
scope change.
