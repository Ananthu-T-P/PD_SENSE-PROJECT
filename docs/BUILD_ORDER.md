# PD-SENSE — Build order & status

The v7 rebuild executed the full stack in dependency order:

1. ✅ Repository audit → `docs/CURRENT_STATE.md`
2. ✅ Firmware: config / sensors / display / telemetry / coordinator
   (state machines, serial console, OLED pages, telemetry queues,
   dev-mode gating)
3. ✅ Backend API (`server/`): health, device auth, ingest (idempotent),
   reads, SSE, CSV, patients/summary/analytics, device registry seeding
4. ✅ Database migration `supabase/migrations/0001_rebuild.sql` + RLS
   lockdown + rollup function for the new schema
5. ✅ Live Monitor rebuild (real-data-only, normalized contract, table/
   charts/infographics/events/pipeline visualization)
6. ✅ Doctor Portal (`website/doctor/`)
7. ✅ Public site: patient feed removed, story-only
8. ✅ Legacy isolation (`legacy/`, `supabase/legacy/`); dead modules deleted
9. ✅ Backend automated tests (22 pass); syntax sweeps; boot smoke test
10. ✅ Docs: API / DATA_MODEL / DEPLOYMENT / TROUBLESHOOTING / SECURITY /
    SERIAL_COMMANDS / FIRMWARE_TELEMETRY + this file
11. ⏳ **Hardware validation — REQUIRED, not done (no device attached here)**:
    flash the firmware, run `test all`, walk through network-loss and
    tap/medication/freeze scenarios (checklist in TESTER.md)
12. ⏳ **With-credentials end-to-end**: fill Supabase keys + device token,
    confirm ESP32 → backend → DB → live monitor on the bench
    (docs/TROUBLESHOOTING.md checkpoint list)

## What remains intentionally out of scope

- On-device TinyML classifiers, LLM chatbot features (not part of v7).
- Per-user clinical account auth (prototype uses a shared dashboard token).
- Public-site scroll animation rework (see FIX_REPORT known limitations).
