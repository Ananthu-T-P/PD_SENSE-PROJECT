"use strict";
/* Doctor-facing summary derived ONLY from stored data. Neutral language;
 * observational phrasing; explicit INSUFFICIENT DATA states.
 *
 * THE SUSTAINED-CONDITION FIX (bug B6 in docs/CURRENT_STATE.md):
 * the old implementation accepted "condition holds until data stops" as
 * sustained. Here a sustained window requires observations that actually
 * SPAN the required hold duration inside the data — the end of the dataset
 * proves nothing. */

const MIN = 60e3;

const DEFAULTS = {
  SEVERITY_GOOD_THRESHOLD: 4.0,
  ONSET_WINDOW_MIN: 15,
  GOOD_WINDOW_MIN_HOLD: 30,
  MED_SEGMENT_HOURS: 8,
};

const severityOf = (r) => (typeof r.tremor_score === "number" ? r.tremor_score : null);

function smoothed(readings, windowMs) {
  const out = new Array(readings.length).fill(null);
  let sum = 0, n = 0, head = 0;
  for (let i = 0; i < readings.length; i++) {
    const s = severityOf(readings[i]);
    if (s === null) { out[i] = null; continue; }
    sum += s; n++;
    while (head <= i && readings[i].ts - readings[head].ts > windowMs) {
      const hs = severityOf(readings[head]);
      if (hs !== null) { sum -= hs; n--; }
      head++;
    }
    out[i] = sum / n;
  }
  return out;
}

/**
 * For one recorded medication event, walk the readings that follow it.
 * Returns observational facts only; NEVER a causation claim.
 */
function analyseMedEvent(evt, segment, cfg) {
  const thresh = cfg.SEVERITY_GOOD_THRESHOLD;
  const holdMs = cfg.GOOD_WINDOW_MIN_HOLD * MIN;
  const winMs = cfg.ONSET_WINDOW_MIN * MIN;

  if (!segment.length) {
    return {
      event_ts: new Date(evt.ts).toISOString(),
      gesture: evt.gesture || null,
      onset_minutes: null, lower_window_minutes: null,
      note: "insufficient data — no readings recorded after this event",
    };
  }

  const s = smoothed(segment, winMs);

  let onsetIdx = -1, onsetEnd = null;
  for (let i = 0; i < segment.length; i++) {
    if (s[i] === null || !(s[i] < thresh)) continue;
    /* run of below-threshold smoothed values from i */
    let end = i;
    let lastObs = null;
    while (end < segment.length) {
      if (s[end] !== null && !(s[end] < thresh)) break;
      if (s[end] !== null) lastObs = segment[end].ts;
      end++;
    }
    const observedSpan = lastObs === null ? 0 : lastObs - segment[i].ts;
    if (observedSpan >= holdMs) { onsetIdx = i; onsetEnd = end; break; }
    /* data ran out before holdMs of below-threshold observation — that is
       "insufficient data", never "sustained". */
  }

  if (onsetIdx === -1) {
    return {
      event_ts: new Date(evt.ts).toISOString(),
      gesture: evt.gesture || null,
      onset_minutes: null, lower_window_minutes: null,
      note: "no sustained period below the tremor threshold was measured in the following window (insufficient data or no improvement observed)",
    };
  }

  const onsetTs = segment[onsetIdx].ts;

  /* end of the lower window: first sustained return above threshold */
  let endTs = null;
  for (let i = onsetEnd; i < segment.length; i++) {
    if (s[i] === null || s[i] < thresh) continue;
    let end = i, lastObs = null;
    while (end < segment.length) {
      if (s[end] !== null && s[end] < thresh) break;
      if (s[end] !== null) lastObs = segment[end].ts;
      end++;
    }
    const observedSpan = lastObs === null ? 0 : lastObs - segment[i].ts;
    if (observedSpan >= winMs) { endTs = segment[i].ts; break; }
    i = end - 1;
  }

  const windowMin = Math.round(((endTs || segment[segment.length - 1].ts) - onsetTs) / MIN);
  return {
    event_ts: new Date(evt.ts).toISOString(),
    gesture: evt.gesture || null,
    onset_minutes: Math.round((onsetTs - new Date(evt.ts).getTime()) / MIN),
    lower_window_minutes: windowMin,
    window_open: endTs === null,
    note: "observational alignment only — this does not establish causation",
  };
}

