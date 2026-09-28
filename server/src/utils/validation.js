"use strict";
/* Validation. Telemetry packets are untrusted until proven otherwise:
 * reject NaN/Infinity, wrong types, impossible ranges, unknown event types,
 * oversized payloads — never silently coerce malformed data into records.
 * Pure module: unit-testable without express or the database. */

const TREMOR_QUALITIES = new Set(["VALID", "LOW_SIGNAL", "MOTION_CONTAMINATED", "INVALID"]);
const GAIT_STATES = new Set(["REST", "WALKING", "FREEZE_CANDIDATE", "FREEZE", "RECOVERY"]);
const EVENT_TYPES = new Set(["freeze", "possible_fall", "medication_event", "tap_test_completed"]);
const SEVERITIES = new Set(["info", "warning", "critical"]);
const SENSOR_STATES = new Set(["OK", "FAULT"]);

class ValidationError extends Error {
  constructor(msg) { super(msg); this.statusCode = 400; }
}

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === "boolean";
const isStr = (v, max = 128) => typeof v === "string" && v.length > 0 && v.length <= max;

function reject(msg) { throw new ValidationError(msg); }

function numRange(name, v, lo, hi, { nullable = false } = {}) {
  if (v === null || v === undefined) {
    if (nullable) return null;
    reject(`${name} is required`);
  }
  if (!isFiniteNum(v)) reject(`${name} must be a finite number`);
  if (v < lo || v > hi) reject(`${name} out of range [${lo}..${hi}]`);
  return v;
}

function optTimestamp(name, v) {
  if (v === null || v === undefined) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) reject(`${name} is not a valid ISO timestamp`);
  return new Date(t).toISOString();
}

/* ---------------- telemetry packet (schema_version 2) ---------------- */

function validateTelemetryPacket(body) {
  if (!body || typeof body !== "object") reject("body must be a JSON object");
  if (JSON.stringify(body).length > 4096) reject("payload too large");

  if (body.schema_version !== 2) reject("schema_version must be 2");
  if (body.type !== "telemetry") reject("type must be telemetry for a telemetry packet");
  if (!isStr(body.event_id, 96)) reject("event_id required (<=96 chars)");
  if (!isStr(body.device_id, 64)) reject("device_id required");
  if (!isInt(body.sequence) || body.sequence < 1 || body.sequence > 1e12) reject("sequence must be a positive integer");
  if (!isInt(body.device_ms) || body.device_ms < 0 || body.device_ms > 5e12) reject("device_ms invalid");

  const out = {
    event_id: body.event_id,
    device_id: body.device_id,
    device_ms: body.device_ms,
    sequence: body.sequence,
    timestamp: optTimestamp("timestamp", body.timestamp),   // device NTP time (may be absent)
    tremor_score: numRange("tremor_score", body.tremor_score, 0, 10, { nullable: true }),
    dominant_frequency_hz: numRange("dominant_frequency_hz", body.dominant_frequency_hz, 0, 64, { nullable: true }),
    imu_rms: numRange("imu_rms", body.imu_rms, 0, 20),
    jerk_peak: numRange("jerk_peak", body.jerk_peak, 0, 100),
    cadence_hz: numRange("cadence_hz", body.cadence_hz, 0, 8),
    freeze_active: isBool(body.freeze_active) ? body.freeze_active : reject("freeze_active must be boolean"),
    uptime_ms: body.uptime_ms === undefined ? null : numRange("uptime_ms", body.uptime_ms, 0, 1e13),
  };

  if (out.tremor_score !== null && body.dominant_frequency_hz == null) {
    reject("dominant_frequency_hz required when tremor_score present");
  }
  if (!TREMOR_QUALITIES.has(body.tremor_quality)) reject("tremor_quality invalid");
  out.tremor_quality = body.tremor_quality;
  if (out.tremor_quality !== "VALID") {
    out.tremor_score = null;                 // protocol: invalid quality means NO score,
    out.dominant_frequency_hz = null;        // never a fake value — enforce server-side too
  }
  if (!GAIT_STATES.has(body.gait_state)) reject("gait_state invalid");
  out.gait_state = body.gait_state;

  const s = body.sensors;
  out.sensor_imu = s && SENSOR_STATES.has(s.imu) ? s.imu : "FAULT";
  out.sensor_apds = s && SENSOR_STATES.has(s.apds) ? s.apds : "FAULT";

  const net = body.network;
  out.rssi = net && isInt(net.rssi) ? Math.max(-120, Math.min(0, net.rssi)) : null;
  out.queue_depth = isInt(body.queue_depth) ? Math.min(body.queue_depth, 1000) : null;
  out.queue_dropped = isInt(body.queue_dropped) ? Math.min(body.queue_dropped, 1e9) : null;
  out.fw_version = isStr(body.fw, 32) ? body.fw : null;

  return out;
}

