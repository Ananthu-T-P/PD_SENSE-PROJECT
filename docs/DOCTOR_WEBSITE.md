# Doctor-Facing Website Spec

## Purpose

A separate, external website (not hosted on the ESP32) that turns a stream
of point-in-time device readings into something a doctor can actually use:
trend history, comparisons, and a natural-language Q&A interface.

## Components

### 1. Poller

- Periodically issues `GET` against the ESP32's `/data` endpoint (see
  `FIRMWARE.md` for schema) over the local Wi-Fi.
- For demo purposes, this can run as a simple script on a laptop on the
  same network as the device — it does not need to be a hosted service for
  the college-project scope.
- **Periodic sampling, not a continuous dump.** Each poll produces one
  timestamped snapshot in storage. Choose an interval that gives
  meaningful trend resolution without hammering the ESP32's single-core
  HTTP server.
- A failed poll (device offline, Wi-Fi blip) should be skipped and logged,
  not retried aggressively or backfilled with guessed values.

### 2. Storage

- Timestamped snapshots of `{mode, tremor_score, bradykinesia_grade,
  gait_status}` plus a separately-logged medication/dosage table (doctor
  or patient entered — the device itself has no concept of medication).
- Storage choice is an implementation detail for whoever builds this
  (anything from a local SQLite file to a hosted database is consistent
  with the spec) — the requirement is that it's queryable by date range
  for the analytics layer.

### 3. Analytics

Computed from stored history, not from live device state:

- **Best/worst day comparison** — highest and lowest average tremor score
  across stored days, and longest recorded freeze duration.
- **Medication cross-reference** — align tremor/freeze trends against
  logged dosage times to surface patterns like "tremor score rises in the
  hours before the next scheduled dose."
- **Trend over time** — a time-series view of tremor score, bradykinesia
  grade, and freeze events across the stored history.

None of this is a diagnosis. It surfaces patterns; the doctor interprets
them.

### 4. AI chatbot

- LLM-backed, doctor-facing only (not shown on the local dashboard or the
  public website).
- Answers natural-language questions — the source material's example is
  *"did tremor worsen after the missed dose?"* — grounded **only** in the
  stored summary data and analytics computed above, never in raw sensor
  traffic and never fabricated.
- If the stored data can't support an answer (e.g. no dose was logged as
  missed on the date in question), the chatbot should say so plainly
  rather than producing a plausible-sounding but unsupported answer.
- Build this last: it has nothing meaningful to answer from until the
  poller and storage have accumulated real history.

## Explicit non-goals

- This is not a patient-facing app. Tone, framing, and the level of detail
  shown assume a clinical reader.
- This does not replace clinical judgment. Every analytics view and every
  chatbot answer is a summary of measured motor data, not a diagnosis or a
  treatment recommendation.
