# PD-SENSE API — reference

Base URL: `http://<backend-host>:3000`. JSON everywhere unless noted.
Error body shape: `{ "error": "message", "pgcode": "…"? }`.

## Auth model

| Endpoint group | Auth |
|---|---|
| `GET /api/health*` | none |
| `POST /api/v1/telemetry` | device: `X-Device-Id` + `X-Device-Token` |
| all other `/api/v1/*` | dashboard: `Authorization: Bearer <DASHBOARD_TOKEN>` (or `?access_token=` for SSE/CSV) |

## Endpoints

| Method | Path | Params / body | Response |
|---|---|---|---|
| GET | `/api/health` | — | `{status:"ok", service, time}` |
| GET | `/api/health/database` | — | `{database:"connected"}` or 503 |
| POST | `/api/v1/telemetry` | body = telemetry or event packet (schema v2, see FIRMWARE_TELEMETRY.md) | `200 {status:"stored"\|"already_processed", event_id}` · 400 validation · 401 device auth |
| GET | `/api/v1/readings/latest` | `patient_id` | `{data: row\|null, freshness:{state,age_ms}}` |
| GET | `/api/v1/readings` | `patient_id, device_id, limit(≤500, dflt 50), before(cursor), from, to, range(1h/24h/48h/7d/30d)` | `{data:[row…], next_cursor, count}` newest-first, keyset pagination |
| GET | `/api/v1/events` | `patient_id, device_id, type, limit, before, from, to, range` | `{data:[event…], next_cursor, count}` |
| GET | `/api/v1/alerts` | `patient_id, status, limit, from, to, range` | `{data:[alert…], count}` |
| PATCH | `/api/v1/alerts/:id` | `{status: open\|acknowledged\|resolved\|delivery_failed}` | `{data: alert}` |
| GET | `/api/v1/medication-events` | `patient_id, limit, from, to, range` | `{data:[…]}` |
| GET | `/api/v1/tap-tests` | `patient_id, limit, from, to, range` | `{data:[…]}` |
| GET | `/api/v1/devices` | — | `{data:[{device_id,patient_id,enabled,firmware_version,last_seen_at,…}]}` |
| POST | `/api/v1/devices` | `{device_id, patient_id, token, enabled}` — registers/rotates | `201 {status:"registered"}` |
| PATCH | `/api/v1/devices/:id` | `{enabled? , patient_id?, token?}` | `{status:"updated"}` |
| GET | `/api/v1/devices/:id/status` | — | device + `freshness` + `latest` reading |
| GET | `/api/v1/patients` | — | patients + devices + freshness roll-up |
| GET | `/api/v1/patients/:id/summary` | `range\|from,to` (default 7d) | doctor summary (DATA_MODEL.md) |
| GET | `/api/v1/patients/:id/analytics` | `range\|from,to, buckets` (dflt 48) | `{buckets:[…], gaps:[…], reading_count, rollup_buckets}` |
| GET | `/api/v1/export/readings.csv` | `patient_id, device_id, from, to, range` | CSV download (≤50 000 rows) |
| GET | `/api/v1/stream` | — | SSE: `event: reading|event|alert`, heartbeat every 15 s |

## Freshness classification (device liveness)

| State | Rule (configurable via env) |
|---|---|
| `online` | last packet < 45 s (`FRESH_ONLINE_MS`) |
| `stale` | 45–120 s (`FRESH_STALE_MS`) |
| `offline` | > 120 s |
| `never_seen` | no telemetry ever |

## Idempotency

Every ingest packet requires `event_id` (`<deviceId>-<bootId>-<sequence>`).
The database enforces uniqueness. A retried POST returns
`{"status":"already_processed"}` with HTTP 200 and writes nothing.

## Validation (400 rejects)

Non-finite numbers, out-of-range values (tremor 0–10, freq 0–64 Hz,
cadence 0–8 Hz, …), missing `event_id`/`device_id`/`sequence`, wrong
`schema_version` (must be 2), unknown `event_type`, `tremor_score`
present while `tremor_quality != VALID` (server nulls it), grade on an
INCOMPLETE tap test (server nulls it), oversized payloads (> 4 KB).
