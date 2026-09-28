# PD-SENSE — Alerts (backend-owned)

## Model

The device produces **local cues** (buzzer RAS pulse on confirmed freeze;
3-beep tremor alert above the critical index) and **candidate events**.
Persisted cloud alerts are produced ONLY by the backend from stored
events/readings — one place owns the policy:

| Alert | Trigger | Severity |
|---|---|---|
| prolonged_freeze | `freeze` event with duration ≥ 8 s (`ALERT_PROLONGED_FREEZE_MS`) | warning |
| possible_fall | `possible_fall` event (impact + stillness) | critical |
| high_tremor | `tremor_score ≥ 6.5` on 3 consecutive VALID telemetry packets (`ALERT_HIGH_TREMOR_*`) | warning |

## Rules implemented in `server/src/services/alertService.js`

1. **First alert after boot always fires.** Cooldown state lives in the
   database (last alert of that type within `ALERT_COOLDOWN_MS`), not in
   an in-memory timer initialized at 0 — the historical first-10-minutes
   suppression bug cannot exist here.
2. **One alert per episode**, never one per loop iteration (episodes are
   events; events are deduped by event_id).
3. **Failure ≠ cooldown.** An alert row write failure surfaces as HTTP
   500 and the DEVICE-side queue retries the underlying event; the
   cooldown check only runs on genuine stored alerts. A future delivery
   bridge (email etc.) moves `open → acknowledged → resolved`, and failed
   deliveries land as `delivery_failed` for retry — independently of the
   detection cooldown.
4. **Language**: alerts are candidates/observations. `possible_fall` is
   never rendered as a confirmed fall.

## Live Monitor / Doctor Portal display

Alerts appear in the live monitor banner area (events timeline) and in
the doctor portal with severity + lifecycle status; open alerts can be
acknowledged (`PATCH /api/v1/alerts/:id`).

## Device-side parameters (firmware)

Local cue thresholds live in `firmware/NeuroLoop_Core/config.h`
(`TREMOR_CRITICAL`, `FALL_JERK_THRESHOLD`, …). The device does not decide
what becomes a persisted alert.
