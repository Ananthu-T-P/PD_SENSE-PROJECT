# SESSION_HANDOFF — v7 rebuild complete (code side)

## What changed in this session (full detail: docs/FIX_REPORT.md)

- **Root cause class of "ESP32 reads, website shows nothing"**: the old
  chain had no backend and no observability — device POSTs could fail
  unseen, and the browser had no way to show which hop broke. Rebuilt as
  ESP32 → PD-SENSE backend → Supabase → dashboards, with per-layer
  self-reporting (`test api`, `/api/health*`, `?debugData=true`).
- Firmware v7.0-rebuild: state machines, serial diagnostic console
  (help/status/test all/…), paged OLED UI, generated event_id telemetry
  with bounded queues + backoff, dev simulation compile-gated, calibration
  failure detection, FREEZE_CANDIDATE/RECOVERY states surfaced exactly
  from the existing validated timers, tap/freeze/medication events now
  REACH the server.
- Backend `server/`: Express; device token auth (registry-derived
  patient); strict schema-v2 validation; idempotent ingest; SSE;
  CSV export; backend-owned alerts with DB cooldown; summaries with the
  end-of-data bug fixed (regression-tested); 22/22 node tests pass.
- Database: `supabase/migrations/0001_rebuild.sql` — patients, devices,
  readings, events, tap_tests, medication_events, alerts,
  reading_rollups; anon locked out (RLS); legacy tables renamed.
- Live Monitor: rebuilt. Manual entry + manual med logging + localStorage
  DB + nl_outbox + brain hero REMOVED | normalized reading contract,
  LIVE ESP32 READINGS table, charts, infographics, data-driven pipeline
  visualization, demo mode isolated behind ?mode=demo.
- Doctor Portal: new, `website/doctor/`, backend-driven.
- Public site: patient feed removed entirely (story only).
- Legacy: root Firebase dashboard → `legacy/`; v1 supabase scripts →
  `supabase/legacy/`; old agent briefs carry a superseded banner.

## To bring the system live (you, the human, ~15 min)

1. Supabase SQL Editor → run `supabase/migrations/0001_rebuild.sql`.
2. `cd server && copy .env.example .env` → fill SUPABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_TOKEN, DEVICE_SEED. `npm start`.
3. Edit firmware `config.h` (WiFi, API_BASE_URL=http://<laptop-ip>:3000,
   DEVICE_TOKEN = the DEVICE_SEED token) → flash → `test all`.
4. Open `http://<laptop-ip>:3000/live-monitor/?token=<DASHBOARD_TOKEN>`.
5. Rotate the WiFi password + anon key that used to live in the repo
   (docs/SECURITY.md §rotation).

## Not done (explicitly)

- Physical hardware tests: REQUIRE PHYSICAL HARDWARE VALIDATION
  (checklist: TESTER.md).
- With-credentials end-to-end run (needs Supabase creds).
- Public-site scroll scene is unchanged (visual identity decision left
  to the owner; see FIX_REPORT → Known limitations).
