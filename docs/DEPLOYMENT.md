# PD-SENSE — Deployment (zero to running system)

## 0. Prerequisites

- Node.js 18.17+ on the machine that will run the backend (demo laptop).
- Supabase project (free tier is fine).
- Arduino IDE with the MYOSA libraries (AccelAndGyro, LightProximityAndGesture,
  oled), arduinoFFT, SimpleKalmanFilter, ESP32 board package.

## 1. Database — run the migration ONCE

Supabase Dashboard → SQL Editor → paste all of
`supabase/migrations/0001_rebuild.sql` → Run.

- Legacy `readings`/`alerts`/`readings_rollup` tables are renamed to
  `*_legacy_v1` automatically (not deleted; review and drop manually later).
- New tables: patients, devices, readings, events, tap_tests,
  medication_events, alerts, reading_rollups. RLS denies anon access.

## 2. Backend

```powershell
cd server
copy .env.example .env     # then edit .env:
#  SUPABASE_URL=https://<project-ref>.supabase.co
#  SUPABASE_SERVICE_ROLE_KEY=<service-role key>   (Project Settings -> API)
#  DASHBOARD_TOKEN=<pick a demo password>
#  DEVICE_SEED=pd-sense-01:<device-token-you-pick>:P-001
npm install
npm start
```

Backend serves:
- API → `http://<laptop-ip>:3000/api/...`
- Live Monitor → `http://<laptop-ip>:3000/live-monitor/`
- Doctor Portal → `http://<laptop-ip>:3000/doctor/`
- Public site → `http://<laptop-ip>:3000/`

Find the laptop LAN IP: `ipconfig` → IPv4 Address.

## 3. Firmware

Edit `firmware/NeuroLoop_Core/config.h` (locally — do not commit):

```
#define WIFI_SSID    "your hotspot"
#define WIFI_PASS    "your password"
#define API_BASE_URL "http://<laptop-ip>:3000"
#define DEVICE_ID    "pd-sense-01"
#define DEVICE_TOKEN "<same token as DEVICE_SEED in .env>"
```

Flash. Open Serial Monitor @ 115200 → type `help`, then `test all`.

The device boots → calibrates (hold still, 5 s countdown) → monitors.
No serial input is required for normal operation.

## 4. Dashboards

Open `http://<laptop-ip>:3000/live-monitor/?token=<DASHBOARD_TOKEN>`.
The token is remembered as a browser preference (never sent to the
database directly; it only talks to the backend).

## 5. Rollup job (storage hygiene, optional in a demo)

Either enable pg_cron and schedule `select public.rollup_readings(48)`
daily, or call it from any scheduler (cron-job.org) via a tiny POST to a
Supabase Edge Function / or run from SQL Editor manually:
`select * from public.rollup_readings(48);`
(see `supabase/legacy/edge-function-rollup` for the previous version —
a new Edge Function can reuse it against the same RPC name).

## 6. Failure expectations (designed behavior)

| Failure | Expected behavior |
|---|---|
| WiFi drops | Device keeps sensing; queue holds 12 telemetry + 8 event packets; OLED → `NET ×`/`UPLOAD PENDING`; dashboard goes STALE → OFFLINE |
| Backend down | Device queues; serial `NET` reports BACKEND_OFFLINE; reconciles on return |
| Queue overflow | Oldest dropped, `queue_dropped`++ shown on OLED system page + serial status (TELEMETRY LOSS) |
| Dashboard token wrong | HTTP 401 from backend; no data |
| Device token wrong | HTTP 401; firmware serial prints rejection; `test api` FAILs |
