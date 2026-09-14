# Build Order & Status

## Agreed sequence

1. **ESP32 firmware** — state machine, manual mode, buzzer/actuator
   response, `/data` endpoint, local dashboard.
   *(See `FIRMWARE.md` and `DASHBOARD.md`.)*
2. **Doctor website** — poller, storage, comparison/analytics logic.
   *(See `DOCTOR_WEBSITE.md`.)*
3. **Alerts** — email / WhatsApp integration.
   *(See `ALERTS.md`.)*
4. **AI chatbot** — built last, since it depends on stored data existing
   to answer questions from.
   *(See `DOCTOR_WEBSITE.md`, chatbot section.)*

This order exists because each stage depends on the previous one having a
stable, working output: the poller can't be tested against a `/data`
schema that keeps changing; alerts need real stored history to trigger
against; the chatbot needs enough accumulated history to be worth talking
to.

## Why this order, not something else

- Firmware first because every other subsystem is a *client* of `/data` —
  freezing that contract early avoids rework everywhere downstream.
- Doctor website before alerts because alerts read from the doctor
  website's stored history, not directly from the device.
- Chatbot absolute last because a chatbot with no data to draw from just
  produces confident-sounding nonsense, which directly conflicts with the
  project's ground rule against fabricated clinical claims.

## Current status

| Item | Status |
|---|---|
| Firmware architecture (state machine, manual mode, `evaluateAndAct()`, `/data` schema) | Designed in detail, sketches exist, **not finalized as one complete file** |
| Local dashboard | Designed, not built |
| Doctor website (poller/storage/analytics/chatbot) | **Not yet built** |
| Alerts integration | **Not yet built** |
| Enclosure (`neuroloop_enclosure.scad`) | Designed parametrically, **dimensions not yet tuned to measured hardware** |
| Public project website | Spec written (`website/WEBSITE.md`), not built |

## Immediate next actions

1. Finalize the ESP32 firmware as a single complete `.ino` file against
   `FIRMWARE.md`, including the frozen `/data` schema.
2. Physically assemble and measure the MYOSA stack + OLED module so
   `neuroloop_enclosure.scad`'s parametric values can be set for a first
   print — this can happen in parallel with firmware work since it
   doesn't block software.
3. Once `/data` is live and stable, build the poller against it.
