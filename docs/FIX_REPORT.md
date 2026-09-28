# PD-SENSE — FIX / REBUILD REPORT (v7)

Baseline audit: `docs/CURRENT_STATE.md` (16 bug classes, B1–B16 + stale
inventory + contradictions). This report maps findings → fixes →
verification.

## 1. Original architecture → new architecture

**Before:** ESP32 →(direct, anon key, insecure TLS)→ Supabase; browser
→(same anon key)→ Supabase; localStorage patient DB; manual entry;
`nl_outbox` → public site; brain hero; superseded `/data`-endpoint docs.

**After:** ESP32 →(device token)→ PD-SENSE backend (only credential
holder) →(service role)→ Supabase (RLS-locked) → backend →
Live Monitor / Doctor Portal (dashboard token, REST+SSE).
Public site contains zero patient paths.

## 2. Root-cause answer to "ESP32 reads, website shows nothing"

The chain had **no backend and zero per-hop observability**: device POST
results vanished past one serial line; the browser could not tell WiFi
from PostgREST from a render bug. v7 makes every hop self-reporting:
firmware `status`/`test api`/`test telemetry`; backend `/api/health` +
`/api/health/database` (refuses to boot without creds); frontend
`?debugData=true` shows API response ↔ normalized row ↔ table state
side by side; freshness badge derives from real `received_at` age.
*The specific failing hop on your bench cannot be proven without running
the chain live — see "Hardware validation" below; the UI no longer lets
the failure hide.*

## 3. Firmware problems fixed

- Kim manual telemetry mode: REMOVED from normal operation; dev injection
  only via `dev …` and compiled out unless `ENABLE_DEV_DIAGNOSTICS 1`
  (answered by `DEV MODE DISABLED` otherwise; affects actuators only —
  cannot reach the database).
- `jerkCount → tap_count` schema violation (B1): separated; telemetry
  carries `jerk_peak`; tap counts exist only inside `tap_test_completed`.
- First-alert suppression (B2): explicit has-alerted flag — first alert
  after boot fires immediately; cooldown applies only after a SENT alert.
- Infinite 3-second alert retry loop (B3): now policy-based backoff +
  cloud alerts are backend-owned (device emits events; backend dedups).
- No dedupe/version (B4): every packet has `{schema_version:2,
  event_id: deviceId-bootId-seq, sequence}`; DB UNIQUE enforces.
- Boot WiFi scan + 15 s blocking connect (B10) and 10 s
  disconnect/begin churn (B11): replaced by a paced WiFi FSM
  (5 s checks, 20 s reconnect gap); boot never blocks sensing on WiFi.
- Tap-test + medication outcomes never persisted (B13): both are now
  discrete events queued to the backend (with INCOMPLETE honesty rules
  and 30 s medication-gesture cooldown + configured-gesture filter).
- Calibration: now a state with OLED countdown and MOVE-DETECTED
  failure instead of silent acceptance.
- Disease labels "PD/ET" (B15) removed → tremor-band activity + quality.
- Sampling integrity: measured rate + jitter stats exposed
  (`test timing`), spike-gated samples are dropped, never zeroed.

## 4. Sensor behaviour (preserved, verified by code review)

Adaptive calibration baseline; FFT band gating with 3-window confirmation
+ EMA; tap hysteresis/debounce; gait FSM timers retained — exposed as
named CANDIDATE/RECOVERY states driven by the same timers (no regression
risk). Freeze episodes produce ONE event with real duration; recovery
collapse continues the same episode.

## 5. OLED

Rebuilt into 5 bounded pages (STATUS/TREMOR/GAIT/TAP/SYSTEM), strings
sized ≤128 px, event overlays (`MED EVENT RECORDED`, `FREEZE EVENT
RECORDED`, `CUE ACTIVE`), queue/PENDING/loss indicators. Full-redraw at
250 ms cadence (flicker-safe at this size); OLED fault isolates from
sensing. Old long clipped strings (B12) and the stale header comment
removed.

## 6. Telemetry

Bounded static FIFO queues (12×telemetry + 8×event, overflow drops oldest
+ `queue_dropped` counter + `TELEMETRY LOSS` banner), events-first
ordering, 5→60 s backoff, 5 s hard HTTP timeout, paced reconnect, NTP
sync with `device_ms` fallback and backend `received_at` authority,
`ALLOW_INSECURE_TLS` default 0 with `API_ROOT_CA_PEM` option, 401 hinting.

## 7. Backend (new)

Node/Express `server/`: device-token auth (hash-only at rest; registry
patients), validation (finite/ranged/typed, schema v2, event whitelist,
tap-grade nulling rule enforced twice), idempotent ingest
(`already_processed`), SSE `/api/v1/stream`, CSV export, patient
summary/analytics with data-gap reporting, device status + freshness,
seeded registry. Startup refuses invalid env except in explicit test mode.

## 8. Database

`supabase/migrations/0001_rebuild.sql`: legacy tables rename-parked;
patients / devices (token_hash) / readings (event_id UNIQUE, quality
states, health fields) / events (jsonb payloads) / tap_tests (grade
consistency CHECK) / medication_events / alerts (status lifecycle) /
reading_rollups (documented field semantics; discrete values never
averaged); RLS enabled with NO anon/authenticated policies on any patient
table (service-role only). Rollup function updated for the new schema.

## 9. Live Monitor

