/* =========================================================
   PD-SENSE Live Monitor — app.js
   Wiring only. Data path:
     ESP32 -> backend API -> Supabase
     backend API --(REST poll + SSE)--> api.js -> state.js
       -> table.js / charts.js / infographics.js / events.js / graphics.js
   No manual entry. No localStorage patient data. No fabricated values:
   ?mode=demo is the ONLY synthetic path and it is loudly labelled.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const cfg = () => window.PDS.config;
  const st = () => window.PDS.state;
  const api = () => window.PDS.api;
  const diag = () => window.PDS.diagnostics;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let stream = null;
  let pollTimer = null;

  /* ---------------- demo mode (explicit, isolated, obvious) --------------- */
  let demoTimer = null;
  function startDemo() {
    document.body.classList.add("demo");
    $("demo-banner").hidden = false;
    let t = Date.now() - 30 * 60000, seq = 900;
    const gen = (now) => {
      const phase = (now / 90000) % 4;
      const walking = phase < 2.4;
      const quality = walking ? "MOTION_CONTAMINATED" : "VALID";
      const tr = quality === "VALID" ? +(2.5 + 2 * Math.sin(now / 60000)).toFixed(2) : null;
      return {
        id: seq, event_id: `demo-${seq++}`, device_id: "demo-device", patient_id: "DEMO",
        ts: new Date(now).toISOString(), received_at: new Date(now).toISOString(),
        sequence: seq, tremor_score: tr,
        dominant_frequency_hz: tr == null ? null : +(4.2 + Math.sin(now / 45000) * 0.6).toFixed(2),
        tremor_quality: quality, imu_rms: walking ? 0.21 : 0.04, jerk_peak: walking ? 0.8 : 0.2,
        gait_state: walking ? "WALKING" : "REST", cadence_hz: walking ? 1.7 : 0,
        freeze_active: false, source: "demo",
      };
    };
    while (t < Date.now()) { st().ingestReading(gen(t)); t += 15000; }
    demoTimer = setInterval(() => st().ingestReading(gen(Date.now())), cfg().pollMs);
    st().set({ backend: "online", backendDb: "connected", realtime: "connected",
               freshness: { state: "online", age_ms: 0 },
               patient: { id: "DEMO", display_name: "Demo patient (synthetic)", devices: ["demo-device"] },
               device: { device_id: "demo-device", enabled: true, fresh: true } });
  }

  /* ---------------- header / freshness ---------------- */
  function refreshHeader() {
    const badge = $("live-badge");
    const f = st().freshness;
    const demo = cfg().demo;
    let cls = "offline", txt = "OFFLINE";
    if (st().backend !== "online" && !demo) { txt = "BACKEND OFFLINE"; }
    else if (f.state === "online") { cls = "live"; txt = demo ? "DEMO DATA" : "LIVE"; }
    else if (f.state === "stale") { cls = "stale"; txt = "STALE — LAST KNOWN"; }
    else if (f.state === "never_seen") { txt = "NO TELEMETRY"; }
    if (badge) {
      badge.className = "live-badge " + cls;
      badge.innerHTML = `<span class="dot ${cls === "live" ? "ok" : "bad"}"></span> ${txt}`;
    }

    const meta = $("hdr-meta"), upd = $("hdr-updated");
    if (meta) meta.textContent = st().patient
      ? `${st().patient.display_name || st().patient.id} · device ${st().device ? st().device.device_id : "—"}`
      : "";
    if (upd) upd.textContent = st().latest
      ? `last packet ${new Date(st().latest.timestamp).toLocaleTimeString()} · ${f.age_ms == null ? "" : Math.max(0, Math.round(f.age_ms / 1000)) + " s ago"}`
      : "no packet received yet";
  }

  function tickFreshness() {
    if (cfg().demo) return;
    const latest = st().latest;
    const t = latest ? (latest.received_at || latest.timestamp) : null;
    const ageMs = t == null ? null : Date.now() - t;
    const state = ageMs == null ? "never_seen"
      : ageMs < cfg().freshOnlineMs ? "online"
      : ageMs < cfg().freshStaleMs ? "stale" : "offline";
    st().set({ freshness: { state, age_ms: ageMs } }, "health");
    refreshHeader();
  }

  /* ---------------- initial load + live loop ---------------- */
  async function boot() {
    $("clock").textContent = "";
    setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString(); }, 1000);

    window.PDS.table.init();
    window.PDS.charts.init();
    window.PDS.infographics.init();
    window.PDS.events.init();
    window.PDS.graphics.init();
    window.PDS.diagnostics.init();

    if (cfg().demo) { startDemo(); refreshHeader(); return; }

    /* auto-discover the backend when opened from Live Server/file:// */
    await api().ensureReachable();           // null-silent; badges say OFFLINE below

    /* patient list drives the selector (same code used for offline recovery) */
    try {
      await checkBackend(true);
      await bootstrapPatients();
    } catch (err) {
      st().set({ backend: "offline" }, "health");
      refreshHeader();
      $("empty-state").hidden = false;
      if (String(err.message).includes("token")) {
        $("empty-state").innerHTML = "Backend requires a dashboard token. Open with <code>?token=YOUR_DASHBOARD_TOKEN</code> once; it is remembered as a browser preference (docs/SECURITY.md).";
      } else {
        $("empty-state").innerHTML =
          `<b>BACKEND OFFLINE / NOT REACHED.</b> Nothing on this page can appear without it.<br>
           1) On the demo laptop: <code>cd server &amp;&amp; npm start</code> (needs <code>.env</code> — see docs/DEPLOYMENT.md).<br>
           2) If you opened this via Live Server / file://, pass the backend once:
           <code>?api=http://&lt;laptop-ip&gt;:3000&amp;token=&lt;DASHBOARD_TOKEN&gt;</code> (it's remembered).<br>
           3) Check <code>GET /api/health/database</code> — 503 means the Supabase migration/creds are missing.<br>
           <span class="dim">Layer-by-layer diagnosis: docs/TROUBLESHOOTING.md</span>`;
      }
    }

    /* primary: SSE; fallback + safety net: polling (poll also revives SSE
       after a backend outage) */
    const openStreamOnce = () => {
      if (stream || st().backend !== "online") return;
      stream = api().openStream((kind, data) => {
        if (kind === "reading") st().ingestReading(data);
        if (kind === "event") { st().ingestEvent(data); pullAux(); }
        if (kind === "alert") pullAlerts();
      }, (s) => {
        st().set({ realtime: s }, "health");
        if (s === "disconnected") { if (stream) { stream.close(); stream = null; } }
      });
    };
    openStreamOnce();

    pollTimer = setInterval(async () => {
      await pollTick();
      openStreamOnce();
    }, cfg().pollMs);
    setInterval(tickFreshness, 2000);
    await pollTick();
  }

  async function checkBackend(force) {
    try {
      await api().getHealth();
      const dbh = await api().getHealthDatabase();
      st().set({ backend: "online", backendDb: dbh.database === "connected" ? "connected" : "unreachable" }, "health");
      return true;
    } catch (err) {
      diag().note(`backend check failed: ${err.message}`);
      st().set({ backend: "offline", backendDb: "unreachable" }, "health");
      diag().note(`api: FAIL ${err.message}`);
      if (force) throw err;
      return false;
    }
  }

  function resetData() {
    st().set({ latest: null, readings: [], events: [], alerts: [], tapTests: [], medEvents: [],
               nextCursor: null, seenIds: new Set() });
  }

  async function loadAll(patientId) {
    const [latest, readings, events, alerts, tapTests, meds] = await Promise.all([
      api().getLatestReading(patientId).catch(() => null),
      api().getReadings({ patient_id: patientId, limit: cfg().defaultPageSize }).catch(() => ({ data: [] })),
      api().getEvents({ patient_id: patientId, limit: 60 }).catch(() => ({ data: [] })),
      api().getAlerts({ patient_id: patientId, limit: 30 }).catch(() => ({ data: [] })),
      api().getTapTests({ patient_id: patientId, limit: 50 }).catch(() => ({ data: [] })),
      api().getMedicationEvents({ patient_id: patientId, limit: 50 }).catch(() => ({ data: [] })),
    ]);

    st().set({ alerts: alerts.data || [] }, "alerts");
    st().set({ tapTests: tapTests.data || [] }, "tapTests");
    st().set({ medEvents: meds.data || [] }, "events");
    (events.data || []).forEach((e) => st().ingestEvent(e));
    (readings.data || []).forEach((r) => st().setReadings([r]));
    st().nextCursor = readings.next_cursor || null;
    if (latest && latest.data) { st().ingestReading(latest.data); }
    if (latest && latest.freshness) st().set({ freshness: latest.freshness }, "health");

    /* device status card — device is derived from the data, never assumed */
    const devs = await api().getDevices().catch(() => []);
    const latestRow = (readings.data || [])[0] || null;
    const dev = devs.find((d) => latestRow && d.device_id === latestRow.device_id)
             || devs.find((d) => d.patient_id === patientId)
             || null;
    if (dev) {
      const status = await api().getDeviceStatus(dev.device_id).catch(() => null);
      if (status) st().set({ device: status }, "health");
    }

    $("empty-state").hidden = !!st().readings.length;
    if (!st().readings.length) {
      $("empty-state").innerHTML =
        `<b>NO ESP32 TELEMETRY RECEIVED</b><br>
         Backend: ${st().backend.toUpperCase()} · Database: ${st().backendDb.toUpperCase()} · Device: NEVER SEEN<br>
         Verify the device: Serial console → <code>test api</code> (docs/TROUBLESHOOTING.md).`;
    }

    /* analytics + summary for the selected range */
    const range = st().range;
    const [analytics, summary] = await Promise.all([
      api().getAnalytics(patientId, range).catch(() => null),
      api().getPatientSummary(patientId, range).catch(() => null),
    ]);
    if (analytics) st().set({ analytics: analytics.data }, "patch");
    if (summary) st().set({ summary: summary.data }, "patch");
    renderHistory();
    refreshHeader();
  }

  async function bootstrapPatients() {
    const patients = await api().getPatients();
    const sel = $("patient-select");
    if (patients.length && sel) {
      sel.hidden = false;
      sel.innerHTML = patients.map((p) =>
        `<option value="${esc(p.id)}">${esc(p.display_name || p.id)} (${esc(p.id)})</option>`).join("");
      const want = cfg().prefs.patientId && patients.some((p) => p.id === cfg().prefs.patientId)
        ? cfg().prefs.patientId : patients[0].id;
      cfg().prefs.patientId = want; cfg().savePrefs();
      sel.onchange = () => { cfg().prefs.patientId = sel.value; cfg().savePrefs(); resetData(); loadAll(sel.value); };
      sel.value = want;
      await loadAll(want);
    } else {
      $("empty-state").hidden = false;
      $("empty-state").innerHTML = "<b>No patients registered.</b> The device registry seed in <code>server/.env</code> (DEVICE_SEED) creates the first one — restart the backend after setting it (docs/DEPLOYMENT.md).";
    }
  }

  async function pollTick() {
    if (cfg().demo) return;
    const ok = await checkBackend(false);
    if (!ok) { return; }
    const pid = st().patient && st().patient.id;
    if (!pid) {                    // recovered after an offline boot
      try { await bootstrapPatients(); $("empty-state").hidden = true; } catch { /* next poll */ }
      return;
    }
    try {
      const latest = await api().getLatestReading(pid);
      if (latest && latest.data) {
        st().ingestReading(latest.data);
        if (latest.freshness) st().set({ freshness: latest.freshness }, "health");
      }
      diag().note(`poll 200 latest=${latest && latest.data ? latest.data.event_id : "none"}`);
    } catch (err) {
      diag().note(`poll skipped: ${err.message}`);
    }
  }

  async function pullAlerts() {
    const pid = st().patient && st().patient.id; if (!pid) return;
    const a = await api().getAlerts({ patient_id: pid, limit: 30 }).catch(() => null);
    if (a) st().set({ alerts: a.data || [] }, "alerts");
  }
  async function pullAux() {
    const pid = st().patient && st().patient.id; if (!pid) return;
    const [tt, meds] = await Promise.all([
      api().getTapTests({ patient_id: pid, limit: 50 }).catch(() => null),
      api().getMedicationEvents({ patient_id: pid, limit: 50 }).catch(() => null),
    ]);
    if (tt) st().set({ tapTests: tt.data || [] }, "tapTests");
    if (meds) st().set({ medEvents: meds.data || [] }, "events");
  }

  /* ---------------- history / range summary ---------------- */
  function renderHistory() {
    const s = st().summary;
    const box = $("history-summary");
    if (!box) return;
    if (!s) { box.innerHTML = "No summary (backend unreachable or no data)."; return; }
    const tr = s.tremor || {};
    box.innerHTML = `
      <div class="hs-row"><span>Period</span><span>${s.period.start ? new Date(s.period.start).toLocaleString() : "—"} → ${s.period.end ? new Date(s.period.end).toLocaleString() : "—"}</span></div>
      <div class="hs-row"><span>Readings</span><span>${s.period.reading_count}</span></div>
      <div class="hs-row"><span>Data gaps</span><span>${s.period.data_gaps.length ? s.period.data_gaps.length + " gap(s) totalling " + s.period.data_gaps.reduce((a, g) => a + g.minutes, 0).toFixed(0) + " min" : "none"}</span></div>
      <div class="hs-row"><span>Tremor index</span><span>${tr.mean_index != null ? `avg ${tr.mean_index} · max ${tr.max_index} · ${tr.valid_windows} valid windows` : "insufficient data"}</span></div>
      <div class="hs-row"><span>Freeze events</span><span>${s.gait_freeze.freeze_events} recorded · ${s.gait_freeze.prolonged_freeze_alerts} prolonged-freeze alert(s)</span></div>
      <div class="hs-row"><span>Medication events</span><span>${s.medication_events.length} recorded (gesture events; observational only)</span></div>
      <div class="hs-row"><span>Tap tests</span><span>${s.tap_tests.length} (${s.tap_tests.filter((t) => t.quality === "COMPLETE").length} complete)</span></div>
      <div class="hs-note">${esc(s.language_note)}</div>`;
  }

  /* ---------------- range selector ---------------- */
  function initRanges() {
    document.querySelectorAll("#range-selector button").forEach((b) => {
      b.onclick = async () => {
        document.querySelectorAll("#range-selector button").forEach((x) => x.classList.toggle("active", x === b));
        st().set({ range: b.dataset.range }, "range");
        window.PDS.charts.update();
        window.PDS.table.render();
        window.PDS.events.render();
        if (!cfg().demo && st().patient) {
          const [analytics, summary] = await Promise.all([
            api().getAnalytics(st().patient.id, st().range).catch(() => null),
            api().getPatientSummary(st().patient.id, st().range).catch(() => null),
          ]);
          if (analytics) st().set({ analytics: analytics.data }, "patch");
          if (summary) st().set({ summary: summary.data }, "patch");
          renderHistory();
        }
      };
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initRanges();
    boot();
  });
})();
