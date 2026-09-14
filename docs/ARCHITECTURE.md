# Architecture

## Component map

```
 ┌────────────────────────┐
 │   MYOSA ESP32 Stack     │   Worn by patient
 │  (firmware, on-device)  │
 │                         │
 │  Sensors → state        │
 │  machine → scoring →    │
 │  evaluateAndAct()       │
 │  → buzzer / actuator    │
 │                         │
 │  WebServer.h            │
 │   GET /data  (JSON) ────┼────────────┐
 │   GET /      (dashboard)│            │
 └───────────┬─────────────┘            │
             │ same local Wi-Fi         │ periodic GET
             │                          │ (not continuous)
   ┌─────────▼─────────┐      ┌─────────▼──────────────┐
   │  Local dashboard   │      │   Doctor website        │
   │  (any browser on   │      │   (poller + storage +   │
   │   the Wi-Fi)        │      │   analytics + chatbot)  │
   └────────────────────┘      └─────────┬───────────────┘
                                          │ on sustained severe
                                          │ tremor / unresolved
                                          │ freeze
                                ┌─────────▼───────────────┐
                                │   Alerts (email/WhatsApp) │
                                └───────────────────────────┘

   ┌────────────────────────┐
   │  Public project website │  (no connection to the device;
   │  (3D scroll explainer)  │   educational content only)
   └────────────────────────┘
```

## Data flow

1. **Sensing / scoring (on-device).** Real MPU6050/APDS9960/DHT22/SGP30-or-
   MQ/BMP280 readings, or a manually-typed CSV line in `MANUAL` mode, are
   both fed into the same scoring logic and the same `evaluateAndAct()`
   function. The device has no concept of "this reading is fake" past
   ingestion.

2. **Local exposure (on-device).** The ESP32 hosts its own HTTP server. It
   exposes exactly one machine-readable contract, `/data`, and one
   human-facing page, the dashboard. It has no cloud role and no
   persistent history — it only ever reports the current instant.

3. **External polling (off-device, doctor side).** Something on the same
   Wi-Fi — described in the source material as possibly a laptop for demo
   purposes — periodically calls `GET /data`, timestamps the response, and
   stores it. This is intentionally periodic sampling, not a continuous
   stream, to keep load on the ESP32's single HTTP handler low and to keep
   the stored history a clean, evenly-sampled time series.

4. **Analytics (doctor website).** The stored history is the only input to
   best/worst day comparisons, freeze-duration tracking, and trend views.
   These are cross-referenced against medication/dosage entries, which are
   logged separately by a doctor or patient — the device has no notion of
   medication.

5. **Alerts (doctor website → external services).** When stored history
   shows a sustained severe tremor classification or an unresolved freeze-
   of-gait event, the backend — never the firmware — sends an email and/or
   WhatsApp message.

6. **Chatbot (doctor website, last to build).** A natural-language
   interface over the stored summary data only. It depends on there being
   real history to answer from, which is why it's built last.

## Why the ESP32 has no cloud role

Keeping the device local-only (serves `/data` and a dashboard, nothing
more) means:
- No API keys or credentials live on hardware a patient physically carries.
- The firmware stays small enough to debug over serial in a classroom.
- A single frozen JSON contract (`/data`) is the only thing every other
  subsystem needs to agree on, which lets firmware, dashboard, doctor
  website, and alerts be built and tested independently.

## Failure isolation

Each arrow in the diagram above is meant to be independently faulty
without cascading:
- Dashboard down → doesn't affect firmware sensing or `evaluateAndAct()`.
- Poller briefly can't reach `/data` → it should skip that sample, not
  crash or backfill fabricated data.
- Alert send fails (bad API key, sandbox expired) → doesn't affect storage
  or analytics.
- Chatbot has insufficient stored data to answer → it says so, rather than
  guessing.
