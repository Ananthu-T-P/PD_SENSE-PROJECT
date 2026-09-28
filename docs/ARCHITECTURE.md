# PD-SENSE / NeuroLoop — Architecture (v7, current)

> This file describes the ACTUAL system. Rebuild implementation began from
> the audit in `docs/CURRENT_STATE.md`; the change log and before/after
> detail are in `docs/FIX_REPORT.md`.

## System diagram (current)

```
                        ┌──────────── MYOSA wrist device ─────────────┐
 MPU6050 ──┐            │  sensors.cpp: 100 Hz sampling, FFT tremor  │
 APDS9960 ─┼── I2C ────►│  band activity, tap detect, gait/freeze FSM│
 SSD1306 ◄──┤  OLED     │  sensor quality + gait candidate states    │
 buzzer ◄───┤  GPIO25   │  evaluateAndAct(): local cues only         │
 haptic ◄───┘  GPIO26   │  telemetry.cpp: bounded queues, event_id,  │
                        │  paced WiFi FSM, NTP, backoff              │
                        └───────────────┬────────────────────────────┘
                                        │ POST /api/v1/telemetry
                                        │ X-Device-Id + X-Device-Token
                                        ▼
                        ┌──────── PD-SENSE BACKEND (server/) ────────┐
                        │ deviceAuth (token hash, enabled, registry) │
                        │ validation (ranges, types, event_id,       │
                        │   schema_version=2, sizes)                 │
                        │ idempotent ingest (already_processed)      │
                        │ alertService: prolonged_freeze /           │
                        │   possible_fall / high_tremor, cooldown    │
                        │   DB-backed, lifecycle statuses            │
                        │ REST + SSE (/api/v1/stream) + CSV export   │
                        └───────┬──────────────────────────┬─────────┘
                         service-role key                  │ same origin
                                ▼                          ▼
                   ┌─────────────────────┐     ┌────────────────────────┐
                   │      SUPABASE        │     │ Live Monitor / Doctor  │
                   │ patients devices     │     │ Portal (browser)       │
                   │ readings events      │     │ REST poll + SSE push   │
                   │ tap_tests            │     │ dashboard token only   │
                   │ medication_events    │     └────────────────────────┘
                   │ alerts reading_rollups│
                   └─────────────────────┘
                   Public website: marketing/technical story ONLY.
                   No patient data, no database access, no handoff keys.
```

## Rules that make this the final architecture

1. There is exactly ONE write path into the database: `POST /api/v1/telemetry`
   with device credentials. Browser clients never write.
2. Browser data access goes through the backend API with the dashboard
   token. The browser never sees a database credential.
3. `localStorage` holds UI preferences only (token echo, selected patient,
   column choices). It is never the patient database.
4. The ESP32 keeps sensing through ANY network/backend failure; telemetry
   queues in a bounded FIFO and is drained oldest-first on recovery.
5. Firmware dev simulation exists only behind `ENABLE_DEV_DIAGNOSTICS 0→1`
   and drives local actuators only — it cannot reach the database.
6. Every record has `event_id`; uniqueness is enforced by the database.
7. Timestamps: device NTP `ts` when synced + always `device_ms` +
   backend `received_at` (authoritative).

## Module map

| Subsystem | Files | Notes |
|---|---|---|
| Firmware | `firmware/NeuroLoop_Core/{NeuroLoop_Core.ino, config.h, sensors.*, display.*, telemetry.*}` | coordinator + sensor layer + OLED pages + telemetry/queues + serial console |
| Backend | `server/src/{server.js, config.js, db.js, bus.js, …}` | routes / middleware / services / utils |
| Database | `supabase/migrations/0001_rebuild.sql` | additive-safe migration, legacy rename, RLS lockdown, rollup fn |
| Live Monitor | `website/live-monitor/` | config/api/state/table/charts/infographics/events/graphics/diagnostics/app |
| Doctor Portal | `website/doctor/` | clinician view of the same backend data |
| Public site | `website/index.html` | story only — zero patient data |

## What was removed (do not resurrect)

- ESP32 → Supabase direct POSTs with anon key + `setInsecure()`
- ESP32 `/data` HTTP endpoint + laptop poller + local dashboard (design-era
  artifacts in old docs — never built, docs rewritten)
- Blynk / Firebase architectures (legacy dashboard archived to `legacy/`)
- Manual telemetry entry form, manual medication dose form (live monitor)
- `nl_outbox` localStorage cross-page handoff → public site patient cards
- Whole-store localStorage per-patient database (`store.js`)
- Disease-band tremor labels on the device ("PD"/"ET" → band-activity only)
- Demo-day synthetic generator in the production path (`?mode=demo` is the
  only demo path, isolated and labelled)
