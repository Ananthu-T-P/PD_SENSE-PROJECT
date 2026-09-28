# PD-SENSE — Firmware telemetry (schema_version 2)

## Transport

```
ESP32 --POST <API_BASE_URL>/api/v1/telemetry--> backend
headers: X-Device-Id, X-Device-Token, Content-Type: application/json
```

- No Supabase keys on the device. The backend validates the device token
  (sha256 hash in `devices`) and derives `patient_id` itself.
- Every packet: `schema_version: 2`, unique `event_id`, `device_id`,
  monotonic `sequence`, always `device_ms` (millis()), plus `timestamp`
  (UTC ISO) only once NTP syncs (`pool.ntp.org`).
- Responses: `200 {"status":"stored"}` or `200 {"status":"already_processed"}`
  (duplicate event_id) — both mean *stop retrying this packet*.
  4xx/5xx/network error → keep packet, back off, retry.

## Cadence

- **Telemetry summary**: one packet per `UPLOAD_INTERVAL_MS` (15 s).
  The packet is a SNAPSHOT of current processed state (score, quality,
  gait, cadence…) plus health metadata. 100 Hz raw samples never leave
  the device.
- **Events**: queued the moment they happen (freeze close,
  tap_test_completed, medication_event, possible_fall) and drain FIRST
  (before telemetry) when connectivity returns.

## Queues (bounded static FIFO, no heap churn)

- 12 telemetry slots × 420 B + 8 event slots × 560 B.
- Overflow: drop OLDEST, `queue_dropped++`, serial prints
  `TELEMETRY LOSS`, OLED → `UPLOAD PENDING` / system page shows loss.
- Retry: 5 s → 10 s → 20 s → … capped at 60 s (`TLM_RETRY_BASE_MS/MAX`).
  HTTP calls are hard-timed-out at `HTTP_TIMEOUT_MS` (5 s) and the task
  watchdog is fed around them.

## WiFi management

- Paced FSM: CONNECTING → WIFI_UP → BACKEND_ONLINE/OFFLINE.
- `WiFi.begin()` once at boot; reconnect attempts at most every
  `WIFI_RECONNECT_GAP_MS` (20 s); link checks every `WIFI_CHECK_MS` (5 s).
- NO background network scanning in production (scan only in `test wifi`).
- Modem sleep off (`WiFi.setSleep(false)`) — hotspots otherwise drop
  the device between 15 s uploads.

## TLS

Two honest modes (`config.h`):
- LAN HTTP (default demo): `API_BASE_URL=http://<laptop-ip>:3000` —
  documented cleartext limitation, trusted LAN only.
- HTTPS: set `API_ROOT_CA_PEM` (full validation), or set
  `ALLOW_INSECURE_TLS 1` as a labelled prototype fallback.

## What the device deliberately does NOT send

- Patient id (registry-derived server-side).
- Tremor score/frequency when the window isn't VALID (sends null + quality).
- Raw 100 Hz IMU streams (not part of normal telemetry — the table’s
  “raw” columns show the derived per-window values that were transmitted).
- Medication details (name/dose/mg): a gesture event is only
  `{gesture, timestamp}` — the device records an event, not an intake.
- Continuous bradykinesia scores (a grade exists only after a tap test).
