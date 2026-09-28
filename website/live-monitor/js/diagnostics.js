/* =========================================================
   PD-SENSE Live Monitor — diagnostics.js
   ?debugData=true     — API response -> normalized -> rendered view
                         (diagnoses "database has data, page shows
                         nothing" issues layer by layer)
   ?debugGraphics=true — FPS / frame time / packet throughput HUD
   Hidden entirely in normal mode.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const cfg = () => window.PDS.config;
  const st = () => window.PDS.state;

  const log = [];
  function note(line) {
    log.push(`${new Date().toLocaleTimeString()}  ${line}`);
    if (log.length > 200) log.shift();
  }

  function renderDataPanel() {
    const el = document.getElementById("dbg-data");
    if (!el) return;
    const latest = st().latest;
    el.innerHTML = `
      <h3>DEBUG DATA (?debugData=true)</h3>
      <div class="dbg-grid">
        <div><b>Backend</b><br>${st().backend} · DB ${st().backendDb} · realtime ${st().realtime}</div>
        <div><b>Patient</b><br>${st().patient ? st().patient.id : "—"}</div>
        <div><b>Readings held</b><br>${st().readings.length} · events ${st().events.length}</div>
        <div><b>Data age</b><br>${st().freshness.age_ms == null ? "never" : Math.round(st().freshness.age_ms / 1000) + " s"} (${st().freshness.state})</div>
      </div>
      <div class="dbg-latest">
        <b>Latest NORMALIZED reading</b>
<pre>${latest ? JSON.stringify({ event_id: latest.event_id, timestamp: new Date(latest.timestamp).toISOString(),
  tremor_score: latest.tremor_score, freq: latest.dominant_frequency_hz, quality: latest.tremor_quality,
  gait: latest.gait_state, cadence: latest.cadence_hz, source: latest.source }, null, 1) : "(none)"}</pre>
      </div>
      <pre class="dbg-log">${log.join("\n")}</pre>`;
  }

  function renderGfxHud() {
    const el = document.getElementById("dbg-gfx");
    if (!el || !window.PDS.graphics) return;
    el.hidden = false;
    el.textContent = `gfx  fps ${window.PDS.graphics.FPS.fps}  frame ${window.PDS.graphics.FPS.frameMs.toFixed(1)} ms  packets ${window.PDS.graphics.visual.packets.length}  link ${window.PDS.graphics.visual.linkUp ? "up" : "down"}`;
  }

  function init() {
    if (cfg().debugData) {
      const el = document.getElementById("dbg-data");
      if (el) el.hidden = false;
      setInterval(renderDataPanel, 1000);
      st().subscribe(() => renderDataPanel());
    }
    if (cfg().debugGraphics) setInterval(renderGfxHud, 500);
  }

  window.PDS.diagnostics = { init, note };
})();
