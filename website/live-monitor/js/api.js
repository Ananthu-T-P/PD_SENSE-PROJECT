/* =========================================================
   PD-SENSE Live Monitor — api.js
   THE single fetch layer. Every UI module reads through here;
   no scattered fetch() calls anywhere else in the frontend.
   Backend: ../server (Node/Express). Auth: Authorization: Bearer <token>.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const cfg = () => window.PDS.config;

  async function req(path, { params, method = "GET", body } = {}) {
    const url = new URL(cfg().apiBase + path, cfg().apiBase ? undefined : location.origin);
    if (params) for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch(url, {
        method, signal: ctrl.signal,
        headers: Object.assign(
          { Accept: "application/json" },
          body ? { "Content-Type": "application/json" } : {},
          cfg().token ? { Authorization: `Bearer ${cfg().token}` } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(`backend unreachable (${err.name === "AbortError" ? "timeout" : err.message})`);
    } finally { clearTimeout(to); }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { /* csv etc. */ }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  /* ---------------- health ---------------- */
  const getHealth = () => req("/api/health");
  const getHealthDatabase = () => req("/api/health/database");

  /* ---------------- data reads ---------------- */
  const getPatients = () => req("/api/v1/patients").then((r) => r.data);
  const getDevices = () => req("/api/v1/devices").then((r) => r.data);
  const getDeviceStatus = (id) => req(`/api/v1/devices/${encodeURIComponent(id)}/status`);

  const getLatestReading = (patientId) =>
    req("/api/v1/readings/latest", { params: { patient_id: patientId } });

  const getReadings = (opt) => req("/api/v1/readings", { params: opt });
  const getEvents = (opt) => req("/api/v1/events", { params: opt });
  const getAlerts = (opt) => req("/api/v1/alerts", { params: opt });
  const getMedicationEvents = (opt) => req("/api/v1/medication-events", { params: opt });
  const getTapTests = (opt) => req("/api/v1/tap-tests", { params: opt });

  const getPatientSummary = (patientId, range) =>
    req(`/api/v1/patients/${encodeURIComponent(patientId)}/summary`, { params: { range } });
  const getAnalytics = (patientId, range) =>
    req(`/api/v1/patients/${encodeURIComponent(patientId)}/analytics`, { params: { range } });

  const ackAlert = (id, status) =>
    req(`/api/v1/alerts/${id}`, { method: "PATCH", body: { status } });

  function exportCsvUrl(opt) {
    const url = new URL(cfg().apiBase + "/api/v1/export/readings.csv",
      cfg().apiBase ? undefined : location.origin);
    for (const [k, v] of Object.entries(opt || {})) if (v) url.searchParams.set(k, v);
    if (cfg().token) url.searchParams.set("access_token", cfg().token);
    return url.toString();
  }

  /* ---------------- SSE stream (primary live push) ----------------
     onState: (state) => void, state in
     connecting | connected | degraded | disconnected */
  function openStream(onMessage, onState) {
    const es = new EventSource(
      `${cfg().apiBase || location.origin}/api/v1/stream${cfg().token ? `?access_token=${encodeURIComponent(cfg().token)}` : ""}`);
    let lastMsg = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastMsg > 45000) onState && onState("degraded");
    }, 10000);
    es.onopen = () => onState && onState("connected");
    es.onerror = () => { onState && onState(es.readyState === EventSource.CLOSED ? "disconnected" : "degraded"); };
    for (const kind of ["reading", "event", "alert"]) {
      es.addEventListener(kind, (e) => {
        lastMsg = Date.now();
        try { onMessage(kind, JSON.parse(e.data)); } catch { /* ignore bad frame */ }
      });
    }
    es.addEventListener("hello", () => { lastMsg = Date.now(); });
    return { close() { clearInterval(watchdog); es.close(); } };
  }

  window.PDS.api = {
    getHealth, getHealthDatabase, getPatients, getDevices, getDeviceStatus,
    getLatestReading, getReadings, getEvents, getAlerts,
    getMedicationEvents, getTapTests, getPatientSummary, getAnalytics,
    ackAlert, exportCsvUrl, openStream,
  };
})();
