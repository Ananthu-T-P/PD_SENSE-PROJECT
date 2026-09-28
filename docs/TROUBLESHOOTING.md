# PD-SENSE — Troubleshooting

> The design rule this rebuild enforces: **every layer must self-report.**
> Work from the device outward; never guess a hop.

## The 11 checkpoints

```
1 MPU6050 ───────────────────────────────┐ firmware serial: test imu
2 WiFi        firmware serial: test wifi │
3 TLS/policy  firmware config review     │
4 HTTP POST   firmware serial: watchdog of NET lines / test api
5 backend     GET /api/health            ══ Browser devtools / curl
6 database    GET /api/health/database   ══
7 API shape   /api/v1/readings/latest    ══
8 normalize   live monitor ?debugData=true  → "Latest NORMALIZED reading"
9 render      same panel → "Readings held" counter
10 charts     gap-free lines require VALID quality windows
11 animation  ?debugGraphics=true packet counter moves only on real ingest
```

## Symptom → action

### "ESP32 reads data, website shows nothing" (the original bug)
1. Device serial: `status` → check `Backend: ONLINE?`, `last success`,
   `failed` counter.
2. `test api` — FAIL → fix WiFi/API_BASE_URL/token (check `test wifi`).
3. Backend: `GET /api/health/database` — 503 → missing/wrong Supabase
   service key or migrations not applied (`[seed] failed` lines at boot).
4. Browser: open live monitor with `?debugData=true&token=…` —
   the debug panel shows backend state, latest API row and the
   normalized object side by side. If readings arrive but charts are
   empty → quality ≠ VALID windows; that is the device reporting
   contamination, not a frontend bug.

### WiFi connects but uploads 401
Device token mismatch. `.env` `DEVICE_SEED=pd-sense-01:TOKEN:P-001` must
use the SAME token as firmware `DEVICE_TOKEN`. Changing either requires
a backend restart (seed upsert) or `POST /api/v1/devices` rotation.

### Dashboard 401 in the browser
Wrong/missing dashboard token → reopen with `?token=<DASHBOARD_TOKEN>`.
(The token is stored as a UI preference; it never enters the database.)

### OLED garbled / frozen
OLED fault never stops sensing. `test oled`; check I2C 0x3C in `test i2c`.

### Freeze alerts never fire in the first 10 minutes
Fixed in v7 (explicit has-alerted flag + DB-backed backend cooldown).
If seen, dump `events` and check the alert insert response in backend log.

### "Duplicate rows"
Impossible by construction (event_id UNIQUE + already_processed). If a
duplicate appears, you are looking at legacy `readings_legacy_v1` data.

### Tap grade never appears on the website
Only COMPLETE tests carry a grade (by rule). Check the EVENTS timeline
for the tap_test_completed card, and serial `EVT TAP result: ...`.

### Time looks wrong on rows
`received_at` is the authoritative ingest clock. Device `ts` is only
meaningful after NTP sync (`status` → `NTP: SYNCED`). Queued packets
during an outage arrive late — that ordering is real; the chart uses
device `ts`, the badge/freshness uses `received_at`.

### Backend won't start
`[config] FATAL: missing/placeholder env` → fill `.env` (see
docs/DEPLOYMENT.md §2). `[seed] failed` → run the migration in
supabase/migrations/0001_rebuild.sql first.

### Live Monitor opened from file://
Set the API base once: `?api=http://<laptop-ip>:3000&token=…` (both are
remembered as UI preferences). Prefer serving via the backend instead.
