"use strict";
/* Readings: latest, paginated lists, CSV export. Dashboard token gated.
 * Range filter uses repeated PostgREST keys (ts=gte.X&ts=lte.Y). */
const express = require("express");
const db = require("../db");
const { parseLimit, parseTimeRange } = require("../utils/validation");
const { decodeCursor, nextCursor } = require("../utils/pagination");
const { freshness } = require("../services/analyticsService");

const router = express.Router();

/** Build URLSearchParams for a readings query from the request. */
function readingsParams(req, order) {
  const p = new URLSearchParams({ select: "*" });
  if (req.query.patient_id) p.set("patient_id", `eq.${req.query.patient_id}`);
  if (req.query.device_id) p.set("device_id", `eq.${req.query.device_id}`);
  const range = parseTimeRange(req.query);
  if (range.from) p.append("ts", `gte.${range.from}`);
  if (range.to) p.append("ts", `lte.${range.to}`);
  if (order) p.set("order", order);
  return p;
}

/* GET /api/v1/readings/latest?patient_id=... */
router.get("/readings/latest", async (req, res, next) => {
  try {
    const p = readingsParams(req, "ts.desc");
    p.set("limit", "1");
    const rows = await db.raw(`readings?${p}`);
    const latest = rows[0] || null;
    res.json({
      data: latest,
      freshness: freshness(latest ? new Date(latest.received_at || latest.ts).getTime() : null),
      count: latest ? 1 : 0,
    });
  } catch (err) { next(err); }
});

/* GET /api/v1/readings?limit=&before=&patient_id=&device_id=&from|range=&to= */
router.get("/readings", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 50);
    const p = readingsParams(req, "id.desc");
    const before = decodeCursor(req.query.before);
    if (before !== null) p.set("id", `lt.${before}`);
    p.set("limit", String(limit));
    const rows = await db.raw(`readings?${p}`);
    res.json({ data: rows, next_cursor: nextCursor(rows, limit), count: rows.length });
  } catch (err) { next(err); }
});

/* GET /api/v1/export/readings.csv — backend data, streamed as CSV */
router.get("/export/readings.csv", async (req, res, next) => {
  try {
    const p = readingsParams(req, "ts.asc");
    p.set("limit", "50000");
    const rows = await db.raw(`readings?${p}`);
    const HEAD = ["timestamp_utc", "received_at_utc", "event_id", "device_id", "patient_id",
      "tremor_score", "dominant_frequency_hz", "tremor_quality", "imu_rms", "jerk_peak",
      "gait_state", "cadence_hz", "freeze_active", "sequence", "source"];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="readings.csv"');
    res.write(HEAD.join(",") + "\n");
    for (const r of rows) {
      res.write([r.ts, r.received_at, r.event_id, r.device_id, r.patient_id,
        r.tremor_score, r.dominant_frequency_hz, r.tremor_quality, r.imu_rms, r.jerk_peak,
        r.gait_state, r.cadence_hz, r.freeze_active, r.sequence, r.source].map(esc).join(",") + "\n");
    }
    res.end();
  } catch (err) { next(err); }
});

module.exports = router;
