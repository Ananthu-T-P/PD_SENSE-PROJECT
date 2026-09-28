"use strict";
/* Device authentication. ESP32 presents X-Device-Id + X-Device-Token.
 * Backend looks the device up in the devices registry (sha256 token hash),
 * verifies it is enabled, and DERIVES the patient association — a device
 * can never claim an arbitrary patient_id. Lookups cached 30 s; every
 * successful request bumps last_seen_at (throttled to 15 s). */
const crypto = require("crypto");
const db = require("../db");

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

const CACHE_MS = 30e3, SEEN_THROTTLE_MS = 15e3;
const deviceCache = new Map();   // device_id -> { row, at, lastSeenBump }

async function lookupDevice(deviceId) {
  const c = deviceCache.get(deviceId);
  if (c && Date.now() - c.at < CACHE_MS) return c.row;
  const rows = await db.select("devices", { device_id: `eq.${deviceId}` }, { limit: 1 });
  const row = rows[0] || null;
  deviceCache.set(deviceId, { row, at: Date.now(), lastSeenBump: (c && c.lastSeenBump) || 0 });
  return row;
}

async function deviceAuth(req, res, next) {
  try {
    const id = req.get("X-Device-Id");
    const token = req.get("X-Device-Token");
    if (!id || !token) return res.status(401).json({ error: "device credentials required" });

    const dev = await lookupDevice(id);
    if (!dev || !dev.enabled) return res.status(401).json({ error: "unknown or disabled device" });
    if (dev.token_hash !== sha256(token)) return res.status(401).json({ error: "invalid device token" });

    // body may not contradict registry identity
    if (req.body && req.body.device_id && req.body.device_id !== id) {
      return res.status(403).json({ error: "body device_id does not match authenticated device" });
    }

    req.device = { deviceId: dev.device_id, patientId: dev.patient_id, firmware: dev.firmware_version };

    const c = deviceCache.get(id);
    if (Date.now() - c.lastSeenBump > SEEN_THROTTLE_MS) {
      c.lastSeenBump = Date.now();
      db.update("devices", { device_id: `eq.${id}` },
        { last_seen_at: new Date().toISOString(),
          firmware_version: (req.body && req.body.fw) || dev.firmware_version }).catch(() => {});
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { deviceAuth, sha256 };
