# PD-SENSE — Live Monitor (dashboard)

`website/live-monitor/`. Engineering instrumentation console for the
device. Served by the backend at `/live-monitor/` (or any static server;
set `?api=http://<backend>:3000&token=…` when opened from file://).

## Data flow

ESP32 → backend → Supabase → backend → **api.js** → **state.js**
(normalized contract) → table.js + charts.js + infographics.js +
events.js + graphics.js. One reading update touches every surface from
the same record; no module re-interprets the database by itself.

## What shows

- Header: patient, device, LIVE / STALE / OFFLINE / last packet age.
- Live system visualization: the telemetry pipeline; a packet crosses it
  at each real ingest; movement-trace amplitude follows the tremor index;
  a cadence heartbeat runs at the measured cadence; a FREEZE stalls the
  trace; backend loss flips link states. (Optional 3-D device model when
  THREE.js loads; SVG fallback otherwise.)
- Current metrics (tremor / frequency / gait / cadence / bradykinesia),
  each with an (i) explanation drawer — WHAT / SOURCE / HOW / UPDATE /
  QUALITY / LIMITATIONS. Values go to N/A when quality ≠ VALID.
- Live signals: charts for tremor, dominant frequency, cadence, jerk,
  IMU RMS (null gaps; never connects through missing data).
- Events timeline: freeze, possible_fall, medication_event,
  tap_test_completed, alerts (typed icons, ack buttons for open alerts).
- **LIVE ESP32 READINGS table**: newest-first packets, optional columns
  (Event ID / Device / Seq / RMS / Freeze / Source), pagination
  (25/50/100 + Load more via backend cursor), range filter, new-row
  highlight, "NEW DATA — n RECORDS" banner (no scroll hijack), row click
  → READING DETAILS (timestamps, ingest latency, all real fields),
  CSV export (server-side data).
- Device health panel + history summary (range-scoped), with data-gap
  reporting and neutral summary language.

## Flags

- `?mode=demo` — presentation mode with synthetic data, clearly badged
  "DEMO DATA". The ONLY synthetic path; default is real device data.
- `?debugData=true` — API → normalized → render diagnostics panel.
- `?debugGraphics=true` — FPS/frame/packet HUD.

## Removed (do not reintroduce)

Manual telemetry entry, manual medication dose logging, `nl_outbox`
publish-to-public-site, localStorage patient database, legacy CDN summary
exporter, legacy brain hero (moved to nothing — replaced by the system
pipeline scene), webserial reader (dead code), environmental channels no
hardware produces.
