# PD-SENSE / NeuroLoop — CURRENT STATE (baseline audit)

> This document records the **actual implementation** as found in the
> repository on the audit date, separately from what the old documentation
> claims and from the target architecture. It is the baseline the rebuild
> (`docs/FIX_REPORT.md`) is measured against.
>
> Legend: **[ACTUAL]** = verified in source code · **[OLD DOC]** = what
> documentation claims (often stale) · **[TARGET]** = where the rebuild goes.

---

## 1. Repository structure

```
PD SENSE PROJECT/
├── index.html                  (repo-root copy of the public site)
├── README.md / AGENT.md / SESSION_HANDOFF.md / TESTER.md / LICENSE
├── pd-sense-cover.jpg
├── agents/                     (6 scoped agent briefs)
├── assets/images/PD_SENSE/     (photos + video of the physical build)
├── docs/                       (7 design docs, several stale)
├── firmware/NeuroLoop_Core/
│   ├── NeuroLoop_Core.ino      (application coordinator)
│   ├── config.h                (pins, tunables, WiFi + Supabase keys)
│   ├── sensors.{h,cpp}         (MPU6050 FFT/tap/gait + APDS9960)
│   ├── display.{h,cpp}         (SSD1306 OLED)
│   └── telemetry.{h,cpp}       (WiFi → Supabase REST direct)
└── website/
    ├── index.html              (public marketing site)
    ├── WEBSITE.md
    └── live-monitor/
        ├── index.html          (technician console)
        ├── css/app.css
        ├── js/{config,store,data,app,publish,summary,viz,hero,webserial}.js
        ├── test/summary-test.html
        └── supabase/{schema.sql, rollup.sql, SETUP.md, edge-function-rollup/}
```

## 2. Hardware

- MYOSA ESP32 motherboard, MPU6050 IMU (I2C 0x69), APDS9960 (0x39),
  SSD1306 128x64 OLED (0x3C), I2C SDA=GPIO21 / SCL=GPIO22 @ 100 kHz
  with 50 ms bus timeout.
- ACTIVE buzzer GPIO25 (digital on/off — correct), haptic GPIO26.
- Power / comms over USB; phone hotspot WiFi ("REDMI NOTE 15 Pro 5G"
  with password committed to the repo — see §14).

## 3. Firmware architecture

**[ACTUAL]** `NeuroLoop_Core.ino` (v6.0-core):

- Modes: `MODE_MONITOR` / `MODE_TAP` / **`MODE_MANUAL`** (synthetic values
  accepted over serial — a production data-integrity violation).
- `setup()`: serial → watchdog (IDF v5 API, 10 s) → GPIO → display →
  sensors → **blocking** 5 s calibration → `telemetryInit()` which
  **scans all WiFi networks at every boot** and then **blocks up to 15 s**
  connecting before monitoring starts.
- `loop()`: watchdog feed → serial keys → gestures → health tick →
  `imuSampleTick()` (self-paced 100 Hz) → gait/tremor/tap processing →
  `cueTick()` → `telemetryTick()` → throttled serial + OLED @ 200 ms.
- Single-page OLED composition with long clipped strings.

**[OLD DOC]** The .ino header still says *"standalone firmware (no WiFi,
no cloud, no dashboard)"* — false since the telemetry layer was bolted on.

## 4. Sensor pipeline

**[ACTUAL — sound, preserved in the rebuild]**:

- 100 Hz self-paced sampling with spike gate (`|a|>8 g`, `|g|>500°/s`).
- Adaptive boot calibration: 500-sample offsets + 200-sample resting RMS
  (`calRMS` floor 0.01 g) — all downstream thresholds are relative to it.
- Tremor: 256-sample window, magnitude vector, mean removal, Hamming,
  ArduinoFFT, power band gating 3–6 Hz / 6–8 Hz, 3-consecutive-window
  confidence, EMA smoothing; gross-motion windows discarded.
  **Weakness:** `tremorType` is labeled `"PD"`/`"ET"` — disease-band
  naming that must not survive into the UI as a diagnostic claim.
- Tap: z-axis deviation, 4-tap moving average, armed/hysteresis edge
  detect, 175 ms debounce; BK grade 0–4 from ITI mean/CoV, −1 incomplete.
- Gait: Kalman-filtered gyro X (Y-channel scale bug avoided — documented
  in-code), steps on falling edge through adaptive threshold, cadence
  over a 4 s window, freeze = WALKING + cadence < 0.5 Hz for 2 s,
  exit = 3 consecutive windows > 1 Hz. States are REST/WALK/FREEZE only
  (no FREEZE_CANDIDATE/RECOVERY).
- Jerk: d|a|/dt plus decaying peak — additive, used by fall heuristic.

## 5. OLED pipeline

**[ACTUAL]**: one 128x64 frame, fully redrawn every 200 ms; header
`[MODE] mm:ss`, two 28-char lines + optional big line, cue tag, footer.
- Violates its own header comment (claims partial row updates).
- `!! CUE ON: buzzer/haptic` = 25 chars × 6 px = 150 px → **clipped**.
- "DOSE LOGGED" full-screen banner for 3 s — overlays sensing data.

