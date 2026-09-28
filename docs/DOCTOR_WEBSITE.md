# PD-SENSE — Doctor Portal

`website/doctor/`. Clinician-oriented, read-only review of the same
backend data the Live Monitor shows. Served at `/doctor/` by the backend.

## Panels

- **Status**: patient, registered devices, freshness (online/stale/
  offline/never_seen), last telemetry age.
- **Summary** (range-scoped): period + reading count + data gaps, tremor
  statistics from VALID windows, freeze counts vs prolonged-freeze alerts,
  tap-test history, medication gesture events with **observational
  alignment notes** ("a lower tremor index was observed after the recorded
  medication event … this does not establish causation"), alert list.
- **Trends**: bucketed avg/max for tremor index, dominant frequency,
  cadence (older-than-48 h history merges from `reading_rollups`; buckets
  with no data stay empty).
- **Events**: freeze episodes, fall candidates (labelled candidates),
  alerts with severity + status.
- **Medication events**: device gesture records (no dose/metadata —
  no such data exists in the system).
- **Tap tests**: completeness-respecting table (INCOMPLETE has no grade).
- **Recent readings**: newest 50 rows; CSV export of the range.

## Data rules

- All content comes from `GET /api/v1/...` with the dashboard token.
- Sustained-condition math NEVER treats end-of-data as proof (see
  server/src/services/summaryService.js + regression tests).
- Neutral language only: observed / recorded / measured / insufficient
  data. The portal provides data for a clinician; it is not a diagnostic.

## Access

Same `DASHBOARD_TOKEN` as the Live Monitor (`?token=…` once per browser).
There is no separate login system in this prototype — see
docs/SECURITY.md for the honest scope and what production would add.
