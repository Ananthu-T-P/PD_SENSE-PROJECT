# PD-SENSE — Parkinson's Motor-Signal Monitoring Wristband (NeuroLoop)

A wrist-worn **movement-signal monitor** prototype built on the MYOSA ESP32
kit (MPU6050 + APDS9960 + SSD1306 OLED + buzzer + haptic). The device keeps
real-time fold of tremor-band activity, gait/freeze state, cadence, tap
tests and medication-gesture events, and streams **summarized telemetry**
to the PD-SENSE backend; the Live Monitor and Doctor Portal read the same
stored record.

> PD-SENSE records and displays motion signals for engineering evaluation.
> It does not diagnose, rate disease, or confirm falls or medication intake.

## Pipeline (the actual one)

```
real IMU/gesture → ESP32 sensor processing → telemetry queue
   → POST /api/v1/telemetry (device token) → PD-SENSE backend
   → validation + idempotent ingest → Supabase (RLS-locked)
   → Live Monitor & Doctor Portal (dashboard token; REST + SSE)
```

## Repository

| Path | What it is |
|---|---|
| `firmware/NeuroLoop_Core/` | ESP32 firmware (v7.0-rebuild) |
| `server/` | Node.js backend API (the only database credential holder) |
| `supabase/migrations/` | database migrations (`0001_rebuild.sql`) |
| `supabase/legacy/` | superseded v1 schema (kept for reference) |
| `website/live-monitor/` | technician live console |
| `website/doctor/` | doctor portal |
| `website/index.html` | public marketing/technical site (no patient data) |
| `assets/` | photos/video of the physical build |
| `legacy/` | archived Firebase-era dashboard |
| `docs/` | current documentation (start with ARCHITECTURE.md) |

## Quick start

1. **Database**: run `supabase/migrations/0001_rebuild.sql` in the Supabase
   SQL editor.
2. **Backend**: `cd server && copy .env.example .env`, fill Supabase service
   key + dashboard token + device seed, `npm install && npm start`.
3. **Firmware**: fill `firmware/NeuroLoop_Core/config.h` (WiFi, API base URL,
   device token), flash, open Serial @115200, type `test all`.
4. **Dashboards**: `http://<backend>:3000/live-monitor/?token=…` and
   `/doctor/?token=…`.

Details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md)

## Document map

| File | Purpose |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | current system architecture |
| [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) | pre-rebuild audit baseline |
| [`docs/FIX_REPORT.md`](docs/FIX_REPORT.md) | what was broken → what changed → test results |
| [`docs/FIRMWARE.md`](docs/FIRMWARE.md) | firmware design |
| [`docs/FIRMWARE_TELEMETRY.md`](docs/FIRMWARE_TELEMETRY.md) | wire schema v2, queues, TLS |
| [`docs/SERIAL_COMMANDS.md`](docs/SERIAL_COMMANDS.md) | diagnostic console reference |
| [`docs/DASHBOARD.md`](docs/DASHBOARD.md) | live monitor |
| [`docs/DOCTOR_WEBSITE.md`](docs/DOCTOR_WEBSITE.md) | doctor portal |
| [`docs/API.md`](docs/API.md) | backend endpoint reference |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | tables + contracts |
| [`docs/ALERTS.md`](docs/ALERTS.md) | backend-owned alert policy |
| [`docs/SECURITY.md`](docs/SECURITY.md) | trust model + credential rotation |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | set-up runbook |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | layer-by-layer fault finding |
| [`TESTER.md`](TESTER.md) | hardware/acceptance checklist |
| [`website/WEBSITE.md`](website/WEBSITE.md) | public site notes |
