"use strict";
/* Backend-owned alert evaluation. The device emits candidate EVENTS; the
 * backend alone decides what becomes a persisted, deduplicated ALERT:
 *
 *   freeze event >= threshold              -> prolonged_freeze (warning)
 *   possible_fall event                    -> possible_fall (critical)
 *   N consecutive high tremor readings     -> high_tremor (warning)
 *
 * Cooldown is DB-backed (never an init-zero in-memory trap): the FIRST
 * qualifying episode after boot/forever is always allowed; repeats of the
 * same type within ALERT_COOLDOWN_MS are suppressed. Alert rows carry a
 * lifecycle status: open -> acknowledged -> resolved.
 * deliverAlerts() (email/pager bridge) may flip open->delivered; a failed
 * delivery lands as delivery_failed WITHOUT touching the cooldown — a
 * transient failure never burns the alert.
 */
const db = require("../db");
const config = require("../config");
const bus = require("../bus");

const A = config.ALERTS;
const tremorRun = new Map();   // device_id -> consecutive-high-tremor count

async function createAlert({ patientId, deviceId, eventType, severity, detail, ts }) {
  /* DB-backed per-type cooldown */
  const since = new Date(Date.now() - A.COOLDOWN_MS).toISOString();
  const recent = await db.select("alerts",
    { patient_id: `eq.${patientId}`, event_type: `eq.${eventType}`, ts: `gte.${since}` },
    { limit: 1, order: "ts.desc" });
  if (recent.length) return { created: false, reason: "cooldown" };

  const { rows } = await db.insert("alerts", {
    patient_id: patientId, device_id: deviceId,
    ts: ts || new Date().toISOString(),
    event_type: eventType, severity, detail: detail || null,
    status: "open", detected_at: new Date().toISOString(),
  });
  const alert = rows[0];
  if (alert) bus.broadcast("alert", alert);
  return { created: true, alert };
}

/** Called for every accepted event packet. */
async function evaluateEvent(device, payload) {
  if (payload.event_type === "freeze" && payload.duration_ms >= A.PROLONGED_FREEZE_MS) {
    return createAlert({
      patientId: device.patientId, deviceId: device.deviceId,
      eventType: "prolonged_freeze", severity: "warning",
      detail: `Freeze episode of ${Math.round(payload.duration_ms / 1000)}s recorded by device.`,
      ts: payload.timestamp || new Date().toISOString(),
    });
  }
  if (payload.event_type === "possible_fall") {
    return createAlert({
      patientId: device.patientId, deviceId: device.deviceId,
      eventType: "possible_fall", severity: "critical",
      detail: `Impact (${payload.payload.jerk_peak} g/s) followed by ${payload.payload.still_ms} ms near-stillness. Candidate event — not a confirmed fall.`,
      ts: payload.timestamp || new Date().toISOString(),
    });
  }
  return { created: false };
}

/** Called for every accepted telemetry packet. */
async function evaluateTelemetry(device, p) {
  const key = device.deviceId;
  if (p.tremor_quality === "VALID" && p.tremor_score != null && p.tremor_score >= A.HIGH_TREMOR_SCORE) {
    const n = (tremorRun.get(key) || 0) + 1;
    tremorRun.set(key, n);
    if (n >= A.HIGH_TREMOR_CONSEC) {
      tremorRun.set(key, 0);   // one alert per sustained run, cooldown still applies
      return createAlert({
        patientId: device.patientId, deviceId: device.deviceId,
        eventType: "high_tremor", severity: "warning",
        detail: `Tremor-band activity index >= ${A.HIGH_TREMOR_SCORE} sustained across ${A.HIGH_TREMOR_CONSEC} consecutive windows (latest ${p.tremor_score}).`,
        ts: new Date().toISOString(),
      });
    }
  } else {
    tremorRun.set(key, 0);
  }
  return { created: false };
}

module.exports = { createAlert, evaluateEvent, evaluateTelemetry };