function daySummaries(readings) {
  const byDay = new Map();
  for (const r of readings) {
    const sev = severityOf(r);
    if (sev === null) continue;
    const d = new Date(r.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay.has(key)) byDay.set(key, { total: 0, n: 0 });
    const b = byDay.get(key); b.total += sev; b.n++;
  }
  const days = [...byDay.entries()].map(([date, v]) => ({ date, avg_severity: +(v.total / v.n).toFixed(2) }));
  let best = null, worst = null;
  for (const d of days) {
    if (!best || d.avg_severity < best.avg_severity) best = d;
    if (!worst || d.avg_severity > worst.avg_severity) worst = d;
  }
  return { best, worst };
}

/**
 * summarize({readings, events, tapTests, medEvents, alerts, range}) ->
 * doctor summary. All inputs are plain rows with ms-epoch `ts` numbers for
 * readings/events and real row objects for the rest (callers map first).
 */
function summarize(input, overrides = {}) {
  const cfg = Object.assign({}, DEFAULTS, overrides);
  const readings = (input.readings || [])
    .filter((r) => typeof r.ts === "number" && typeof severityOf(r) === "number")
    .sort((a, b) => a.ts - b.ts);
  const medEvents = (input.medEvents || []).slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const medResults = medEvents.map((d, i) => {
    const dTs = new Date(d.ts).getTime();
    const segEnd = i + 1 < medEvents.length
      ? new Date(medEvents[i + 1].ts).getTime()
      : Math.min(dTs + cfg.MED_SEGMENT_HOURS * 60 * MIN,
                 readings.length ? readings[readings.length - 1].ts : dTs);
    const segment = readings.filter((r) => r.ts >= dTs && r.ts < segEnd);
    return analyseMedEvent(d, segment, cfg);
  });

  const { best, worst } = daySummaries(readings);
  const gaps = [];
  for (let i = 1; i < readings.length; i++) {
    const dt = readings[i].ts - readings[i - 1].ts;
    if (dt > 5 * MIN) gaps.push({ from: new Date(readings[i - 1].ts).toISOString(), to: new Date(readings[i].ts).toISOString(), minutes: Math.round(dt / MIN) });
  }

  const sevs = readings.map(severityOf).filter((v) => v !== null);
  const mean = sevs.length ? sevs.reduce((a, b) => a + b, 0) / sevs.length : null;

  return {
    generated_at: new Date().toISOString(),
    period: {
      start: readings.length ? new Date(readings[0].ts).toISOString() : null,
      end: readings.length ? new Date(readings[readings.length - 1].ts).toISOString() : null,
      reading_count: readings.length,
      data_gaps: gaps,
    },
    tremor: sevs.length ? {
      mean_index: +mean.toFixed(2),
      max_index: +Math.max(...sevs).toFixed(2),
      valid_windows: sevs.length,
    } : { note: "insufficient data" },
    medication_events: medResults,
    gait_freeze: {
      freeze_events: (input.events || []).filter((e) => e.event_type === "freeze").length,
      prolonged_freeze_alerts: (input.alerts || []).filter((a) => a.event_type === "prolonged_freeze").length,
    },
    tap_tests: (input.tapTests || []).map((t) => ({
      completed_at: t.completed_at, tap_count: t.tap_count, target_count: t.target_count,
      bradykinesia_grade: t.bradykinesia_grade, bradykinesia_label: t.bradykinesia_label,
      quality: t.quality,
    })),
    days: { best, worst },
    alerts: (input.alerts || []).map((a) => ({ ts: a.ts, event_type: a.event_type, severity: a.severity, status: a.status })),
    language_note: "All values are observed/recorded measurements from the device. Observational alignments between medication events and tremor levels do not establish causation.",
  };
}

module.exports = { summarize, smoothed, severityOf, DEFAULTS };