/* ---------------- discrete event packet ---------------- */

function validateEventPacket(body) {
  if (!body || typeof body !== "object") reject("body must be a JSON object");
  if (JSON.stringify(body).length > 4096) reject("payload too large");

  if (body.schema_version !== 2) reject("schema_version must be 2");
  if (body.type !== "event") reject("type must be event");
  if (!isStr(body.event_id, 96)) reject("event_id required");
  if (!isStr(body.device_id, 64)) reject("device_id required");
  if (!EVENT_TYPES.has(body.event_type)) reject(`unknown event_type "${body.event_type}"`);
  if (!isInt(body.sequence) || body.sequence < 1 || body.sequence > 1e12) reject("sequence invalid");
  if (!isInt(body.device_ms) || body.device_ms < 0 || body.device_ms > 5e12) reject("device_ms invalid");

  const out = {
    event_id: body.event_id,
    device_id: body.device_id,
    device_ms: body.device_ms,
    sequence: body.sequence,
    event_type: body.event_type,
    timestamp: optTimestamp("timestamp", body.timestamp),
    source: "device",
    payload: {},
  };

  switch (body.event_type) {
    case "freeze": {
      out.duration_ms = numRange("duration_ms", body.duration_ms, 0, 3600e3);
      out.severity = out.duration_ms >= 8000 ? "warning" : "info";
      break;
    }
    case "possible_fall": {
      out.payload.jerk_peak = numRange("jerk_peak", body.jerk_peak, 0, 200);
      out.payload.still_ms = numRange("still_ms", body.still_ms, 0, 600e3);
      out.duration_ms = body.duration_ms == null ? out.payload.still_ms
        : numRange("duration_ms", body.duration_ms, 0, 600e3);
      out.severity = "critical";
      break;
    }
    case "medication_event": {
      const g = String(body.gesture || "").toUpperCase();
      if (!["LEFT", "RIGHT", "UP", "DOWN", "NEAR", "FAR"].includes(g)) reject("gesture invalid");
      out.payload.gesture = g;
      out.severity = "info";
      break;
    }
    case "tap_test_completed": {
      out.payload.tap_count = numRange("tap_count", body.tap_count, 0, 1000);
      out.payload.target_count = numRange("target_count", body.target_count, 1, 1000);
      out.duration_ms = numRange("duration_ms", body.duration_ms, 0, 600e3);
      const q = String(body.quality || "").toUpperCase();
      if (!["COMPLETE", "INCOMPLETE", "TIMEOUT"].includes(q)) reject("tap quality invalid");
      out.payload.quality = q;
      /* INCOMPLETE tests NEVER carry a fabricated grade */
      if (q === "COMPLETE") {
        out.payload.bradykinesia_grade = numRange("bradykinesia_grade", body.bradykinesia_grade, 0, 4);
        if (!isStr(body.bradykinesia_label, 32)) reject("bradykinesia_label required for completed test");
        out.payload.bradykinesia_label = body.bradykinesia_label;
      } else {
        out.payload.bradykinesia_grade = null;
        out.payload.bradykinesia_label = "INCOMPLETE";
      }
      out.severity = "info";
      break;
    }
  }
  if (body.severity && SEVERITIES.has(String(body.severity))) out.severity = body.severity;
  return out;
}

/* ---------------- query validation ---------------- */

function parseLimit(raw, def = 50, max = 500) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 1), max);
}

function parseTimeRange(q) {
  const out = {};
  if (q.from) { const t = Date.parse(q.from); if (Number.isFinite(t)) out.from = new Date(t).toISOString(); }
  if (q.to) { const t = Date.parse(q.to); if (Number.isFinite(t)) out.to = new Date(t).toISOString(); }
  if (q.range) {
    const m = { "1h": 3600e3, "24h": 86400e3, "48h": 2 * 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 }[q.range];
    if (m) out.from = new Date(Date.now() - m).toISOString();
  }
  return out;
}

module.exports = {
  ValidationError, validateTelemetryPacket, validateEventPacket,
  parseLimit, parseTimeRange, TREMOR_QUALITIES, GAIT_STATES, EVENT_TYPES,
};
