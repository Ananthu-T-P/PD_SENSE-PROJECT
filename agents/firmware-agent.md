# Agent scope: ESP32 Firmware

Full spec: [`../docs/FIRMWARE.md`](../docs/FIRMWARE.md). This file is the
condensed, actionable version for whoever (or whatever) is writing code.

## You own

- The `.ino` firmware file(s) running on the MYOSA ESP32 stack.
- The state machine (`IDLE`, `TREMOR_TEST`, `TAP_TEST`, `GAIT_TEST`,
  `MANUAL`), its serial keyboard shortcuts (`1`/`2`/`3`/`4`/`0`), and the
  timed test window + auto-return-to-idle behavior.
- Manual data-entry parsing (comma-separated serial input).
- `evaluateAndAct()` — the single scoring→response function.
- The `WebServer.h`-based local HTTP server and its `/data` JSON endpoint.

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
4. **`/data` is the only external contract.** Its JSON schema (mode, tremor
   score, bradykinesia grade, gait status — see `FIRMWARE.md` for the exact
   shape) is depended on by the dashboard, the doctor-website poller, the
   analytics layer, and eventually the chatbot. Do not change field names
   or types without updating `FIRMWARE.md` and flagging it — every
   downstream consumer breaks silently otherwise.
5. **No cloud calls, no persistent storage on-device.** The ESP32 reports
   current state only; it is not a database.

## Definition of done for this piece

- Typing `1`, `2`, `3`, or `4` on serial starts the matching test and it
  auto-ends after its window; `0` returns to idle at any time.
- Typing a manual CSV line while in `MANUAL` mode produces the same
  physical buzzer/actuator behavior as an equivalent real sensor reading.
- `GET /data` on the device's local IP returns valid JSON matching the
  frozen schema, refreshable at the dashboard's ~300 ms poll rate without
  lag or dropped connections.
