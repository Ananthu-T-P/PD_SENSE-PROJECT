"use strict";
const { test } = require("node:test");
process.env.PD_SENSE_SKIP_ENV_CHECK = "1";
const assert = require("node:assert/strict");
const {
  validateTelemetryPacket, validateEventPacket, ValidationError,
} = require("../src/utils/validation");

const baseTelemetry = () => ({
  schema_version: 2, type: "telemetry",
  event_id: "pd-sense-01-abcd1234-7", device_id: "pd-sense-01",
  device_ms: 900000, sequence: 7,
  timestamp: new Date().toISOString(),
  tremor_score: 4.2, dominant_frequency_hz: 4.7, tremor_quality: "VALID",
  imu_rms: 0.42, jerk_peak: 0.9, gait_state: "WALKING", cadence_hz: 1.72,
  freeze_active: false,
  sensors: { imu: "OK", apds: "OK" }, network: { rssi: -61 },
  uptime_ms: 910000, queue_depth: 0, queue_dropped: 0, fw: "7.0-rebuild",
});

test("valid telemetry packet passes", () => {
  const out = validateTelemetryPacket(baseTelemetry());
  assert.equal(out.event_id, "pd-sense-01-abcd1234-7");
  assert.equal(out.tremor_score, 4.2);
  assert.equal(out.sensor_imu, "OK");
});

test("missing event_id rejected", () => {
  const b = baseTelemetry(); delete b.event_id;
  assert.throws(() => validateTelemetryPacket(b), ValidationError);
});

test("wrong schema_version rejected", () => {
  const b = baseTelemetry(); b.schema_version = 1;
  assert.throws(() => validateTelemetryPacket(b), ValidationError);
});

test("out-of-range tremor rejected", () => {
  const b = baseTelemetry(); b.tremor_score = 42;
  assert.throws(() => validateTelemetryPacket(b), ValidationError);
});

test("non-finite values rejected (Infinity)", () => {
  const b = baseTelemetry(); b.imu_rms = Infinity;
  assert.throws(() => validateTelemetryPacket(b), ValidationError);
});

test("NAN tolerance: nulls allowed only for tremor pair", () => {
  const b = baseTelemetry();
  b.tremor_quality = "MOTION_CONTAMINATED";
  b.tremor_score = 9.9;      // must be nullified by quality rule
  b.dominant_frequency_hz = 5.5;
  const out = validateTelemetryPacket(b);
  assert.equal(out.tremor_score, null);
  assert.equal(out.dominant_frequency_hz, null);
});

test("unknown gait state rejected", () => {
  const b = baseTelemetry(); b.gait_state = "TELEPORTING";
  assert.throws(() => validateTelemetryPacket(b), ValidationError);
});

/* ------------------------- events ------------------------- */

test("complete tap test keeps grade", () => {
  const out = validateEventPacket({
    schema_version: 2, type: "event", event_type: "tap_test_completed",
    event_id: "pd-01-x-3", device_id: "pd-01", device_ms: 5, sequence: 3,
    tap_count: 20, target_count: 20, duration_ms: 18200,
    bradykinesia_grade: 2, bradykinesia_label: "Mild", quality: "COMPLETE",
  });
  assert.equal(out.payload.bradykinesia_grade, 2);
});

test("incomplete tap test can NEVER carry a grade", () => {
  const out = validateEventPacket({
    schema_version: 2, type: "event", event_type: "tap_test_completed",
    event_id: "pd-01-x-4", device_id: "pd-01", device_ms: 5, sequence: 4,
    tap_count: 12, target_count: 20, duration_ms: 30000,
    bradykinesia_grade: 3, bradykinesia_label: "Mild", quality: "INCOMPLETE",
  });
  assert.equal(out.payload.bradykinesia_grade, null);
  assert.equal(out.payload.bradykinesia_label, "INCOMPLETE");
});

test("freeze event duration validated", () => {
  const out = validateEventPacket({
    schema_version: 2, type: "event", event_type: "freeze",
    event_id: "pd-01-x-5", device_id: "pd-01", device_ms: 5, sequence: 5,
    duration_ms: 8400,
  });
  assert.equal(out.duration_ms, 8400);
  assert.equal(out.severity, "warning");
});

test("unknown event type rejected", () => {
  assert.throws(() => validateEventPacket({
    schema_version: 2, type: "event", event_type: "patient_cured",
    event_id: "x", device_id: "pd-01", device_ms: 1, sequence: 1,
  }), ValidationError);
});

test("medication event gesture whitelisted", () => {
  assert.throws(() => validateEventPacket({
    schema_version: 2, type: "event", event_type: "medication_event",
    event_id: "x", device_id: "pd-01", device_ms: 1, sequence: 1,
    gesture: "SIDEWAYS",
  }), ValidationError);
});
