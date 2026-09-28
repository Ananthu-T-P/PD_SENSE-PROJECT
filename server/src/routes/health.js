"use strict";
const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "pd-sense-backend", time: new Date().toISOString() });
});

router.get("/health/database", async (req, res, next) => {
  try {
    await db.ping();
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(503).json({ status: "fail", database: "unreachable", detail: err.message });
  }
});

module.exports = router;
