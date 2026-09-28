"use strict";
/* Device registry routes. Registration/editing goes through the dashboard
 * token (a human operator), never through device credentials. */
const express = require("express");
const db = require("../db");
const { sha256 } = require("../middleware/deviceAuth");

const router = express.Router();

router.get("/devices", async (req, res, next) => {
  try {
    const rows = await db.raw("devices?select=device_id,patient_id,enabled,firmware_version,last_seen_at,created_at,updated_at&order=device_id.asc");
    res.json({ data: rows, count: rows.length });
  } catch (err) { next(err); }
});

router.post("/devices", async (req, res, next) => {
  try {
    const { device_id, patient_id, token, enabled = true } = req.body || {};
    if (!device_id || !patient_id || !token) {
      return res.status(400).json({ error: "device_id, patient_id and token are required" });
    }
    /* patient must exist — the registry is the association authority */
    const p = await db.raw(`patients?select=id&id=eq.${encodeURIComponent(patient_id)}&limit=1`);
    if (!p.length) return res.status(400).json({ error: `unknown patient "${patient_id}"` });

    const row = {
      device_id, patient_id, enabled: !!enabled,
      token_hash: sha256(token),
      updated_at: new Date().toISOString(),
    };
    await db.upsert("devices", row, "device_id");
    res.status(201).json({ status: "registered", device_id, patient_id });
  } catch (err) { next(err); }
});

router.patch("/devices/:id", async (req, res, next) => {
  try {
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "enabled")) patch.enabled = !!req.body.enabled;
    if (req.body && req.body.patient_id) patch.patient_id = req.body.patient_id;
    if (req.body && req.body.token) patch.token_hash = sha256(req.body.token);
    if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
    patch.updated_at = new Date().toISOString();
    const rows = await db.update("devices", { device_id: `eq.${req.params.id}` }, patch);
    if (!rows.length) return res.status(404).json({ error: "unknown device" });
    res.json({ status: "updated", device_id: req.params.id });
  } catch (err) { next(err); }
});

module.exports = router;
