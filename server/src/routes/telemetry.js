"use strict";
/* POST /api/v1/telemetry — the ONLY write path from ESP32 devices.
 * Auth: deviceAuth (device token). Bodies validated per schema_version 2. */
const express = require("express");
const { deviceAuth } = require("../middleware/deviceAuth");
const telemetry = require("../services/telemetryService");

const router = express.Router();

router.post("/telemetry", deviceAuth, async (req, res, next) => {
  try {
    const result = await telemetry.ingest(req.device, req.body);
    res.status(200).json(result);           // 200 for both stored and already_processed
  } catch (err) { next(err); }
});

module.exports = router;
