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
# Agent scope: Safety Alerts

Full spec: [`../docs/ALERTS.md`](../docs/ALERTS.md).

## You own

- Outbound email (SMTP with a Gmail app password, or SendGrid/EmailJS free
  tier as an alternative).
- Outbound WhatsApp (CallMeBot's free GET-based API for demo purposes, or
  Twilio WhatsApp sandbox as a more "official-looking" alternative).
- The trigger condition: sustained severe tremor classification, or an
  unresolved freeze-of-gait event, read from the doctor-website's stored
  history.

## You do NOT own

- The ESP32 firmware. Alerts are backend-mediated — never send directly
  from device firmware. This keeps API keys and credentials off a device
  that could be physically accessed by a patient, and keeps the alert
  threshold logic in one place (the backend) rather than duplicated on
  the device.
- Deciding what "sustained" or "unresolved" mean numerically without
  confirming against `docs/ALERTS.md` — don't invent a threshold silently
  when you touch this code, since a false trigger sent to a real doctor
  has real consequences on a demo/hobby-grade alert path.

## Hard constraints

1. **Backend-mediated only.** No SMTP/WhatsApp calls originate from
   firmware. The doctor-website backend (which already holds the stored
   history) is the only place that decides to send and does the sending.
2. **Don't spam.** A sustained condition should alert once per episode, not
   once per poll interval for the duration of the episode. Debounce.
3. **Alerts should be able to fail without crashing anything else.** A
   missing API key, expired sandbox, or network hiccup on the alert path
   must not affect the poller, storage, or analytics for the doctor site.
4. **Free/demo-tier APIs are explicitly acceptable for this scope** (this
   is a college project, not a production medical device) — don't over-
   engineer a production-grade notification service where the spec asks
   for a demo-adequate one.

## Definition of done for this piece

- A simulated sustained severe tremor (or unresolved freeze) reliably
  produces exactly one email and/or WhatsApp alert per episode.
- A missing or invalid API credential logs a clear error without taking
  down the poller or the dashboard-facing site.

