"use strict";
/* Analytics over stored readings for a patient: time-bucketed trends,
 * data-gap detection, quality breakdown. Rollups where older than 48 h
 * (readings_rollup) merge with fresh rows so history is seamless. */
const config = require("../config");

/** Split [from,to] into n target buckets; returns [{start,end,rows:[]}] */
function bucketize(rows, fromMs, toMs, targetBuckets = 48) {
  const span = Math.max(1, toMs - fromMs);
  const width = Math.max(60000, Math.ceil(span / targetBuckets));
  const n = Math.ceil(span / width);
  const buckets = Array.from({ length: n }, (_, i) => ({
    start: fromMs + i * width, end: fromMs + (i + 1) * width, rows: [],
  }));
  for (const r of rows) {
    const i = Math.min(n - 1, Math.floor((r.ts - fromMs) / width));
    if (r.ts >= fromMs && r.ts < toMs) buckets[i].rows.push(r);
  }
  return buckets;
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function trends(readings, fromMs, toMs, targetBuckets) {
  const buckets = bucketize(readings, fromMs, toMs, targetBuckets);
  return buckets.map((b) => {
    const tr = b.rows.map((r) => r.tremor_score).filter((v) => typeof v === "number");
    const fq = b.rows.map((r) => r.dominant_frequency_hz).filter((v) => typeof v === "number");
    const cad = b.rows.map((r) => r.cadence_hz).filter((v) => typeof v === "number");
    const jerk = b.rows.map((r) => r.jerk_peak).filter((v) => typeof v === "number");
    return {
      bucket_start: new Date(b.start).toISOString(),
      reading_count: b.rows.length,
      tremor_avg: avg(tr) === null ? null : +avg(tr).toFixed(3),
      tremor_max: tr.length ? +Math.max(...tr).toFixed(3) : null,
      freq_avg: avg(fq) === null ? null : +avg(fq).toFixed(3),
      cadence_avg: avg(cad) === null ? null : +avg(cad).toFixed(3),
      jerk_max: jerk.length ? +Math.max(...jerk).toFixed(3) : null,
      freeze_any: b.rows.some((r) => r.freeze_active === true),
      quality_valid_share: b.rows.length
        ? +(b.rows.filter((r) => r.tremor_quality === "VALID").length / b.rows.length).toFixed(3) : null,
    };
  });
}

/** Longer-than-expected silent intervals. expectedIntervalMs ~ upload cadence. */
function findGaps(readings, expectedIntervalMs = 15000, factor = 4) {
  const gaps = [];
  for (let i = 1; i < readings.length; i++) {
    const dt = readings[i].ts - readings[i - 1].ts;
    if (dt > expectedIntervalMs * factor) {
      gaps.push({
        from: new Date(readings[i - 1].ts).toISOString(),
        to: new Date(readings[i].ts).toISOString(),
        minutes: +(dt / 60000).toFixed(1),
      });
    }
  }
  return gaps;
}

function freshness(lastTs, nowMs = Date.now()) {
  if (!lastTs) return { state: "never_seen", age_ms: null };
  const age = nowMs - lastTs;
  return {
    state: age < config.FRESH_ONLINE_MS ? "online" : age < config.FRESH_STALE_MS ? "stale" : "offline",
    age_ms: age,
  };
}

module.exports = { trends, findGaps, freshness, bucketize };