## 6. Serial command pipeline

**[ACTUAL]**: single-character commands only — `0 1 2 3 4 s v m`, plus a
CSV line parser active only in MANUAL mode (`tremor,brady,gait`).
No engineering command console, no `test …` diagnostics, no `status`
snapshot, no help. Baud 115200.

## 7. Telemetry pipeline

**[ACTUAL]** `telemetry.cpp`:

- One summary POST per 15 s directly to
  `POST {SUPABASE_URL}/rest/v1/readings` with **anon key** headers,
  `Prefer: return=minimal`; alerts POST to `/rest/v1/alerts` on
  `prolonged_freeze` (8 s) / `possible_fall` (jerk > 3 g/s + 3 s stillness).
- `WiFiClientSecure` + **`setInsecure()`** — no certificate validation.
- One `pendingSummary` slot; while it retries, accumulation continues
  so long outages flatten hours into a single row; no queue, no
  overflow/loss accounting, no event_id / schema version / sequence.
- **Semantic bug:** the JSON field `tap_count` is filled from the
  **jerk-event counter** (`accJerkCount`) — jerk spikes are recorded as
  taps in the database.
- WiFi housekeeping: `disconnect(); begin()` every 10 s while down.
- Timestamp discipline: none — server-side `default now()` only.

## 8. Supabase architecture

**[ACTUAL]** `supabase/schema.sql`:

- `readings(id, ts, patient_id, device_id, source, tremor_amplitude,
  dominant_frequency, tap_count, bradykinesia_grade, freeze_event, …)`
- `alerts(…)`, `readings_rollup(…)`; rollup function
  `rollup_readings(48)` + optional pg_cron / Edge Function trigger.
- RLS: `anon` can **SELECT and INSERT everything** (`using (true)`).
- No `event_id` uniqueness → duplicate POST retry = duplicate row.
- Rollup averages `tap_count` (meaningless for discrete tests) and has
  no quality/jerk/cadence fields.

## 9. Live Monitor architecture

**[ACTUAL]** `website/live-monitor`:

- Browser → Supabase REST/col Realtime directly with the **anon key in
  `js/config.js`** (same key also inside firmware config.h).
- `store.js` = localStorage per-patient DB (`nl_patients_v1`,
  `nl_data_<id>`) — browser owns authoritative patient data.
- `data.js` row map invents environmental channels (temp/humidity/AQI/
  pressure) that no table or firmware produces.
- Instrument widgets (SVG gauges) + Chart.js history; alerts banner.
- **webserial.js is dead code** — never included by index.html, and no
  `connect-serial-btn` element exists.

**Root-cause class of "ESP32 reads, website shows nothing":** the chain
has zero observability at every hop — firmware POST failures
(hotspot/TLS/RLS) are invisible past one serial line; the browser has no
debug view of API response → normalization → render. Failure could be at
any of: WiFi credentials/hotspot, TLS, PostgREST RLS 401/409, realtime
publication missing, `patient_id` mismatch, or render. The rebuild makes
each layer self-reporting (firmware `test api`/`telemetry` commands,
backend health endpoints, `?debugData=true` view).

## 10. Current manual-data path  **[REMOVED in target]**

- Firmware `MODE_MANUAL` (key `4`): typed `tremor,brady,gait` tuples flow
  through `evaluateAndAct()` as if they were sensor data.
- Live monitor *Section 2* form writes rows into `readings` with
  `source='manual'` (and falls back to localStorage-only on failure).
- Demo day generator (`buildDemoDay()`) fabricates Levodopa scenarios.

## 11. Current medication path

- ESP32: any APDS9960 swipe → `logDose()` → OLED "DOSE LOGGED" + serial
  event + in-RAM counter. **Never uploaded.**
- Live monitor medication form (name/dose/note/ts) → **localStorage
  only**; feeds `summarizeForDoctor()` dose windows.
- Serial key `m` also logs a dose. No gesture selection, no dedup beyond
  a 1.5 s debounce, no persistence, no medication metadata by design.

## 12. Current doctor/public site path

- `publish.js` serializes `summarizeForDoctor()` output per patient into
  `localStorage["nl_outbox"]`.
- **Public marketing site `website/index.html` reads `nl_outbox` and
  renders per-patient cards** (name, MRN, dose tables) — patient data on
  the public site path, works only in the same browser profile.
- No real doctor portal exists. Root `index.html` duplicates the public
  site.

## 13. Current animation architecture

- Live monitor hero: `hero.js` — procedural 3D brain (cortex, gyri
  folding, cerebellum, brainstem, pulsing substantia nigra, dopamine
  particle stream) scroll-scrubbed. **[TARGET: removed]** — a decorative
  medical-movie metaphor, not system instrumentation.
- Public site: separate 3D scroll story device. Both animate
  independently of any data.

