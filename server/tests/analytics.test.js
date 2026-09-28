"use strict";
const { test } = require("node:test");
process.env.PD_SENSE_SKIP_ENV_CHECK = "1";
const assert = require("node:assert/strict");
const summary = require("../src/services/summaryService");
const { freshness, findGaps, trends } = require("../src/services/analyticsService");

const MIN = 60e3;
const T0 = Date.parse("2026-09-27T09:00:00Z");
const readingAt = (t, score) => ({ ts: T0 + t * MIN, tremor_score: score });

/* ---- the bug B6 regression tests: end-of-data is NOT sustained ---- */

test("data ending while below threshold is NOT treated as sustained onset", () => {
  /* 5 minutes of good readings then data stops — hold requires 30 min */
  const readings = [];
  for (let i = 0; i < 5; i++) readings.push(readingAt(i, 2.0));
  const medEvents = [{ ts: new Date(T0 - 10 * MIN).toISOString(), gesture: "DOWN" }];
  const out = summary.summarize({ readings, medEvents });
  assert.equal(out.medication_events[0].onset_minutes, null);
  assert.match(out.medication_events[0].note, /insufficient|no sustained/i);
});

test("genuinely sustained low segment IS detected", () => {
  /* 60 minutes above, then 60 minutes comfortably below threshold */
  const readings = [];
  for (let i = 0; i < 60; i++) readings.push(readingAt(i, 7.5));
  for (let i = 60; i < 120; i++) readings.push(readingAt(i, 2.0));
  const medEvents = [{ ts: new Date(T0 + 55 * MIN).toISOString(), gesture: "DOWN" }];
  const out = summary.summarize({ readings, medEvents });
  const r = out.medication_events[0];
  assert.ok(r.onset_minutes !== null, "expected a measured onset");
  assert.ok(r.lower_window_minutes >= 30);
  assert.match(r.note, /causation/i);   // observational language enforced
});

test("no readings = insufficient data, not zero values", () => {
  const out = summary.summarize({ readings: [], medEvents: [] });
  assert.equal(out.tremor.note, "insufficient data");
  assert.equal(out.period.reading_count, 0);
});

/* ---- freshness ---- */

test("freshness classification", () => {
  const now = Date.now();
  assert.equal(freshness(null, now).state, "never_seen");
  assert.equal(freshness(now - 10e3, now).state, "online");
  assert.equal(freshness(now - 60e3, now).state, "stale");
  assert.equal(freshness(now - 600e3, now).state, "offline");
});

/* ---- gaps & trends ---- */

test("findGaps reports silent intervals, ignores normal cadence", () => {
  const rows = [0, 15, 30, 45, 900].map((s) => ({ ts: T0 + s * 1000 }));
  const gaps = findGaps(rows, 15000, 4);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].minutes > 10);
});

test("trends buckets never fabricate zeros for empty buckets", () => {
  const rows = [{ ts: T0, tremor_score: 4, dominant_frequency_hz: 5, cadence_hz: 1.5, jerk_peak: 1, freeze_active: false, tremor_quality: "VALID" }];
  const buckets = trends(rows, T0, T0 + 60 * MIN, 6);
  assert.equal(buckets.length, 6);
  const empty = buckets.slice(1);
  for (const b of empty) assert.equal(b.tremor_avg, null);
});
