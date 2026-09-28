# PD-SENSE — Data model

## Storage (Supabase/Postgres) — `supabase/migrations/0001_rebuild.sql`

### patients
| id (text, PK) | display_name | external_ref | created_at | updated_at |

### devices — the registry that maps device → patient
| device_id (PK) | patient_id FK | enabled | token_hash (sha256) | firmware_version | last_seen_at | created_at | updated_at |

### readings — one row per summarized device telemetry window (~15 s)
| column | meaning |
|---|---|
| event_id UNIQUE | `<deviceId>-<bootId>-<sequence>` — dedupe for retries |
| device_id / patient_id FK | registry-derived |
| ts | device NTP time when synced, else ingest time |
| received_at | backend ingest clock (authoritative) |
| schema_version (=2), sequence, device_ms | wire bookkeeping |
| tremor_score (real, nullable) | band-activity index 0–10 — NULL unless quality=VALID |
| dominant_frequency_hz (real, nullable) | same rule |
| tremor_quality | VALID / LOW_SIGNAL / MOTION_CONTAMINATED / INVALID |
| imu_rms, jerk_peak | g, g/s |
| gait_state | REST / WALKING / FREEZE_CANDIDATE / FREEZE / RECOVERY |
| cadence_hz, freeze_active | |
| uptime_ms, queue_depth, queue_dropped, rssi | device health carries itself |
| sensor_imu, sensor_apds | OK / FAULT |
| fw_version, source ('device'), created_at | |

### events — discrete episodes (NOT continuous readings)
| event_id UNIQUE | event_type (freeze / possible_fall / medication_event / tap_test_completed) | ts / received_at / device_ms | duration_ms | severity (info/warning/critical) | payload jsonb | source |

payload contents:
- freeze: `{}` (duration_ms carries it)
- possible_fall: `{jerk_peak, still_ms}` — a candidate, never "confirmed fall"
- medication_event: `{gesture}` — record of a gesture, not proof of intake
- tap_test_completed: `{tap_count, target_count, quality, bradykinesia_grade|null, bradykinesia_label}`

### tap_tests / medication_events
Typed mirrors of the corresponding events (event_id UNIQUE, same dedupe),
indexed for clinical review. Incomplete tests: grade NULL, label
INCOMPLETE — a check constraint enforces it.

### alerts — backend-owned, lifecycle-tracked
| patient_id, device_id | ts | event_type (prolonged_freeze/possible_fall/high_tremor) | severity | detail | status (open/acknowledged/resolved/delivery_failed) | detected_at |

Alerts derive from events/telemetry server-side with a DB-backed per-type
cooldown (10 min default) — the first qualifying episode after boot is
always allowed; a failed delivery never burns the cooldown.

### reading_rollups — 10-minute aggregates for data older than 48 h
avg/max_tremor_score (VALID windows only), avg_dominant_frequency_hz,
avg_cadence_hz, freeze_events (row count flagged), valid_share, reading_count.
Discrete values (grades, states) are never averaged. Field semantics are
documented inline in the migration.

## Wire contracts (device → backend) — schema_version 2

### telemetry packet
```json
{
  "schema_version": 2, "type": "telemetry",
  "event_id": "pd-sense-01-3fa91b2c-42",
  "device_id": "pd-sense-01", "device_ms": 905012, "sequence": 42,
  "timestamp": "2026-09-28T11:20:49Z",          
  "tremor_score": 4.88, "dominant_frequency_hz": 4.79, "tremor_quality": "VALID",
  "imu_rms": 0.0421, "jerk_peak": 0.73,
  "gait_state": "WALKING", "cadence_hz": 1.71, "freeze_active": false,
  "sensors": {"imu":"OK","apds":"OK","oled":"OK"},
  "network": {"rssi": -61},
  "uptime_ms": 906000, "queue_depth": 0, "queue_dropped": 0, "fw": "7.0-rebuild"
}
```
`timestamp` is present only when NTP has synced; `device_ms` + backend
`received_at` are always available. When quality ≠ VALID the tremor pair
is null — invalid data never travels as a zero.

### event packet
```json
{
  "schema_version": 2, "type": "event", "event_type": "freeze",
  "event_id": "...", "device_id": "...", "device_ms": 94210, "sequence": 43,
  "duration_ms": 8400, "severity": "warning", "source": "device",
  "payload": {}
}
```

## Normalized frontend contract (Live Monitor)

Exactly one shape feeds the table, charts, infographics and animation
(`website/live-monitor/js/state.js` — the only adapter):

```js
{ event_id, id, timestamp, received_at, ingest_latency_ms,
  device_id, patient_id, sequence,
  tremor_score, dominant_frequency_hz, tremor_quality,
  imu_rms, jerk_peak, gait_state, cadence_hz, freeze_active,
  rssi, uptime_ms, queue_depth, queue_dropped,
  sensor_imu, sensor_apds, source }
```

Events: `{ event_id, event_type, timestamp, received_at, duration_ms,
severity, device_id, patient_id, source, payload }`.

## Retention

Fresh rows live in `readings`. `rollup_readings(48)` (pg_cron or a
scheduler) aggregates rows older than 48 h into `reading_rollups` and
deletes the originals. `events`, `tap_tests`, `medication_events` and
`alerts` are kept at full resolution forever by design.
