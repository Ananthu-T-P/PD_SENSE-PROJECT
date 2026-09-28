"use strict";
/* Telemetry ingest: validate -> dedupe by event_id (DB unique) -> persist
 * -> evaluate backend alerts -> broadcast over SSE.
 *
 * Duplicate deliveries (device retry after lost response, or device reboot
 * reuse of a sequence) resolve deterministically to { status:
 * "already_processed" } with HTTP 200 — no second row, no error.
 *
 * Devices never claim patients: patient_id comes from the device registry
 * entry verified by the deviceAuth middleware. */
const db = require("../db");
const bus = require("../bus");
const { validateTelemetryPacket, validateEventPacket } = require("../utils/validation");
const alerts = require("./alertService");

/* shape stored in readings (columns match migrations/0001) */
function readingRow(device, p) {
  return {
    event_id: p.event_id,
    device_id: device.deviceId,
    patient_id: device.patientId,
    ts: p.timestamp || new Date().toISOString(),   // device NTP time or ingest time
    received_at: new Date().toISOString(),          // authoritative ingest clock
    schema_version: 2,
    sequence: p.sequence,
    device_ms: p.device_ms,
    tremor_score: p.tremor_score,
    dominant_frequency_hz: p.dominant_frequency_hz,
    tremor_quality: p.tremor_quality,
    imu_rms: p.imu_rms,
    jerk_peak: p.jerk_peak,
    gait_state: p.gait_state,
    cadence_hz: p.cadence_hz,
    freeze_active: p.freeze_active,
    uptime_ms: p.uptime_ms,
    queue_depth: p.queue_depth,
    queue_dropped: p.queue_dropped,
    rssi: p.rssi,
    sensor_imu: p.sensor_imu,
    sensor_apds: p.sensor_apds,
    fw_version: p.fw_version,
    source: "device",
  };
}

function eventRow(device, p) {
  return {
    event_id: p.event_id,
    device_id: device.deviceId,
    patient_id: device.patientId,
    event_type: p.event_type,
    ts: p.timestamp || new Date().toISOString(),
    received_at: new Date().toISOString(),
    device_ms: p.device_ms,
    duration_ms: p.duration_ms ?? null,
    severity: p.severity || "info",
    payload: p.payload || {},
    source: "device",
  };
}

async function ingest(device, body) {
  if (!body || typeof body !== "object") {
    const e = new Error("JSON body required"); e.statusCode = 400; throw e;
  }
  if (body.type === "telemetry") return ingestTelemetry(device, body);
  if (body.type === "event") return ingestEvent(device, body);
  const e = new Error('type must be "telemetry" or "event"'); e.statusCode = 400; throw e;
}

async function ingestTelemetry(device, body) {
  const p = validateTelemetryPacket(body);
  const { rows, inserted } = await db.insert("readings", readingRow(device, p), { ignoreDuplicates: true });
  if (!inserted) return { status: "already_processed", event_id: p.event_id };
  const row = rows[0];
  bus.broadcast("reading", row);
  try { await alerts.evaluateTelemetry(device, p); } catch (err) {
    console.error(`[alerts] telemetry evaluation failed (telemetry stored OK): ${err.message}`);
  }
  return { status: "stored", event_id: p.event_id, id: row && row.id };
}

async function ingestEvent(device, body) {
  const p = validateEventPacket(body);
  const { rows, inserted } = await db.insert("events", eventRow(device, p), { ignoreDuplicates: true });
  if (!inserted) return { status: "already_processed", event_id: p.event_id };
  const row = rows[0];

  /* side tables by event type — same event_id, same dedupe */
  try {
    if (p.event_type === "tap_test_completed") {
      await db.insert("tap_tests", {
        event_id: p.event_id, device_id: device.deviceId, patient_id: device.patientId,
        completed_at: p.timestamp || new Date().toISOString(),
        tap_count: p.payload.tap_count, target_count: p.payload.target_count,
        duration_ms: p.duration_ms,
        bradykinesia_grade: p.payload.bradykinesia_grade,
        bradykinesia_label: p.payload.bradykinesia_label,
        quality: p.payload.quality, source: "device",
      }, { ignoreDuplicates: true });
    } else if (p.event_type === "medication_event") {
      await db.insert("medication_events", {
        event_id: p.event_id, device_id: device.deviceId, patient_id: device.patientId,
        ts: p.timestamp || new Date().toISOString(),
        gesture: p.payload.gesture, source: "device",
      }, { ignoreDuplicates: true });
    }
  } catch (err) {
    console.error(`[ingest] side-table insert failed for ${p.event_id}: ${err.message}`);
  }

  bus.broadcast("event", row);
  try { await alerts.evaluateEvent(device, p); } catch (err) {
    console.error(`[alerts] event evaluation failed (event stored OK): ${err.message}`);
  }
  return { status: "stored", event_id: p.event_id, id: row && row.id };
}

module.exports = { ingest, readingRow, eventRow };
