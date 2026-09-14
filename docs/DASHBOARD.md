# Local Wi-Fi Dashboard Spec

## Purpose

Let anyone on the same Wi-Fi network as the wristband — a teacher, an
evaluator, a caregiver — see live readings by opening the ESP32's local IP
address in any browser. No app install, no account, no internet
connection required.

## What it shows

Polls `GET /data` (see `FIRMWARE.md` for the frozen schema) roughly every
**300 ms** via `fetch()`, and renders:

- Current mode (`IDLE` / `TREMOR_TEST` / `TAP_TEST` / `GAIT_TEST` /
  `MANUAL`)
- Tremor score
- Bradykinesia grade
- Gait status

## What it explicitly does not show

- History or trends — that's the doctor website's job, not this page's.
- Any per-user or login-gated view — one page, one audience: whoever is on
  the network right now.
- Alerts or medication logs.

## Implementation constraints

- **Single static page served from the ESP32 itself.** Plain HTML, CSS,
  and vanilla JavaScript, embedded in firmware or served from onboard
  storage — no build step, no external CDN dependency, since this has to
  work with zero internet access, only the local Wi-Fi.
- **Poll, don't stream.** A plain `setInterval` + `fetch('/data')` loop is
  sufficient and keeps load on the ESP32's HTTP handler predictable.
- **Show connection state honestly.** If a poll fails or times out, show a
  visible "reconnecting…" state rather than leaving the last-known values
  on screen with no indication they're stale.

## Layout guidance

This is a status readout, not a marketing page — see `website/WEBSITE.md`
for the project's actual design system, which does not apply here. For the
dashboard, prioritize:

- Large, legible current values (mode and scores should be readable from
  arm's length on a phone screen).
- A clear visual state change when `evaluateAndAct()` fires (e.g. tremor
  score crossing into "high"), so an evaluator watching the dashboard
  during a demo can visually confirm the buzzer/actuator response matches
  what's on screen.
- No unnecessary chrome, animation, or branding — this page's only job is
  legibility under classroom/demo conditions.
