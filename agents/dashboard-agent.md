# Agent scope: Local Wi-Fi Dashboard

Full spec: [`../docs/DASHBOARD.md`](../docs/DASHBOARD.md).

## You own

- The single HTML/CSS/JS page served by the ESP32's web server (not hosted
  anywhere external — it is served from device flash/memory).
- Its `fetch('/data')` polling loop (~300 ms) and how it renders mode,
  tremor score, bradykinesia grade, and gait status.

## You do NOT own

- The `/data` endpoint itself or its schema — that's `firmware-agent.md`.
  Treat the schema as a fixed external contract; if it needs to change,
  that's a firmware-spec change first.
- Any account, login, or per-user view. This dashboard has exactly one
  audience state: whoever is on the Wi-Fi and opens the IP. No auth layer.
- Historical data or trends. That's the doctor website's job. This page
  only ever shows the current instant.

## Hard constraints

1. **No build step, no framework, no CDN dependency that could be
   unavailable offline.** This runs off an ESP32's local server for a
   classroom/demo evaluator — plain HTML/CSS/vanilla JS only, embedded
   directly, so it works with zero internet access.
2. **Poll interval ~300 ms.** Faster adds load to the ESP32's single-core
   HTTP handling for no benefit; slower feels laggy against a live tremor
   reading.
3. **Fail visibly, not silently.** If a poll fails (device busy, Wi-Fi
   blip), show a clear "reconnecting" state rather than freezing on stale
   numbers with no indication they're stale.
4. **Legible at a glance from across a room.** This will be read by a
   teacher or evaluator standing near a table, often on a phone screen
   mirrored or a laptop — not a design showcase. Prioritize large, clear
   current-value display over decoration.

## Definition of done for this piece

- Opening the ESP32's IP in any modern browser on the same Wi-Fi shows
  live-updating mode, tremor score, bradykinesia grade, and gait status
  with no installed app.
- A momentary Wi-Fi drop shows a visible "reconnecting" indicator, not a
  frozen or blank screen.
