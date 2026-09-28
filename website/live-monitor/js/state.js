/* =========================================================
   PD-SENSE Live Monitor — state.js
   The ONE frontend store. In-memory only — the backend is the
   authoritative patient database; localStorage holds ONLY UI
   preferences (config.js owns those).

   Normalized reading contract (single shape consumed by table,
   charts, infographics and the animation):

   {
     event_id:        string,
     timestamp:       ms epoch (device NTP time when synced),
     received_at:     ms epoch (backend ingest clock),
     ingest_latency_ms: number|null,
     device_id:       string,
     patient_id:      string,
     sequence:        number,
     tremor_score:    number|null,     // null unless quality === VALID
     dominant_frequency_hz: number|null,
     tremor_quality:  'VALID'|'LOW_SIGNAL'|'MOTION_CONTAMINATED'|'INVALID',
     imu_rms:         number|null,
     jerk_peak:       number|null,
     gait_state:      'REST'|'WALKING'|'FREEZE_CANDIDATE'|'FREEZE'|'RECOVERY',
     cadence_hz:      number|null,
     freeze_active:   boolean,
     rssi:            number|null,
     uptime_ms:       number|null,
     queue_depth:     number|null,
     queue_dropped:   number|null,
     source:          string           // 'device' | 'demo'
   }

   Normalized event contract:
   { event_id, event_type, timestamp, received_at, duration_ms,
     severity, device_id, patient_id, source, payload }
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";

  const state = {
    backend: "connecting",        // connecting | online | offline
    backendDb: "unknown",         // unknown | connected | unreachable
    realtime: "disconnected",     // connecting | connected | degraded | disconnected
    patient: null,                // { id, display_name, devices, freshness }
    device: null,                 // device status object
    latest: null,                 // normalized reading
    freshness: { state: "never_seen", age_ms: null },
    readings: [],                 // newest-first (bounded to maxKeep)
    events: [], alerts: [], tapTests: [], medEvents: [],
    summary: null, analytics: null,
    range: "24h",
    seenIds: new Set(),
    maxKeep: 500,
  };

  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(topic) { for (const fn of listeners) fn(topic, state); }

  /* ---------------- normalization (the single data contract) -------- */
  function num(v) { return (typeof v === "number" && Number.isFinite(v)) ? v : null; }

  function normalizeReading(r) {
    if (!r || !r.event_id) return null;
    const ts = Date.parse(r.ts || r.received_at);
    const rec = Date.parse(r.received_at || r.ts);
    return {
      event_id: r.event_id,
      id: num(r.id),                 // backend row id — keyset pagination cursor
      timestamp: Number.isFinite(ts) ? ts : rec,
      received_at: Number.isFinite(rec) ? rec : null,
      ingest_latency_ms: Number.isFinite(ts) && Number.isFinite(rec) ? rec - ts : null,
      device_id: r.device_id || null,
      patient_id: r.patient_id || null,
      sequence: num(r.sequence),
      tremor_score: num(r.tremor_score),
      dominant_frequency_hz: num(r.dominant_frequency_hz),
      tremor_quality: r.tremor_quality || "INVALID",
      imu_rms: num(r.imu_rms),
      jerk_peak: num(r.jerk_peak),
      gait_state: r.gait_state || "REST",
      cadence_hz: num(r.cadence_hz),
      freeze_active: !!r.freeze_active,
      rssi: num(r.rssi),
      uptime_ms: num(r.uptime_ms),
      queue_depth: num(r.queue_depth),
      queue_dropped: num(r.queue_dropped),
      sensor_imu: r.sensor_imu || null,
      sensor_apds: r.sensor_apds || null,
      source: r.source || "device",
    };
  }

  function normalizeEvent(e) {
    if (!e || !e.event_id) return null;
    return {
      event_id: e.event_id,
      event_type: e.event_type,
      timestamp: Date.parse(e.ts) || null,
      received_at: Date.parse(e.received_at) || null,
      duration_ms: num(e.duration_ms),
      severity: e.severity || "info",
      device_id: e.device_id || null,
      patient_id: e.patient_id || null,
      source: e.source || "device",
      payload: e.payload || {},
    };
  }

  /* ---------------- ingestion ---------------- */
  /** returns the normalized row if it was NEW, else null */
  function ingestReading(raw) {
    const r = normalizeReading(raw);
    if (!r || state.seenIds.has("r:" + r.event_id)) return null;
    state.seenIds.add("r:" + r.event_id);
    /* newest-first bounded list */
    let i = 0;
    while (i < state.readings.length && state.readings[i].timestamp > r.timestamp) i++;
    state.readings.splice(i, 0, r);
    if (state.readings.length > state.maxKeep) {
      const tail = state.readings.splice(state.maxKeep);
      tail.forEach((x) => state.seenIds.delete("r:" + x.event_id));
    }
    if (!state.latest || r.timestamp >= state.latest.timestamp) state.latest = r;
    emit("reading");
    return r;
  }

  function ingestEvent(raw) {
    const e = normalizeEvent(raw);
    if (!e || state.seenIds.has("e:" + e.event_id)) return null;
    state.seenIds.add("e:" + e.event_id);
    let i = 0;
    while (i < state.events.length && state.events[i].timestamp > e.timestamp) i++;
    state.events.splice(i, 0, e);
    emit("event");
    return e;
  }

  function setReadings(rows) {  // bulk (initial load / pagination)
    for (const r of rows) {
      const n = normalizeReading(r);
      if (n && !state.seenIds.has("r:" + n.event_id)) {
        state.seenIds.add("r:" + n.event_id);
        state.readings.push(n);
      }
    }
    state.readings.sort((a, b) => b.timestamp - a.timestamp);
    if (state.readings.length > state.maxKeep) {
      const tail = state.readings.splice(state.maxKeep);
      tail.forEach((x) => state.seenIds.delete("r:" + x.event_id));
    }
    if (state.readings.length) state.latest = state.readings[0];
    emit("reading");
  }

  function set(patch, topic = "patch") { Object.assign(state, patch); emit(topic); }

  window.PDS.state = Object.assign(state, {
    subscribe, emit, ingestReading, ingestEvent, setReadings,
    normalizeReading, normalizeEvent,
  });
})();
