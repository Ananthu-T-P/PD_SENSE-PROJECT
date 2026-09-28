"use strict";
const express = require("express");
const db = require("../db");
const { parseLimit, parseTimeRange } = require("../utils/validation");
const { decodeCursor, nextCursor } = require("../utils/pagination");

const router = express.Router();

/* GET /api/v1/events — unified discrete event stream */
router.get("/events", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 50);
    const p = new URLSearchParams({ select: "*", order: "ts.desc", limit: String(limit) });
    if (req.query.patient_id) p.set("patient_id", `eq.${req.query.patient_id}`);
    if (req.query.device_id) p.set("device_id", `eq.${req.query.device_id}`);
    if (req.query.type) p.set("event_type", `eq.${req.query.type}`);
    const range = parseTimeRange(req.query);
    if (range.from) p.append("ts", `gte.${range.from}`);
    if (range.to) p.append("ts", `lte.${range.to}`);
    const before = decodeCursor(req.query.before);
    if (before !== null) p.set("id", `lt.${before}`);
    const rows = await db.raw(`events?${p}`);
    res.json({ data: rows, next_cursor: nextCursor(rows, limit), count: rows.length });
  } catch (err) { next(err); }
});

/* GET /api/v1/alerts — backend-owned persisted alerts */
router.get("/alerts", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 50);
    const p = new URLSearchParams({ select: "*", order: "ts.desc", limit: String(limit) });
    if (req.query.patient_id) p.set("patient_id", `eq.${req.query.patient_id}`);
    if (req.query.status) p.set("status", `eq.${req.query.status}`);
    const range = parseTimeRange(req.query);
    if (range.from) p.append("ts", `gte.${range.from}`);
    if (range.to) p.append("ts", `lte.${range.to}`);
    const rows = await db.raw(`alerts?${p}`);
    res.json({ data: rows, count: rows.length });
  } catch (err) { next(err); }
});

/* PATCH /api/v1/alerts/:id — lifecycle transitions */
router.patch("/alerts/:id", async (req, res, next) => {
  try {
    const status = String((req.body && req.body.status) || "");
    if (!["open", "acknowledged", "resolved", "delivery_failed"].includes(status)) {
      return res.status(400).json({ error: "status must be open|acknowledged|resolved|delivery_failed" });
    }
    const rows = await db.update("alerts", { id: `eq.${req.params.id}` }, { status });
    res.json({ data: rows[0] || null });
  } catch (err) { next(err); }
});

/* GET /api/v1/medication-events — device-gesture medication event records */
router.get("/medication-events", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 50);
    const p = new URLSearchParams({ select: "*", order: "ts.desc", limit: String(limit) });
    if (req.query.patient_id) p.set("patient_id", `eq.${req.query.patient_id}`);
    const range = parseTimeRange(req.query);
    if (range.from) p.append("ts", `gte.${range.from}`);
    if (range.to) p.append("ts", `lte.${range.to}`);
    const rows = await db.raw(`medication_events?${p}`);
    res.json({ data: rows, count: rows.length });
  } catch (err) { next(err); }
});

/* GET /api/v1/tap-tests — completed (and incomplete) tap test results */
router.get("/tap-tests", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 50);
    const p = new URLSearchParams({ select: "*", order: "completed_at.desc", limit: String(limit) });
    if (req.query.patient_id) p.set("patient_id", `eq.${req.query.patient_id}`);
    const range = parseTimeRange(req.query);
    if (range.from) p.append("completed_at", `gte.${range.from}`);
    if (range.to) p.append("completed_at", `lte.${range.to}`);
    const rows = await db.raw(`tap_tests?${p}`);
    res.json({ data: rows, count: rows.length });
  } catch (err) { next(err); }
});

module.exports = router;
