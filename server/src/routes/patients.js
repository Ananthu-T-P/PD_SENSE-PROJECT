"use strict";
/* Patients, devices, summaries, analytics, SSE stream. */
const express = require("express");
const db = require("../db");
const bus = require("../bus");
const { parseLimit, parseTimeRange } = require("../utils/validation");
const { trends, findGaps, freshness } = require("../services/analyticsService");
const summaryService = require("../services/summaryService");

const router = express.Router();

/* GET /api/v1/patients — registry with derived freshness */
router.get("/patients", async (req, res, next) => {
  try {
    const patients = await db.raw("patients?select=*&order=id.asc");
    const devices = await db.raw("devices?select=*");
    const out = [];
    for (const p of patients) {
      const devs = devices.filter((d) => d.patient_id === p.id);
      const lastSeen = devs.reduce((m, d) => {
        const t = d.last_seen_at ? Date.parse(d.last_seen_at) : 0;
        return Math.max(m, t);
      }, 0);
      out.push({ ...p, devices: devs.map((d) => d.device_id),
                 freshness: freshness(lastSeen || null) });
    }
    res.json({ data: out, count: out.length });
  } catch (err) { next(err); }
});

/* GET /api/v1/devices/:id/status — true device state from telemetry, not labels */
router.get("/devices/:id/status", async (req, res, next) => {
  try {
    const devs = await db.select("devices", { device_id: `eq.${req.params.id}` }, { limit: 1 });
    const dev = devs[0];
    if (!dev) return res.status(404).json({ error: "unknown device" });
    const latest = await db.raw(`readings?select=*&device_id=eq.${encodeURIComponent(dev.device_id)}&order=ts.desc&limit=1`);
    res.json({
      device_id: dev.device_id, patient_id: dev.patient_id, enabled: dev.enabled,
      firmware_version: dev.firmware_version, last_seen_at: dev.last_seen_at,
      freshness: freshness(dev.last_seen_at ? Date.parse(dev.last_seen_at) : null),
      latest: latest[0] || null,
    });
  } catch (err) { next(err); }
});

/* GET /api/v1/patients/:id/summary — derived doctor summary (neutral language) */
router.get("/patients/:id/summary", async (req, res, next) => {
  try {
    const pid = req.params.id;
    const range = parseTimeRange(req.query);
    const from = range.from || new Date(Date.now() - 7 * 86400e3).toISOString();
    const to = range.to || new Date().toISOString();

    const rq = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, order: "ts.asc", limit: "20000" });
    rq.append("ts", `gte.${from}`); rq.append("ts", `lte.${to}`);
    const rrows = await db.raw(`readings?${rq}`);
    const readings = rrows.map((r) => ({ ...r, ts: Date.parse(r.ts) }));

    const eq = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, order: "ts.asc", limit: "5000" });
    eq.append("ts", `gte.${from}`); eq.append("ts", `lte.${to}`);
    const events = await db.raw(`events?${eq}`);

    const mq = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, order: "ts.asc" });
    mq.append("ts", `gte.${from}`); mq.append("ts", `lte.${to}`);
    const medEvents = await db.raw(`medication_events?${mq}`);

    const aq = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, order: "ts.asc" });
    aq.append("ts", `gte.${from}`); aq.append("ts", `lte.${to}`);
    const alertRows = await db.raw(`alerts?${aq}`);

    const tq = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, order: "completed_at.asc" });
    tq.append("completed_at", `gte.${from}`); tq.append("completed_at", `lte.${to}`);
    const tapTests = await db.raw(`tap_tests?${tq}`);

    const summary = summaryService.summarize({ readings, events, medEvents, alerts: alertRows, tapTests });
    summary.patient_id = pid;
    res.json({ data: summary });
  } catch (err) { next(err); }
});

/* GET /api/v1/patients/:id/analytics — bucketed trends + gaps */
router.get("/patients/:id/analytics", async (req, res, next) => {
  try {
    const pid = req.params.id;
    const range = parseTimeRange(req.query);
    const now = Date.now();
    const fromMs = range.from ? Date.parse(range.from) : now - 24 * 3600e3;
    const toMs = range.to ? Date.parse(range.to) : now;

    const p = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, order: "ts.asc", limit: "50000" });
    p.append("ts", `gte.${new Date(fromMs).toISOString()}`);
    p.append("ts", `lte.${new Date(toMs).toISOString()}`);
    const rows = (await db.raw(`readings?${p}`)).map((r) => ({ ...r, ts: Date.parse(r.ts) }));

    const merge = [];
    /* rollups for history older than the raw window (behave like readings) */
    if ((await db.count("readings_rollup", { patient_id: `eq.${pid}` }).catch(() => 0)) > 0) {
      const rp = new URLSearchParams({ select: "*", patient_id: `eq.${pid}`, bucket_start: `lt.${new Date(fromMs).toISOString()}`, order: "bucket_start.asc", limit: "10000" });
      const roll = await db.raw(`readings_rollup?${rp}`).catch(() => []);
      for (const b of roll) {
        merge.push({ ts: Date.parse(b.bucket_start), tremor_score: b.avg_tremor_amplitude ?? b.avg_tremor_score,
                     dominant_frequency_hz: b.avg_dominant_frequency_hz ?? b.avg_dominant_frequency,
                     cadence_hz: b.avg_cadence_hz, jerk_peak: null, freeze_active: (b.freeze_events || 0) > 0,
                     tremor_quality: "VALID" });
      }
    }

    res.json({
      data: {
        buckets: trends([...merge, ...rows], fromMs, toMs, parseLimit(req.query.buckets, 48, 192)),
        gaps: findGaps(rows),
        reading_count: rows.length,
        rollup_buckets: merge.length,
      },
    });
  } catch (err) { next(err); }
});

/* GET /api/v1/stream — SSE: live pushes of new readings/events/alerts */
router.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: hello\ndata: {"ok":true,"time":"${new Date().toISOString()}"}\n\n`);
  bus.addClient(res);
  req.on("close", () => bus.removeClient(res));
});

module.exports = router;
