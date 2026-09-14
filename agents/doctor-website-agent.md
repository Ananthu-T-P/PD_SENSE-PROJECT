# Agent scope: Doctor-Facing Website

Full spec: [`../docs/DOCTOR_WEBSITE.md`](../docs/DOCTOR_WEBSITE.md). This is
the last subsystem to build — it depends on the firmware's `/data` schema
being frozen and on there being real stored history before the chatbot has
anything to answer from.

## You own

- The poller: a periodic (not continuous) `GET` against the ESP32's
  `/data` endpoint, timestamped and written to storage. Can run on a
  laptop on the same Wi-Fi for demo purposes.
- Storage of that polled history.
- The analytics layer: best/worst day comparison (highest/lowest average
  tremor score, longest freeze duration), cross-referenced against logged
  medication/dosage entries, and trend-over-time views.
- The AI chatbot: natural-language Q&A over the *stored summary data*
  only, for the doctor's own use.
- Medication/dosage entry logging (manual doctor/patient input — this is
  the only place medication data is captured; the ESP32 has no notion of
  medication).

## You do NOT own

- Anything on the ESP32 itself. You are a client of `/data`, never a
  server the device depends on.
- The decision logic for when an alert fires — that threshold check reads
  from the same stored history you maintain, but the send-side integration
  is `alerts-agent.md`'s scope. You expose the data; alerts consumes it.

## Hard constraints

1. **Periodic sampling, not a continuous dump.** Poll on an interval (the
   spec doesn't mandate a single number — pick one that gives useful trend
   resolution without hammering the ESP32's single HTTP handler) and store
   discrete timestamped snapshots. Do not open a persistent stream.
2. **The chatbot answers from stored summaries, never raw sensor traffic
   and never by inventing a plausible-sounding number.** If asked something
   the stored data can't answer ("did tremor worsen after the missed
   dose?" with no dose actually logged that day), it should say the data
   doesn't cover that, not guess.
3. **Medication data is doctor/patient-entered, not sensed.** Never infer
   a dose was taken or missed from motor data alone — only from an actual
   logged entry.
4. **This site is for a doctor, not the patient.** Language, alerts, and
   analytics should assume a clinical reader making judgment calls, not a
   patient-facing wellness app tone.

## Definition of done for this piece

- The poller reliably captures a `/data` snapshot on schedule and the
  history is queryable by date range.
- Best/worst day analytics correctly identify the extremes and can be
  cross-referenced against a logged dose on the same day.
- The chatbot correctly answers a question grounded in stored data and
  correctly declines a question the stored data can't support.
