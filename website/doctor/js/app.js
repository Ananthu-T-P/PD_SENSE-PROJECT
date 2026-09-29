/* =========================================================
   PD-SENSE Doctor Portal — app.js
   Reads only the PD-SENSE backend API (same data the Live Monitor
   shows, in a clinician-oriented layout). No patient data ever
   comes from localStorage or the public site.
   ========================================================= */
(function () {
  "use strict";
  const api = () => window.PDS.api;
  const cfg = () => window.PDS.config;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let patientId = null;

  setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString(); }, 1000);

  const fmtT = (iso) => iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  async function boot() {
    await api().ensureReachable();
    try {
      await api().getHealth();
      const dbh = await api().getHealthDatabase();
      $("conn-badge").textContent = dbh.database === "connected" ? "CONNECTED" : "DB OFFLINE";
      $("conn-badge").classList.add(dbh.database === "connected" ? "ok" : "bad");
    } catch (err) {
      $("conn-badge").textContent = "BACKEND OFFLINE";
      $("conn-badge").classList.add("bad");
      $("empty-state").hidden = false;
      $("empty-state").innerHTML = "Backend unreachable. Start the PD-SENSE backend (server/) and reload." +
        (String(err.message).includes("token") ? " A dashboard token is required — open with ?token=YOUR_TOKEN." : "");
      return;
    }

    const patients = await api().getPatients().catch(() => []);
    if (!patients.length) {
      $("patient-select").innerHTML = "<option>— no patients (check backend) —</option>";
      $("patient-select").disabled = true;
      $("empty-state").hidden = false;
      $("empty-state").innerHTML = "No patients registered, or the backend cannot be reached. Start <code>server/</code> (docs/DEPLOYMENT.md), then reload. If opened via Live Server/file:// add <code>?api=http://&lt;backend&gt;:3000&amp;token=&lt;DASHBOARD_TOKEN&gt;</code> once.";
      return;
    }
    $("patient-select").disabled = false;
    $("patient-select").innerHTML = patients.map((p) =>
      `<option value="${esc(p.id)}">${esc(p.display_name || p.id)} (${esc(p.id)})</option>`).join("");
    patientId = (cfg().prefs.patientId && patients.some((p) => p.id === cfg().prefs.patientId))
      ? cfg().prefs.patientId : patients[0].id;
    $("patient-select").value = patientId;

    $("patient-select").onchange = () => { patientId = $("patient-select").value; cfg().prefs.patientId = patientId; cfg().savePrefs(); load(); };
    $("range-select").onchange = load;
    $("export-csv").onclick = () =>
      window.open(api().exportCsvUrl({ patient_id: patientId, range: $("range-select").value }), "_blank");

    await load();
    setInterval(loadStatusOnly, 15000);
  }

  async function loadStatusOnly() {
    if (!patientId) return;
    const patients = await api().getPatients().catch(() => null);
    if (patients) renderStatus(patients.find((p) => p.id === patientId));
  }

  async function load() {
    const range = $("range-select").value;
    $("sum-range").textContent = "· " + range;
    const [patients, summary, analytics, readings, events, alerts, meds, taps] = await Promise.all([
      api().getPatients().catch(() => []),
      api().getPatientSummary(patientId, range).catch(() => null),
      api().getAnalytics(patientId, range).catch(() => null),
      api().getReadings({ patient_id: patientId, limit: 50 }).catch(() => ({ data: [] })),
      api().getEvents({ patient_id: patientId, limit: 40, range }).catch(() => ({ data: [] })),
      api().getAlerts({ patient_id: patientId, limit: 20, range }).catch(() => ({ data: [] })),
      api().getMedicationEvents({ patient_id: patientId, limit: 40, range }).catch(() => ({ data: [] })),
      api().getTapTests({ patient_id: patientId, limit: 40 }).catch(() => ({ data: [] })),
    ]);
    renderStatus(patients.find((p) => p.id === patientId));
    renderSummary(summary && summary.data);
    renderTrends(analytics && analytics.data);
    renderEvents((events.data || []), (alerts.data || []));
    renderMeds(meds.data || []);
    renderTaps(taps.data || []);
    renderReadings(readings.data || []);
  }

  function renderStatus(p) {
    if (!p) return;
    const f = p.freshness || {};
    const ageTxt = f.age_ms == null ? "never" : `${Math.round(f.age_ms / 1000)} s ago`;
    $("status-grid").innerHTML = `
      <div class="stat"><div class="k">PATIENT</div><div class="v">${esc(p.display_name || p.id)}</div></div>
      <div class="stat"><div class="k">DEVICES</div><div class="v">${(p.devices || []).map(esc).join(", ") || "—"}</div></div>
      <div class="stat"><div class="k">FRESHNESS</div><div class="v">${esc(f.state || "never_seen")}</div></div>
      <div class="stat"><div class="k">LAST TELEMETRY</div><div class="v">${ageTxt === "never" ? "—" : ageTxt}</div></div>`;
  }

  function renderSummary(s) {
    if (!s) { $("summary-body").textContent = "No data in range."; return; }
    const tr = s.tremor || {};
    const meds = s.medication_events || [];
    $("summary-body").innerHTML = `
      <div class="sum-row"><span>Measurement period</span><span>${fmtT(s.period.start)} → ${fmtT(s.period.end)} (${s.period.reading_count} readings)</span></div>
      <div class="sum-row"><span>Data gaps</span><span>${s.period.data_gaps.length ? s.period.data_gaps.map((g) => `${Math.round(g.minutes)} min`).join(", ") : "none detected"}</span></div>
      <div class="sum-row"><span>Tremor index</span><span>${tr.mean_index != null ? `average ${tr.mean_index} · peak ${tr.max_index} (from ${tr.valid_windows} valid analysis windows)` : "Insufficient data"}</span></div>
      <div class="sum-row"><span>Gait / freeze</span><span>${s.gait_freeze.freeze_events} freeze episode(s) recorded · ${s.gait_freeze.prolonged_freeze_alerts} prolonged-freeze alert(s)</span></div>
      <div class="sum-row"><span>Tap tests</span><span>${s.tap_tests.length} recorded (${s.tap_tests.filter((t) => t.quality === "COMPLETE").length} complete)${s.tap_tests.length && s.tap_tests[0].quality === "COMPLETE" ? ` — latest grade ${s.tap_tests[s.tap_tests.length - 1].bradykinesia_grade}` : ""}</span></div>
      <div class="sum-row"><span>Medication events</span><span>${meds.length} gesture record(s) on device</span></div>
      ${meds.map((m) => `<div class="sum-row"><span>· event ${fmtT(m.event_ts)}</span><span>${
        m.onset_minutes != null
          ? `A lower tremor index was observed starting ~${m.onset_minutes} min after the recorded event (lower-tremor window ~${m.lower_window_minutes} min${m.window_open ? ", window still open at end of data" : ""}).`
          : esc(m.note)
      }</span></div>`).join("")}
      <div class="sum-row"><span>Alerts</span><span>${(s.alerts || []).length ? s.alerts.map((a) => `${a.event_type} (${a.severity}, ${a.status})`).join("; ") : "none"}</span></div>
      <div class="sum-note">${esc(s.language_note || "")}</div>`;
  }

  let charts = {};
  function renderTrends(an) {
    if (!an || typeof Chart === "undefined") return;
    const defs = [
      ["tremor", "Tremor index (bucket avg)", an.buckets.map((b) => ({ x: Date.parse(b.bucket_start), y: b.tremor_avg })), "#e07856", 0, 10],
      ["freq", "Dominant frequency Hz (bucket avg)", an.buckets.map((b) => ({ x: Date.parse(b.bucket_start), y: b.freq_avg })), "#5aa2c4", 0, 10],
      ["cadence", "Cadence Hz (bucket avg)", an.buckets.map((b) => ({ x: Date.parse(b.bucket_start), y: b.cadence_avg })), "#7fb39f", 0, 4],
    ];
    for (const [id, label, data, color, min, max] of defs) {
      const cv = document.getElementById("chart-" + id);
      if (!cv) continue;
      if (charts[id]) { charts[id].data.datasets[0].data = data; charts[id].update("none"); continue; }
      charts[id] = new Chart(cv, {
        type: "line",
        data: { datasets: [{ data, borderColor: color, borderWidth: 1.5, pointRadius: 0, spanGaps: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { title: (it) => new Date(it[0].parsed.x).toLocaleString() } } },
          scales: {
            x: { type: "linear", grid: { color: "rgba(154,167,178,.1)" }, ticks: { color: "#9aa7b2", maxTicksLimit: 6, callback: (v) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" }) } },
            y: { min, max, grid: { color: "rgba(154,167,178,.1)" }, ticks: { color: "#9aa7b2" },
                 title: { display: true, text: label, color: "#9aa7b2", font: { size: 10 } } },
          } },
      });
    }
  }

  function renderEvents(events, alerts) {
    const box = $("events-body");
    const items = [
      ...alerts.map((a) => ({ ts: Date.parse(a.ts), cls: a.severity === "critical" ? "bad" : "warn",
        txt: `ALERT ${a.event_type} (${a.severity}) ${a.status} — ${a.detail || ""}` })),
      ...events.filter((e) => e.event_type === "freeze" || e.event_type === "possible_fall")
        .map((e) => ({ ts: Date.parse(e.ts), cls: e.event_type === "possible_fall" ? "bad" : "warn",
          txt: e.event_type === "freeze"
            ? `Freeze episode, ${(e.duration_ms / 1000).toFixed(1)} s`
            : `Possible fall candidate — impact ${e.payload && e.payload.jerk_peak} g/s + stillness (unconfirmed)` })),
    ].sort((a, b) => b.ts - a.ts);
    box.innerHTML = items.length
      ? items.map((i) => `<div class="li ${i.cls}"><span class="t">${new Date(i.ts).toLocaleTimeString([], { hour12: false })}</span><span>${esc(i.txt)}</span></div>`).join("")
      : '<div class="li info"><span class="t">—</span><span>No freeze or alert events in range.</span></div>';
  }

  function renderMeds(meds) {
    const box = $("meds-body");
    box.innerHTML = meds.length
      ? meds.map((m) => `<div class="li info"><span class="t">${new Date(m.ts).toLocaleTimeString([], { hour12: false })}</span>
          <span>Medication event recorded on device (gesture ${esc(m.gesture)}). A gesture record is not proof of intake.</span></div>`).join("")
      : '<div class="li info"><span class="t">—</span><span>No medication gesture events in range.</span></div>';
  }

  function renderTaps(taps) {
    $("tap-empty").style.display = taps.length ? "none" : "";
    $("tap-body").innerHTML = taps.map((t) => `<tr>
      <td>${fmtT(t.completed_at)}</td>
      <td>${t.tap_count}/${t.target_count}</td>
      <td>${t.duration_ms ? (t.duration_ms / 1000).toFixed(1) + " s" : "—"}</td>
      <td>${t.quality === "COMPLETE" ? `${t.bradykinesia_grade} (${esc(t.bradykinesia_label || "")})` : "—"}</td>
      <td>${t.quality}</td></tr>`).join("");
  }

  function renderReadings(rows) {
    $("readings-empty").style.display = rows.length ? "none" : "";
    $("readings-body").innerHTML = rows.map((r) => `<tr>
      <td>${new Date(r.ts).toLocaleTimeString([], { hour12: false })}</td>
      <td>${r.tremor_score == null ? "N/A" : (+r.tremor_score).toFixed(2)}</td>
      <td>${r.dominant_frequency_hz == null ? "N/A" : (+r.dominant_frequency_hz).toFixed(2)}</td>
      <td>${esc(r.tremor_quality || "")}</td>
      <td>${esc(r.gait_state || "")}</td>
      <td>${r.cadence_hz == null ? "N/A" : (+r.cadence_hz).toFixed(2)}</td>
      <td>${r.freeze_active ? "YES" : "—"}</td></tr>`).join("");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
