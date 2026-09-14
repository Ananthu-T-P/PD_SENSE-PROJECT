# Safety Alerts Spec

## Purpose

Notify a caregiver or doctor promptly when the stored history (see
`DOCTOR_WEBSITE.md`) shows a symptom pattern serious enough to warrant
attention sooner than the next scheduled review.

## Trigger conditions

- **Sustained severe tremor classification** — a tremor score staying
  above the severe threshold across multiple consecutive polls, not a
  single spike.
- **Unresolved freeze-of-gait event** — a freeze status that persists
  across multiple polls without returning to normal, i.e. the RAS
  actuator cueing on-device did not resolve it.

Exact numeric thresholds and the "sustained"/"unresolved" poll-count
windows should be defined as named, documented constants in the alerts
code — not hard-coded inline — since they will need tuning once real
sensor behavior is observed.

## Delivery channels

### Email
- SMTP using a Gmail app password, **or**
- SendGrid / EmailJS free tier as an alternative that avoids managing raw
  SMTP credentials.

### WhatsApp
- CallMeBot's free, simple GET-based API for demo purposes, **or**
- Twilio WhatsApp sandbox as a more "official-looking" alternative if the
  demo needs to look production-grade.

Either channel (or both) is acceptable for this scope — pick based on
what's easiest to demo reliably, since this is a college project rather
than a production notification service.

## Where this code lives

**Backend-mediated only — never sent from ESP32 firmware.** The doctor-
website backend, which already holds the polled history, is the only
place that evaluates trigger conditions and calls out to email/WhatsApp
APIs. This keeps credentials off a wearable device and keeps the trigger
logic in one place instead of duplicated between firmware and backend.

## Behavior requirements

- **Debounce per episode.** A sustained condition should produce one alert
  when it starts, not one alert per poll for the duration of the episode.
- **Fail without cascading.** A missing/invalid API key or a network
  failure on the alert-send path must be caught and logged, and must not
  affect the poller, storage, or analytics running alongside it.
- **Log every attempted alert**, whether it succeeded or failed, so a
  demo/evaluation can show the trigger fired even if the actual message
  delivery isn't live.
