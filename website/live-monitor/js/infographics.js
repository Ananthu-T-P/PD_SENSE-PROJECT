/* =========================================================
   PD-SENSE Live Monitor — infographics.js
   Metric cards, each driven by the SAME normalized latest reading
   as the table/charts. Every card carries: value, unit, quality
   state, and an info button opening the explanation drawer.
   Neutral language only: "tremor-band activity", never diagnosis.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const st = () => window.PDS.state;
  const $ = (id) => document.getElementById(id);

  const INFO = {
    tremor: {
      title: "Tremor index", field: "tremor_score",
      what: "Relative activity in the 3–8 Hz tremor band, scaled 0–10.",
      source: "MPU6050 accelerometer (on-device 256-sample FFT at 100 Hz).",
      how: "Band power share of the window -> 3-window confirmation -> smoothed index.",
      update: "Every device telemetry packet (~15 s).",
      quality: "Only shown when quality = VALID; otherwise N/A.",
      limits: "Movement metric, not a diagnosis. Gross body motion contaminates the window and is flagged MOTION_CONTAMINATED.",
    },
    freq: {
      title: "Dominant frequency", field: "dominant_frequency_hz",
      what: "Hz of the strongest spectral component in the analysis window.",
      source: "MPU6050 FFT (device).", how: "Peak bin of the magnitude spectrum.",
      update: "Every telemetry packet.", quality: "VALID only.",
      limits: "A frequency marker, not a disease classification.",
    },
    gait: {
      title: "Gait state", field: "gait_state",
      what: "Device gait state machine output.",
      source: "MPU6050 gyro channel (device).",
      how: "RMS walk/rest thresholds + cadence collapse confirmation (2 s) + recovery windows.",
      update: "Every telemetry packet.", quality: "Always reported while IMU is OK.",
      limits: "FREEZE is a candidate state from wrist motion; not a clinical FoG diagnosis.",
    },
    cadence: {
      title: "Cadence", field: "cadence_hz",
      what: "Detected steps per second over a rolling 4 s window.",
      source: "MPU6050 gyro (device).", how: "Falling-edge step detection through adaptive threshold.",
      update: "Every telemetry packet.", quality: "Valid while WALKING; 0 while at rest.",
      limits: "Wrist-mounted estimate; differs from footswitch cadence.",
    },
    brady: {
      title: "Bradykinesia (tap test)", field: null,
      what: "Grade 0–4 from inter-tap-interval mean/variance in the 20-tap test.",
      source: "MPU6050 tap detector (device), persisted as tap_test_completed events.",
      how: "ITI mean + coefficient of variation thresholds.",
      update: "After each completed tap test.",
      quality: "INCOMPLETE tests never produce a grade.",
      limits: "Experimental screening score; not a clinical rating scale.",
    },
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------------- per-metric renderers ---------------- */

  function tremorCard(r) {
    if (!r || r.tremor_score == null) return muted("TREMOR INDEX", "N/A", r ? r.tremor_quality : "NO DATA");
    const pct = Math.min(10, Math.max(0, r.tremor_score)) * 10;
    return `
      <div class="ig-label">TREMOR INDEX</div>
      <div class="ig-value">${r.tremor_score.toFixed(1)}<span class="ig-unit"> /10</span></div>
      <div class="ig-bar"><div class="ig-bar-fill" style="width:${pct}%"></div>
        <div class="ig-bar-marks">${[0, 2, 4, 6, 8, 10].map((v) => `<span>${v}</span>`).join("")}</div></div>
      <div class="ig-foot"><span class="q-badge q-${r.tremor_quality.toLowerCase()}">${r.tremor_quality}</span></div>`;
  }

  function freqCard(r) {
    if (!r || r.dominant_frequency_hz == null) return muted("FREQUENCY", "N/A", r ? r.tremor_quality : "NO DATA");
    const f = r.dominant_frequency_hz;
    const pct = Math.min(10, Math.max(0, f)) * 10;
    return `
      <div class="ig-label">TREMOR-BAND ACTIVITY — DOMINANT FREQUENCY</div>
      <div class="ig-value">${f.toFixed(2)}<span class="ig-unit"> Hz</span></div>
      <div class="ig-bar"><div class="ig-bar-marker" style="left:${pct}%"></div>
        <div class="ig-bar-marks">${[0, 2, 4, 6, 8, 10].map((v) => `<span>${v}</span>`).join("")}</div></div>
      <div class="ig-foot"><span class="q-badge q-${r.tremor_quality.toLowerCase()}">${r.tremor_quality}</span></div>`;
  }

  function gaitCard(r) {
    const s = r ? r.gait_state : null;
    const states = ["REST", "WALKING", "FREEZE_CANDIDATE", "FREEZE", "RECOVERY"];
    const lamp = (x) => `<span class="lamp${s === x ? " on" : ""}">${x.replace("_", " ")}</span>`;
    return `
      <div class="ig-label">GAIT STATE</div>
      <div class="ig-value small">${s ? esc(s.replace("_", " ")) : "—"}</div>
      <div class="lamp-row">${states.map(lamp).join("")}</div>
      <div class="ig-foot">${r && r.freeze_active ? '<span class="q-badge q-invalid">FREEZE ACTIVE</span>' : ""}</div>`;
  }

  let pulseTimer = null;
  function cadenceCard(r) {
    const c = r ? r.cadence_hz : null;
    const body = c == null || c === 0 ? `
      <div class="ig-label">CADENCE</div>
      <div class="ig-value">—<span class="ig-unit"> UNAVAILABLE</span></div>
      <div class="ig-foot">no steps detected in window</div>` : `
      <div class="ig-label">CADENCE</div>
      <div class="ig-value">${c.toFixed(2)}<span class="ig-unit"> Hz</span></div>
      <div class="cad-pulse" id="cad-pulse"></div>
      <div class="ig-foot">pulse below follows the measured cadence</div>`;
    /* real-rate pulse: re-arm the animation to the actual cadence */
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      const el = document.getElementById("cad-pulse");
      if (el && c) {
        el.style.animation = "none";
        el.offsetHeight;                          // restart CSS animation
        el.style.animation = `cadbeat ${1 / c}s ease-out infinite`;
      }
    }, 0);
    return body;
  }

  function bradyCard() {
    const t = st().tapTests[0];
    if (!t) return muted("BRADYKINESIA", "NO TAP TEST", "run a tap test on the device");
    const done = t.quality === "COMPLETE";
    return `
      <div class="ig-label">BRADYKINESIA — TAP TEST</div>
      <div class="ig-value small">${done ? `GRADE ${t.bradykinesia_grade} <span class="ig-unit">${esc(t.bradykinesia_label || "")}</span>` : "INCOMPLETE"}</div>
      <div class="ig-foot">${t.tap_count}/${t.target_count} taps
        ${t.duration_ms ? " · " + (t.duration_ms / 1000).toFixed(1) + " s" : ""}
        · ${new Date(t.completed_at).toLocaleString()}</div>`;
  }

  function muted(label, value, note) {
    return `<div class="ig-label">${label}</div>
      <div class="ig-value muted-val">${value}</div>
      <div class="ig-foot">${esc(note)}</div>`;
  }

  /* ---------------- device health + events ---------------- */

  function healthPanel() {
    const d = st().device, latest = st().latest, f = st().freshness;
    const noData = !latest;
    const dot = (state) => `<span class="dot ${state === true ? "ok" : state === false ? "bad" : "na"}"></span>`;
    /* state: true=ok (green), false=bad (red), null=no data yet (dim) */
    const row = (label, ok, val, sub) =>
      `<div class="health-row" title="${sub || ""}">
         <span>${label}${sub ? `<div class="hsub">${sub}</div>` : ""}</span>
         <span>${dot(ok)} ${val}</span>
       </div>`;
    const ageS = f.age_ms == null ? null : Math.max(0, Math.round(f.age_ms / 1000));
    return `
      <div class="health-row"><span><b>What is this?</b></span>
        <span class="dim" style="max-width:60%;text-align:right">Per-hop status of the data path — hardware, backend, database, live feed — and how fresh the last packet is.</span></div>
      ${row("IMU (MPU6050)", noData ? null : latest.sensor_imu === "OK", noData ? "NO DATA" : (latest.sensor_imu === "OK" ? "OK" : "FAULT"), "motion sensor on the wristband")}
      ${row("APDS9960", noData ? null : latest.sensor_apds === "OK", noData ? "NO DATA" : (latest.sensor_apds === "OK" ? "OK" : "FAULT"), "gesture sensor (medication events)")}
      ${row("Backend API", st().backend === "online", st().backend.toUpperCase(), "Node server that receives device packets")}
      ${row("Database", st().backendDb === "connected", st().backendDb.toUpperCase(), "Supabase — persistent storage")}
      ${row("Realtime feed", st().realtime === "connected", st().realtime.toUpperCase(), "SSE push; polling is the fallback")}
      ${row("Device liveness", f.state === "online", f.state === "never_seen" ? "NEVER SEEN" : `${f.state.toUpperCase()}${ageS != null ? " · " + ageS + "s ago" : ""}`, d ? d.device_id : "no telemetry received yet")}
      ${latest && latest.uptime_ms != null ? row("Device uptime", null, Math.round(latest.uptime_ms / 60000) + " min", "since last device boot") : ""}
      ${latest && latest.queue_dropped ? row("TELEMETRY LOSS", false, latest.queue_dropped + " dropped", "queue overflow on device — data lost", ) : ""}`;
  }

  /* ---------------- root render ---------------- */

  function render() {
    const latest = st().latest;
    const grid = $("metrics-grid");
    if (grid) {
      const cards = [
        { id: "tremor", html: tremorCard(latest) },
        { id: "freq", html: freqCard(latest) },
        { id: "gait", html: gaitCard(latest) },
        { id: "cadence", html: cadenceCard(latest) },
        { id: "brady", html: bradyCard() },
      ];
      for (const c of cards) {
        let el = document.getElementById("ig-" + c.id);
        if (!el) continue;
        el.innerHTML = c.html +
          `<button class="info-btn" data-metric="${c.id}" title="About this metric">i</button>`;
      }
      grid.querySelectorAll(".info-btn").forEach((b) =>
        b.onclick = () => showInfo(b.dataset.metric));
    }
    const hp = $("device-health");
    if (hp) hp.innerHTML = healthPanel();
  }

  function showInfo(metricId) {
    const m = INFO[metricId];
    if (!m) return;
    $("info-title").textContent = m.title;
    $("info-body").innerHTML = `
      <p><b>WHAT IT IS</b><br>${m.what}</p>
      <p><b>SOURCE</b><br>${m.source}</p>
      <p><b>HOW IT IS CALCULATED</b><br>${m.how}</p>
      <p><b>UPDATE INTERVAL</b><br>${m.update}</p>
      <p><b>QUALITY</b><br>${m.quality}</p>
      <p><b>LIMITATIONS</b><br>${m.limits}</p>`;
    $("info-drawer").hidden = false;
  }

  function init() {
    const closer = $("info-close");
    if (closer) closer.onclick = () => { $("info-drawer").hidden = true; };
    render();
    st().subscribe((topic) => {
      if (["reading", "event", "patch", "tapTests", "health"].includes(topic)) render();
    });
  }

  window.PDS.infographics = { init, render };
})();
