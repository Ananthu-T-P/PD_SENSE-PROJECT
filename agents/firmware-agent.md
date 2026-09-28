<!--
 SUPERSEDED — v7 rebuild
 ---------------------------------------------------------------------------
 This agent brief described the PRE-REBUILD architecture (ESP32 `/data`
 endpoint, laptop poller, local-only device, Blynk-era constraints). Those
 contracts no longer exist.

 Current source of truth:
   docs/ARCHITECTURE.md  — system diagram + rules
   docs/FIRMWARE.md, docs/FIRMWARE_TELEMETRY.md, docs/SERIAL_COMMANDS.md
   docs/API.md, docs/DATA_MODEL.md, docs/DASHBOARD.md, docs/DOCTOR_WEBSITE.md
   docs/SECURITY.md, docs/DEPLOYMENT.md, docs/TROUBLESHOOTING.md
 Build state: docs/BUILD_ORDER.md · audit baseline: docs/CURRENT_STATE.md
-->
# Agent scope: ESP32 Firmware

Full spec: [`../docs/FIRMWARE.md`](../docs/FIRMWARE.md). This file is the
condensed, actionable version for whoever (or whatever) is writing code.

## You own

- The firmware under `firmware/NeuroLoop_Core/` (`NeuroLoop_Core.ino`,
  `config.h`, `sensors.h/.cpp`, `display.h/.cpp`) running on the MYOSA
  ESP32 stack.
- The state machine (`IDLE`, `TREMOR_TEST`, `TAP_TEST`, `GAIT_TEST`,
  `MANUAL`), its serial keyboard shortcuts (`1`/`2`/`3`/`4`/`0`), and the
  timed test window + auto-return-to-idle behavior.
- Manual data-entry parsing (comma-separated serial input).
- `evaluateAndAct()` — the single scoring?response function.

## Deferred to the networking layer (do NOT add in the core version)

- WiFi setup of any kind, the `WebServer.h` `/data` endpoint, the local
  dashboard, email/WhatsApp/Blynk or any other cloud dependency. These
  come later as new files on top of this codebase; the core version must
  keep building and running with zero network hardware expectations.

## You do NOT own

- Anything that leaves the local Wi-Fi network. No SMTP, no Twilio, no
  CallMeBot calls from firmware — that's `alerts-agent.md`'s job, running on
  the doctor-website side.
- The dashboard's HTML/JS/CSS content — you serve it, but its design lives
  in `dashboard-agent.md`.
- Any ML model or classifier. FFT-only tremor detection for this scope.

## Hard constraints

1. **Throttle serial output to ~200 ms**, not the raw 50 Hz sample rate.
   This is the direct fix for the original bug (serial monitor scrolling
   too fast to read). Never regress to raw-rate printing.
2. **Test windows are timed** (e.g. 15 s) and auto-return to `IDLE` with a
   reset delay afterward. Do not let a test mode run indefinitely.
3. **Manual mode feeds the same `evaluateAndAct()` path as real sensor
   data.** A manually typed `"8,3,freeze"` must trigger the identical
   buzzer/actuator behavior a real high-tremor, freeze-of-gait reading
   would. Do not fork the logic.
4. **`/data` is the only external contract — and it belongs to the later
   networking layer, not this version.** Its JSON schema (mode, tremor
   score, bradykinesia grade, gait status — see `FIRMWARE.md`) is what the
   dashboard, poller, analytics, and chatbot will consume. Keep the core
   version's live values in the `SensorState` / result variables the
   networking layer will read; do not wire any HTTP code into the core.
5. **No cloud calls, no persistent storage on-device.** The ESP32 reports
   current state only; it is not a database.

## Definition of done for the core version

- Typing `1`, `2`, `3`, or `4` on serial starts the matching test and it
  auto-ends after its window (with a result-hold delay); `0` returns to
  idle at any time.
- Typing a manual CSV line while in `MANUAL` mode produces the same
  physical buzzer/actuator behavior as an equivalent real sensor reading.
- APDS9960 swipes register as exactly one dose-log event each, on first
  attempt, across repeated trials, with an OLED "DOSE LOGGED" confirmation.
- A 20-tap sequence counts exactly 20, consistently across runs.
- Freeze detection produces a distinct, clearly audible RAS pulse train
  with no perceptible loop stall.
- The OLED updates legibly in every mode with no full-screen flicker.
- The device runs fully standalone: no WiFi, and no Blynk include, token,
  or call anywhere in the repo.

(The `/data`-endpoint acceptance criterion moves to the networking
layer's definition of done.)

