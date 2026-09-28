# PD-SENSE — Serial diagnostic console

Serial Monitor @ 115200 baud, line-based commands, case-insensitive,
extra whitespace ignored. Everything below works with ONLY an ESP32 and
a USB cable — no website required. Diagnostics that need the sensor
pipeline pump it themselves while they run.

```
========================================================
PD-SENSE SERIAL DIAGNOSTICS
========================================================
SYSTEM
  status
  test all
  test memory
  test timing
  reboot
SENSORS
  test i2c
  test imu
  test apds
  sensors
SIGNAL PROCESSING
  test tremor
  test gait
  test tap
  test calibration
DISPLAY / ACTUATORS
  test oled
  test buzzer
  test haptic
  page 0
  page 1
  page 2
  page 3
  page 4
NETWORK
  test wifi
  network
  test api
TELEMETRY
  test telemetry
  telemetry
  events
NORMAL MODE
  monitor
DEVELOPMENT
  dev help
========================================================
```

## Command notes

| Command | What it does / proves |
|---|---|
| `status` | Full engineering snapshot: fw, uptime, heap, reset reason, sensors, calibration, monitor/page, WiFi/RSSI/IP/backend/NTP, telemetry queue + counters, current signals, event counts |
| `test all` | 13 subsystems, prints `[i/13] NAME … RESULT: n/13 PASS`. Warnings are NOT counted as passes |
| `test i2c` | Real bus scan; expects 0x3C OLED, 0x39 APDS9960, 0x69 MPU6050; PASS only if all three answer |
| `test imu` | I2C ping + raw accel/gyro readout + measured sample rate; FAIL if values are outside plausible range |
| `test apds` | Ping + gesture decode; asks you to swipe (10 s). Never creates a medication event |
| `test oled` | Full draw pass: clear/text/border/progress bar/all 5 pages/event overlay. Verify visually |
| `test buzzer` | 1 short, 2 short, 3 short, 1 long beep; buzzer forced off afterward |
| `test haptic` | 100/250/500 ms pulses; GPIO forced LOW afterward |
| `test calibration` | Re-runs calibration with OLED countdown; FAILs on move detection |
| `test tremor` | Collects one fresh FFT window; prints score/freq/quality; WARN when motion-contaminated |
| `test gait` | 6 s live observation; prints state/cadence/RMS/freeze |
| `test tap` | 15 s tap listening; taps must register ≥1 (bounced taps must not double-count) |
| `test wifi` | Status + one-shot scan; PASS when connected (prints RSSI/IP) |
| `test api` | `GET /api/health` against the backend; PASS on 2xx; prints hint on 401/403 |
| `test telemetry` | Builds one telemetry packet (prints it) — proves serialization; shows queue stats |
| `test memory` | heap free / min-free / total; WARN on low watermark |
| `test timing` | target vs measured rate, min/max/avg sample period, jitter |
| `sensors` | one-line sensor/sampling snapshot |
| `network` | WiFi/backend/NTP one-liner |
| `telemetry` | queue/sent/failed/dropped/sequence one-liner |
| `events` | freeze/med/tap/fall-candidate counters |
| `page 0..4` | switch OLED page (0 STATUS, 1 TREMOR, 2 GAIT, 3 TAP, 4 SYSTEM) |
| `tap` | start the patient tap test |
| `v` | cycle OLED page |
| `monitor` | return to monitoring + STATUS page |
| `reboot` | restarts the device |

## Development simulation (`dev …`)

Compiled out by default (`ENABLE_DEV_DIAGNOSTICS 0` in config.h). When 0,
every `dev` command answers exactly `DEV MODE DISABLED`.

When compiled in (bench only): `dev tremor 8`, `dev gait freeze`,
`dev brady 3` drive ONLY the local cue engine (buzzer/haptic). They never
touch sensor state and can never reach the patient telemetry database.

## Prefixes

`BOOT` boot log · `OK` success · `ERR` fault · `STA` throttled status ·
`EVT` event · `CMD` command echo · `CAL` calibration · `NET` network/telemetry.
