# AGENT.md — instructions for coding agents on PD-SENSE (v7)

Read before editing. `docs/CURRENT_STATE.md` holds the pre-rebuild audit;
`docs/ARCHITECTURE.md` holds the CURRENT architecture. They must agree
with the code — if they don't, the CODE is wrong until proven otherwise.

## Non-negotiables

1. The ESP32 always runs real sensors in normal operation. Dev simulation
   is compile-gated (`ENABLE_DEV_DIAGNOSTICS 0`) and touches only local
   actuator cues — never sensor state, never telemetry.
2. The ONLY database write path is the backend (`server/`), holding the
   Supabase service-role key. Firmware and browsers never see it.
3. `event_id` uniqueness is the dedupe contract; retried POSTs must
   resolve to `already_processed`.
4. No invented values: invalid/contaminated windows are quality states,
   not zeros. Incomplete tap tests never get a grade. Medication gesture
   events are records, not proof of intake. Nothing "diagnoses".
5. localStorage = UI preferences only. No patient data leaves the backend.
6. The public site (`website/index.html`) must never embed patient data.
7. Secrets live in env/local config only; placeholders are what get
   committed. See docs/SECURITY.md (rotation pending items listed there).
8. Preserve validated sensor algorithms unless you can show a concrete
   bug — especially: adaptive calibration, FFT band gating + confirm +
   EMA, tap hysteresis/debounce, gait freeze timers.
9. Test, don't claim: run `cd server && node --test` after changing
   backend/shared logic. Mark anything untestable here as REQUIRES
   PHYSICAL HARDWARE VALIDATION.
10. Big firmware files are coherent wholes: when you touch one
    substantially, ship the complete file and re-read it for regressions.

## Build & validation

| Layer | Check |
|---|---|
| Backend | `cd server; npm install; node --test` |
| Backend API smoke | `npm start` + `GET /api/health` → ok |
| Frontend JS | `node --check` each `website/*/js/*.js` |
| Firmware | Arduino build on a real bench (not checkable here) |
| Database | run the migration in the Supabase SQL editor |

## Scoped briefs

`agents/*.md` are **superseded** legacy briefs kept for history (each
carries a banner). The current contracts are the docs listed in
README.md's document map.