## 14. Current security model

- **Credentials committed to git**: Supabase anon key in both
  `website/live-monitor/js/config.js` and `firmware/NeuroLoop_Core/
  config.h`; WiFi SSID + password in firmware config.h. Anon key is
  low-privilege, but RLS makes it read/write the entire patient DB.
- No service-role key present in repo (good), because there is no
  backend at all (bad).
- ESP32 presents `patient_id` as a self-asserted string; nothing stops
  device A writing into patient B's rows.
- HTTPS without certificate validation (`setInsecure()`).

## 15. Current bugs (verified against source)

| # | Bug | Where |
|---|-----|-------|
| B1 | `tap_count` JSON field fed by jerk-event counter (semantics) | telemetry.cpp `sendSummaryPacket` |
| B2 | First-alert suppression: `lastAlertSentMs[3]={0}` vs `millis()<600000` in first 10 min | telemetry.cpp |
| B3 | Alert failure re-arms its own one-shot retry → infinite 3 s retry loop, no final-failure log | telemetry.cpp |
| B4 | No event_id → retry-after-lost-response duplicates rows; no schema_version | telemetry.cpp / schema.sql |
| B5 | Store module defines `addPatient`/`getReadings` twice (second wins) | store.js |
| B6 | Summary treats end-of-data as sustained (good window / wearoff fabricated) | summary.js `analyseDose` |
| B7 | Manual telemetry + manual dose entry write into the patient record | app.js / index.html |
| B8 | Patient summaries exposed on the public site via `nl_outbox` | publish.js + website/index.html |
| B9 | webserial.js unreachable (not referenced, no button element) | live-monitor/index.html |
| B10 | Boot WiFi scan + 15 s blocking connect delays sensing start | telemetry.cpp `telemetryInit` |
| B11 | Aggressive `disconnect()/begin()` every 10 s while offline | telemetry.cpp |
| B12 | OLED long strings clip past 128 px; full redraw each frame contradicts own docs | display.cpp |
| B13 | Tap-test grade and medication events computed but never persisted | sensors.cpp / .ino |
| B14 | UI reads fields (temp/humidity/AQI/pressure) nothing produces | data.js / viz.js |
| B15 | Disease-band labels "PD"/"ET" surface as tremor type | sensors.cpp |
| B16 | Rollup sums/averages tap_count across windows — meaningless | rollup.sql |

## 16. Stale / legacy code

- `MODE_MANUAL` production path; `m` key dose logging.
- `webserial.js` (entire file, unreferenced).
- `temp_c / humidity_pct / aqi / pressure_hpa` plumbing across
  data.js/viz.js/app.css (DHT22/SGP30/BMP280 era; boards not fitted).
- Manual entry + medication forms; demo-day generator in production path.
- `publish.js` / `nl_outbox`; public-site patient card renderer.
- Boot-time WiFi scan "DEBUG PATCH" block.
- README/AGENT/docs narrating the abandoned **ESP32 `/data` endpoint +
  laptop poller + local dashboard + Blynk/email/WA** architecture that
  was never built (superseded by the Supabase direction).

## 17. Contradictions

1. .ino header "no WiFi, no cloud, no dashboard" ↔ telemetry.cpp does all three.
2. display.h comment "partial row updates" ↔ display.cpp full-refresh.
3. docs/FIRMWARE.md "networking layer separate, later" ↔ it exists.
4. schema.sql comment says anon demo-grade policies ↔ docs claim no cloud.
5. SETUP.md tells the ESP32 to POST with the anon key ↔ any secrecy the
   anon key had is voided by it also being in the browser bundle.
6. `tap_count` column intent (tap test) ↔ fed jerk counts.
7. "Tap test 20 taps -> grade" doc path ↔ grade vanishes at the device.

## 18. Current limitations

- Single-device, single-patient assumption everywhere.
- No persistence of tap/medication events; no event timeline at all.
- No device registry, identity, or auth; no freshness/stale semantics.
- No backend — therefore no central validation, no alerting ownership,
  no cross-browser history, no doctor portal, no CSV of truth.
- No RTC/NTP discipline; device time is millis-since-boot.
- OLED unusable as an instrument (dense strings; clipping).
- No engineering console: hardware test requires the website.
- No end-to-end observability: impossible to tell where the data path
  broke — which is the actual complaint this rebuild answers.

---

### TARGET ARCHITECTURE (reference, decided by the master spec)

```
MPU6050/APDS9960 → ESP32 firmware (real sensors only, dev sim behind flag)
        │  HTTPS, device token, event_id, schema_v2, bounded queue
        ▼
PD-SENSE backend API (Node/Express, validation, auth, service-role key)
        ▼
Supabase (migrated schema, RLS deny-anon, uniqueness enforced)
        ├── Live Monitor (REST/SSE → api.js → state.js → table/charts/
        │                  infographics/technical 3-D data-flow scene)
        ├── Doctor Portal (history, trends, events, neutral summaries)
        └── Public website (story only — zero patient data)
```
