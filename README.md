# NeuroLoop — Parkinson's Motor-Symptom Monitoring Wristband

A wrist-worn monitoring system for Parkinson's motor symptoms, built on the
MYOSA Mini IoT kit (ESP32 + stackable sensor boards). This repo scopes the
project down from the original IEEE MYOSA Event 6.0 EOI into a buildable
college project, inheriting sensor and tremor-detection work from an earlier
prototype called **PD-SENSE**.

This is documentation-first: every subsystem has its own spec so firmware,
web, and hardware work can proceed independently and be evaluated against a
written source of truth rather than tribal memory.

## What this system does

A patient wears the wristband. It runs short, timed tests (tremor, tap,
gait) or free-running manual mode, scores the result, and reacts immediately
with buzzer/haptic feedback. Anyone on the same Wi-Fi — a teacher, an
evaluator, a caregiver — can open the device's local IP in a browser and see
live readings with no app install. Separately, a doctor-facing website polls
the device periodically, stores a history, computes trend analytics against
logged medication, and lets a doctor ask natural-language questions about
that history. Sustained severe symptoms trigger an email/WhatsApp alert.

## Document map

| File | Purpose |
|---|---|
| [`AGENT.md`](./AGENT.md) | Root instructions for any coding agent working in this repo, and an index of scoped sub-agent files |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System diagram, data flow, and component boundaries |
| [`docs/FIRMWARE.md`](./docs/FIRMWARE.md) | ESP32 state machine, manual data-entry mode, sensor logic, `/data` API |
| [`docs/DASHBOARD.md`](./docs/DASHBOARD.md) | Local Wi-Fi live dashboard served by the ESP32 |
| [`docs/DOCTOR_WEBSITE.md`](./docs/DOCTOR_WEBSITE.md) | External poller, storage, analytics, and AI chatbot |
| [`docs/ALERTS.md`](./docs/ALERTS.md) | Email / WhatsApp alert integration |
| [`docs/HARDWARE_ENCLOSURE.md`](./docs/HARDWARE_ENCLOSURE.md) | Sensor suite and the OpenSCAD wrist enclosure |
| [`docs/BUILD_ORDER.md`](./docs/BUILD_ORDER.md) | Agreed build sequence and current status |
| [`website/WEBSITE.md`](./website/WEBSITE.md) | Spec for the public-facing 3D scroll-driven project website |

## Project status (as of this document)

**Decided, not yet built:** doctor website (poller, storage, analytics,
chatbot), alert integration code, and a single finalized firmware file.
Firmware architecture, dashboard approach, and enclosure geometry have all
been designed and are ready to implement in the order set out in
`docs/BUILD_ORDER.md`.

**Explicitly out of scope for this version:** the on-device TinyML tremor
classifier from the original EOI. This version uses FFT-only tremor
detection.

## Terminology used throughout these docs

- **MYOSA stack** — the ESP32 motherboard plus stacked sensor boards
  (MPU6050, APDS9960, DHT22, SGP30/MQ, BMP280, OLED).
- **Test window** — a timed (e.g. 15 s) sampling period for TREMOR_TEST,
  TAP_TEST, or GAIT_TEST, after which the device auto-returns to IDLE.
- **Manual mode** — typing comma-separated values into the serial monitor to
  simulate sensor input for classroom demos, without touching real hardware.
- **`evaluateAndAct()`** — the single function that turns a tremor score or
  gait status into a physical response (buzzer, RAS actuator pulse),
  regardless of whether the input came from a real sensor or manual entry.
