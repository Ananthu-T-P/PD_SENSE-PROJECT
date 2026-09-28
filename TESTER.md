# TESTER.md — PD-SENSE acceptance checklist (hardware required)

Run on a bench with the ESP32 wired: MPU6050 + APDS9960 + SSD1306 +
buzzer + haptic, Serial Monitor @ 115200, backend running with real
Supabase creds (docs/DEPLOYMENT.md).

## 1. Standalone serial diagnostics (no website needed)

| # | Command | Expected |
|---|---|---|
| 1.1 | boot | banner, sensors OK, calibration countdown on OLED, `EVT ready` |
| 1.2 | `help` | full command card prints |
| 1.3 | `test all` | `[13/13] RESULT: 13/13 PASS` (warnings counted separately) |
| 1.4 | `test i2c` | 0x3C OLED, 0x39 APDS9960, 0x69 MPU6050 all FOUND |
| 1.5 | `test imu` | raw AX/AY/AZ plausible; measured rate ~100 Hz |
| 1.6 | `test apds` | swipe detected; NO medication event is created |
| 1.7 | `test oled` | every page renders inside a 2.4″ frame, no clipping |
| 1.8 | `test buzzer` | 1/2/3 short + 1 long; silence after |
| 1.9 | `test haptic` | 100/250/500 ms pulses; GPIO low after |
| 1.10 | `test calibration` | PASS when still / FAIL with move detection |
| 1.11 | `test tremor` | fresh FFT window; VALID while still w/ tremor input, MOTION_CONTAMINATED while shaking |
| 1.12 | `test gait` | live state/cadence for 6 s |
| 1.13 | `test tap` | taps register with no bounce double-counting |
| 1.14 | `test wifi` | CONNECTED with RSSI/IP |
| 1.15 | `test api` | HTTP 200 from backend health |
| 1.16 | `test telemetry` | packet JSON printed; queue stats sane |
| 1.17 | `test memory`, `test timing` | PASS; jitter reported |
| 1.18 | `status` / `events` / `telemetry` / `network` | counters update; no secrets printed anywhere |
| 1.19 | `dev tremor 8` | responds `DEV MODE DISABLED` |

## 2. End-to-end data path (the acceptance criterion)

2.1 Boot with backend up → within ~15 s the Live Monitor's
**LIVE ESP32 READINGS** table gets a row; the same `event_id` exists once
in `readings` (check Supabase table editor).  
2.2 New row → table highlight, charts point matches the table value,
metric cards match, pipeline packet animation fires at ingest.  
2.3 Live badge shows LIVE; unplug the device → STALE within ~45 s →
OFFLINE within ~120 s.  
2.4 `?debugData=true` shows backend online + latest packet normalized.  
2.5 Refresh the page → history persists (backend, not localStorage).  
2.6 Second browser sees the same data with the token.

## 3. Behavior scenarios

3.1 **Tap test**: `tap` on serial → 20 taps → OLED GRADE page 3 → events
timeline shows `tap_test_completed` → tap_tests table row → doctor portal
tap history. Timeout path → INCOMPLETE, grade NULL in DB.  
3.2 **Medication gesture**: configured swipe → OLED MED EVENT RECORDED +
serial EVT → medication_events row → events timeline card. Wrong-direction
swipe → logged as ignored, no record. Second swipe within 30 s →
suppressed (cooldown).  
3.3 **Freeze**: hold a freeze → candidate → confirmed (2 s) → RAS cue on
device; recover → ONE freeze event with duration; ≥ 8 s → backend creates
`prolonged_freeze` alert (once per episode; cooldown visible).  
3.4 **Impact**: sharp jolt + stillness → `possible_fall` event → critical
alert (candidate language everywhere).  
3.5 **High tremor**: shaker sustained → `high_tremor` alert after 3
consecutive VALID windows.  
3.6 **Offline queue**: kill WiFi → `NET ×`, OLED PENDING, queue counts up
in `status`; restore → oldest-first drain, no duplicates
(`already_processed` on the backend log is fine).

## 4. Failure isolation

4.1 Unplug APDS → IMU monitoring + telemetry continue; `APDS FAULT` shows.  
4.2 Unplug MPU6050 → FAULT state, gestures/display/telemetry continue;
plug back → auto-recover + recalibrate.  
4.3 Stop backend → device keeps sensing; dashboard reports backend
offline; restart → resumes.  
4.4 Wrong device token → 401 on `test api`; no row appears.

## 5. Security spot-checks

5.1 View-source on the public site: no keys, no patient data blocks.  
5.2 DevTools → localStorage: only `pds_ui_prefs` (theme/token/patient id).  
5.3 Supabase anon key from ANYWHERE returns 42501/401 on `readings` now.

## 6. Graphics QA

6.1 Live monitor: pipeline scene animates only when ingests happen;
backend stoppage visibly changes links.  
6.2 `?debugGraphics=true`: fps ≈ 55–60 on a laptop, frame ms stable.  
6.3 prefers-reduced-motion OS flag → animations freeze, data intact.  
6.4 Block WebGL (devtools) → schematic SVG/canvas fallback, no blanks.