Removed: manual entry section (HTML/CSS/JS + DB insert), manual
medication form, store.js patient localStorage DB (and its duplicate
function defs — B5), publish.js/`nl_outbox` (B8), demo-day generator in
the production path, environmental channels nothing produces (B14),
dead webserial.js (B9), 3-D brain hero.
Added: `api.js` single fetch layer, `state.js` normalized contract +
bounded in-memory store + seen-set dedupe, LIVE ESP32 READINGS table
(column control, 25/50/100 + Load-more cursor, new-row flash, NEW DATA
banner, row-detail drawer incl. ingest latency, CSV), five charts on the
same rows (null gaps), metric cards with quality badges + explanation
drawer, events timeline with ack, device-health panel, range filter
(1h–30d) applied to all surfaces, LIVE/STALE/OFFLINE + NO-TELEMETRY
empty state, `?mode=demo` bannered, `?debugData`, `?debugGraphics`.
Graphics: engineering pipeline schematic (packets on real ingests only,
data-driven amplitude/cadence/freeze behavior, backend link states) +
optional Three.js device model with live OLED face, canvas/SVG fallback,
reduced-motion honored, offscreen-paused.

## 10. Manual-path removal

`MODE_MANUAL` CSV parser + serial `m`/`4` dose-and-simulate keys removed
from firmware; website forms removed; no source='manual' production
insert remains anywhere.

## 11–13. Charts/infographics/animation

All consume the same normalized reading contract (state.js); a reading
updates table, charts, cards and the pipeline animation in one event.
Animation is data-driven; randomness appears only in `?mode=demo` (which
is never the default and never touches the network).

## 14. Doctor portal

New `website/doctor/`: patient select, freshness, summary (fixed
math, observational medication alignment with causation disclaimer),
trend charts (raw+rollup merged), freeze/alert list, medication event
timeline, tap-test history, recent readings, CSV export.

## 15. Security changes

Secrets moved to env/placeholders; service-role key only in `server/.env`;
device tokens hashed at rest; patient association is registry-derived
(devices can't claim arbitrary patients); RLS denies browser access;
CORS allowlist; payload size caps; rotation procedure documented
(`docs/SECURITY.md` — hotspot password + anon key rotation REQUIRED).

## 16–18. Files

**Added:** `server/**` (package.json, .env.example, src/*, tests/*);
`supabase/migrations/0001_rebuild.sql`; `website/doctor/**`;
`website/live-monitor/js/{api,state,table,charts,infographics,events,graphics,diagnostics}.js`;
`docs/{CURRENT_STATE,API,DATA_MODEL,DEPLOYMENT,TROUBLESHOOTING,SECURITY,
SERIAL_COMMANDS,FIRMWARE_TELEMETRY,FIX_REPORT}.md`; `.gitignore`;
`website/live-monitor/test/README.md`.

**Modified (full rewrites):** `firmware/NeuroLoop_Core/{config.h,
sensors.h, sensors.cpp, display.h, display.cpp, telemetry.h, telemetry.cpp,
NeuroLoop_Core.ino}`; `website/live-monitor/{index.html, css/app.css,
js/config.js, js/app.js}`; `website/WEBSITE.md`; `README.md`; `AGENT.md`;
`docs/{ARCHITECTURE,FIRMWARE,DASHBOARD,DOCTOR_WEBSITE,ALERTS,BUILD_ORDER}.md`;
`TESTER.md`; `SESSION_HANDOFF.md`; `agents/*.md` (superseded banner);
`website/index.html` (patient feed removed).

**Moved/archived:** `index.html` (Firebase-era dashboard) →
`legacy/firebase-dashboard-index.html`; `website/live-monitor/supabase/*`
→ `supabase/legacy/*`.

**Deleted:** `store.js`, `publish.js`, `data.js`, `viz.js`, `hero.js`,
`webserial.js`, `summary.js`, `test/summary-test.html` (their contracts
are superseded; summary logic lives server-side with tests).

## 19–22. Tests

| Suite | Command | Result |
|---|---|---|
| Backend unit (12 files… 22 tests) | `cd server && node --test` | **22 pass / 0 fail** |
| Backend boot smoke | start + health + auth probes | **pass** (health 200; db 503 w/o creds; telemetry 401 w/o device headers) |
| Syntax sweep | `node --check` all new/modified JS | **pass** (11 files) |
| Firmware compile | Arduino toolchain | **NOT RUN — REASON: no Arduino toolchain/device in this environment** |
| DB migration | Supabase SQL editor | **NOT RUN — REASON: BACKEND CREDENTIALS REQUIRED** |
| End-to-end (device→DB→UI) | bench | **NOT RUN — REQUIRES PHYSICAL HARDWARE VALIDATION** |

## 23. Hardware validation still required

TESTER.md §§1–6 — full `test all` on the bench, end-to-end data path with
real Supabase creds, gesture/tap/freeze/impact scenarios, queue/outage
drill, OLED bounds inspection, TLS posture choice for the demo network.

## 24. Known limitations (stated, not hidden)

- LAN demo uses HTTP between ESP32 and backend (TLS knob documented;
  `ALLOW_INSECURE_TLS 1` is encrypted-but-unvalidated and labelled such).
- Dashboard auth = one shared token (documented scope; not per-user).
- Device timestamps rely on NTP; queued packets during outages carry
  device `device_ms` + backend `received_at` authority is the ingest clock.
- Queue is RAM-resident (12+8 packets); a hard power-off loses the queue
  (loss counter shows it on return).
- Public site keeps its existing scroll identity (own animation, no
  patient data); a bespoke wristband-scene rework is stylistic and was
  deliberately not substituted for data-path work this session.
- Environmental channels (temp/humidity/AQI/pressure) were removed
  everywhere; add real sensors before reintroducing UI.
