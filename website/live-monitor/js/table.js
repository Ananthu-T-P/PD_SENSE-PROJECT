/* =========================================================
   PD-SENSE Live Monitor — table.js
   LIVE ESP32 READINGS — the section that proves the website shows
   the actual device data. Consumes ONLY PDS.state.readings
   (normalized contract). Features: pagination (25/50/100 + Load
   more via backend cursor), column control, row detail drawer,
   new-row highlight, NEW DATA banner that never hijacks scroll.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const st = () => window.PDS.state;
  const api = () => window.PDS.api;

  const COLS = [
    { id: "timestamp", label: "Time", default: true,
      render: (r) => new Date(r.timestamp).toLocaleTimeString([], { hour12: false }) },
    { id: "tremor", label: "Tremor", default: true,
      render: (r) => (r.tremor_score == null ? "N/A" : r.tremor_score.toFixed(2)) },
    { id: "freq", label: "Freq", default: true,
      render: (r) => (r.dominant_frequency_hz == null ? "N/A" : r.dominant_frequency_hz.toFixed(2) + " Hz") },
    { id: "quality", label: "Quality", default: true,
      render: (r) => r.tremor_quality },
    { id: "imu_rms", label: "IMU RMS", default: false,
      render: (r) => (r.imu_rms == null ? "N/A" : r.imu_rms.toFixed(3)) },
    { id: "jerk", label: "Jerk", default: true,
      render: (r) => (r.jerk_peak == null ? "N/A" : r.jerk_peak.toFixed(2)) },
    { id: "gait", label: "Gait", default: true, render: (r) => r.gait_state },
    { id: "cadence", label: "Cadence", default: true,
      render: (r) => (r.cadence_hz == null ? "N/A" : r.cadence_hz.toFixed(2) + " Hz") },
    { id: "freeze", label: "Freeze", default: false, render: (r) => (r.freeze_active ? "YES" : "—") },
    { id: "event_id", label: "Event ID", default: false,
      render: (r) => `<code>${esc(r.event_id)}</code>` },
    { id: "device", label: "Device", default: false, render: (r) => esc(r.device_id || "—") },
    { id: "sequence", label: "Seq", default: false, render: (r) => (r.sequence ?? "—") },
    { id: "source", label: "Source", default: false, render: (r) => esc(r.source) },
  ];

  let maxRows = window.PDS.config.defaultPageSize;
  let nextCursorVal = null;
  let loading = false;
  let newSinceView = 0;         // rows arrived while user was scrolled
  let lastTopId = null;
  let selectedId = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function activeCols() {
    const prefs = st().columnsVisible || {};
    return COLS.filter((c) => (c.id in prefs ? prefs[c.id] : c.default));
  }

  function inRange(r) {
    const range = st().range;
    const now = Date.now();
    const win = { "1h": 3600e3, "24h": 86400e3, "48h": 2 * 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 }[range];
    if (!win) return true;
    return r.timestamp >= now - win;
  }

  function render() {
    const head = $("rt-head"), body = $("rt-body");
    if (!head || !body) return;

    const cols = activeCols();
    head.innerHTML = "<tr>" + cols.map((c) => `<th>${c.label}</th>`).join("") + "</tr>";

    const rows = st().readings.filter(inRange).slice(0, maxRows);
    body.innerHTML = rows.map((r) => {
      const cls = [r.event_id === selectedId ? "sel" : "",
                   r.event_id === lastTopId ? "fresh" : ""].join(" ").trim();
      return `<tr data-eid="${esc(r.event_id)}" class="${cls}">` +
        cols.map((c) => `<td>${c.render(r)}</td>`).join("") + "</tr>";
    }).join("");

    $("rt-empty").style.display = rows.length ? "none" : "";
    body.querySelectorAll("tr").forEach((tr) =>
      tr.addEventListener("click", () => {
        selectedId = tr.dataset.eid;
        const r = st().readings.find((x) => x.event_id === selectedId);
        render();
      }));

    /* new-row flash bookkeeping */
    if (rows.length) {
      if (lastTopId && rows[0].event_id !== lastTopId &&
          document.getElementById("rt-scroll").scrollTop > 60) {
        newSinceView++;
        const b = $("rt-newdata");
        b.hidden = false;
        b.textContent = `NEW DATA — ${newSinceView} RECORD${newSinceView === 1 ? "" : "S"} — SHOW NEWEST`;
      }
      lastTopId = rows[0].event_id;
    }
    if (document.getElementById("rt-scroll").scrollTop <= 60) {
      newSinceView = 0; $("rt-newdata").hidden = true;
    }
  }

  function renderDetail(r) {
    const el = $("rt-detail");
    if (!r) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `
      <div class="detail-head"><b>READING DETAILS</b><button id="rt-detail-close" class="btn small">close</button></div>
      <dl class="detail-grid">
        <dt>Event ID</dt><dd><code>${esc(r.event_id)}</code></dd>
        <dt>Device</dt><dd>${esc(r.device_id ?? "—")}</dd>
        <dt>Patient</dt><dd>${esc(r.patient_id ?? "—")}</dd>
        <dt>Device time</dt><dd>${new Date(r.timestamp).toISOString()}</dd>
        <dt>Received</dt><dd>${r.received_at ? new Date(r.received_at).toISOString() : "—"}</dd>
        <dt>Ingest latency</dt><dd>${r.ingest_latency_ms == null ? "—" : r.ingest_latency_ms + " ms"}</dd>
        <dt>Sequence</dt><dd>${r.sequence ?? "—"}</dd>
        <dt>Tremor index</dt><dd>${r.tremor_score == null ? "N/A" : r.tremor_score.toFixed(2) + " / 10"}</dd>
        <dt>Dominant frequency</dt><dd>${r.dominant_frequency_hz == null ? "N/A" : r.dominant_frequency_hz.toFixed(2) + " Hz"}</dd>
        <dt>Tremor quality</dt><dd>${esc(r.tremor_quality)}</dd>
        <dt>IMU RMS</dt><dd>${r.imu_rms == null ? "N/A" : r.imu_rms.toFixed(4) + " g"}</dd>
        <dt>Jerk peak</dt><dd>${r.jerk_peak == null ? "N/A" : r.jerk_peak.toFixed(2) + " g/s"}</dd>
        <dt>Gait state</dt><dd>${esc(r.gait_state)}</dd>
        <dt>Cadence</dt><dd>${r.cadence_hz == null ? "N/A" : r.cadence_hz.toFixed(2) + " Hz"}</dd>
        <dt>Freeze active</dt><dd>${r.freeze_active ? "YES" : "no"}</dd>
        <dt>RSSI</dt><dd>${r.rssi == null ? "—" : r.rssi + " dBm"}</dd>
        <dt>Queue</dt><dd>depth ${r.queue_depth ?? "—"} · dropped ${r.queue_dropped ?? "—"}</dd>
        <dt>Source</dt><dd>${esc(r.source)}</dd>
      </dl>`;
    $("rt-detail-close").onclick = () => { selectedId = null; renderDetail(null); render(); };
  }

  /* ---------------- pagination ---------------- */
  async function loadMore() {
    if (loading || !st().patient) return;
    if (!st().nextCursor) { $("rt-more").disabled = true; return; }
    loading = true;
    try {
      const res = await api().getReadings({
        patient_id: st().patient.id, limit: maxRows, before: st().nextCursor,
      });
      st().setReadings(res.data || []);
      st().nextCursor = res.next_cursor || null;
      if (!st().nextCursor) $("rt-more").disabled = true;
    } catch (err) {
      $("rt-empty").textContent = "Load failed: " + err.message;
    } finally { loading = false; }
  }

  function init() {
    const sel = $("rt-size");
    if (sel) {
      sel.innerHTML = window.PDS.config.pageSizes
        .map((n) => `<option${n === maxRows ? " selected" : ""}>${n}</option>`).join("");
      sel.onchange = () => { maxRows = parseInt(sel.value, 10); render(); };
    }
    const more = $("rt-more");
    if (more) more.onclick = loadMore;
    const nb = $("rt-newdata");
    if (nb) nb.onclick = () => {
      document.getElementById("rt-scroll").scrollTop = 0;
      newSinceView = 0; nb.hidden = true; render();
    };
    const colBtn = $("rt-cols");
    if (colBtn) colBtn.onclick = toggleColumnPanel;
    $("rt-csv").onclick = () => {
      const range = st().range;
      window.open(api().exportCsvUrl({ patient_id: st().patient && st().patient.id, range }), "_blank");
    };
    window.PDS.state.subscribe((topic, s) => {
      if (topic === "reading" || topic === "patch" && s) render();
    });
    render();
  }

  function toggleColumnPanel() {
    let panel = $("rt-colpanel");
    if (panel) { panel.remove(); return; }
    panel = document.createElement("div");
    panel.id = "rt-colpanel";
    const prefs = st().columnsVisible || (st().columnsVisible = {});
    panel.innerHTML = COLS.map((c) => {
      const on = c.id in prefs ? prefs[c.id] : c.default;
      return `<label><input type="checkbox" data-col="${c.id}"${on ? " checked" : ""}> ${c.label}</label>`;
    }).join("");
    colAnchor().appendChild(panel);
    panel.querySelectorAll("input").forEach((cb) =>
      cb.addEventListener("change", () => { prefs[cb.dataset.col] = cb.checked; render(); }));
  }
  const colAnchor = () => $("rt-controls");

  window.PDS.table = { init, render };
})();
