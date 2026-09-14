# AGENT.md — NeuroLoop

Instructions for any coding agent (human or AI) working in this repository.
Read this file first, then read the specific sub-agent file in `agents/` for
the subsystem you're touching. Each sub-agent file is scoped: it only
describes the rules, interfaces, and constraints for its own piece, so you
never need to load the whole project into context to make a correct change.

## Ground rules for the whole project

1. **This is a medical-adjacent monitoring device, not a diagnostic one.**
   Nothing in this project diagnoses Parkinson's or makes a treatment
   decision. It measures motor signals and surfaces trends to a doctor, who
   makes the call. Never phrase UI copy, alerts, or chatbot answers as a
   diagnosis or a medical instruction ("you have worsened", "increase your
   dose"). Report what was measured, not what it means clinically.

2. **Real sensor data and manually-entered data are the same downstream
   data.** Any test data, scoring, alerting, or storage logic must treat a
   manually-typed serial entry identically to a live MPU6050 reading. Do not
   special-case manual mode anywhere past the point of ingestion — that
   defeats the point of using it for classroom demos.

3. **The ESP32 never talks to the internet.** It only serves its own local
   `/data` endpoint and dashboard over the local Wi-Fi network. All email,
   WhatsApp, and AI chatbot logic lives on the external doctor website /
   poller, never on the device firmware. This keeps the firmware simple,
   keeps patient data off third-party APIs by default, and matches the
   agreed architecture in `docs/ARCHITECTURE.md`.

4. **Scope discipline.** The on-device TinyML classifier from the original
   EOI is explicitly cut for this version. Do not reintroduce it, a model
   file, or a training pipeline unless a human explicitly reopens that
   scope decision in writing.

5. **One finalized firmware file.** The firmware has been discussed in
   sketches but not finalized as a single file. Before adding a new
   feature, check whether `docs/FIRMWARE.md`'s state machine already
   describes a slot for it. If it doesn't fit any existing mode, that's a
   sign to update the spec first, then the code — not the other way round.

6. **No invented data.** The analytics and chatbot on the doctor website
   must only summarize what was actually polled and stored. Never fabricate
   a data point, a trend, or a doctor-facing claim to fill a gap — say the
   data isn't available for that period instead.

## Build order (see `docs/BUILD_ORDER.md` for detail)

1. ESP32 firmware (state machine, manual mode, buzzer/actuator response,
   `/data` endpoint, local dashboard)
2. Doctor website (poller, storage, comparison/analytics logic)
3. Alerts (email / WhatsApp)
4. AI chatbot (depends on stored data existing — build last)

Do not start step *n* in a way that blocks step *n+1* from reading its
required data shape. In particular: freeze the `/data` JSON schema in
`docs/FIRMWARE.md` before writing the poller, since the poller, the
analytics layer, and the chatbot all depend on it staying stable.

## Sub-agent index

| File | Scope |
|---|---|
| [`agents/firmware-agent.md`](./agents/firmware-agent.md) | ESP32 firmware: state machine, manual mode, sensor scoring, `/data` endpoint |
| [`agents/dashboard-agent.md`](./agents/dashboard-agent.md) | Local Wi-Fi live dashboard HTML/JS served by the ESP32 |
| [`agents/doctor-website-agent.md`](./agents/doctor-website-agent.md) | External poller, storage, analytics, AI chatbot |
| [`agents/alerts-agent.md`](./agents/alerts-agent.md) | Email / WhatsApp alert integration |
| [`agents/enclosure-agent.md`](./agents/enclosure-agent.md) | OpenSCAD wrist enclosure |
| [`agents/website-agent.md`](./agents/website-agent.md) | Public 3D scroll-driven project website |

## When in doubt

Prefer the smallest change that satisfies the written spec in `docs/`. If a
request conflicts with a spec, flag the conflict and ask, rather than
silently picking one side.
