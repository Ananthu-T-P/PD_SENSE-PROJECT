/* =========================================================
   PD-SENSE Live Monitor — charts.js
   Charts plot EXACTLY the normalized readings the table shows.
   Missing/invalid values become null gaps — never zeros, never
   interpolated "through" a hole in the data.
   Series: tremor index, dominant frequency, cadence, jerk, IMU RMS.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const st = () => window.PDS.state;

  const COL = {
    text: "#9aa7b2", grid: "rgba(154,167,178,.12)", tremor: "#e07856",
    freq: "#5aa2c4", cadence: "#7fb39f", jerk: "#c9a25a", rms: "#8f9aa6",
  };

  const SERIES = [
    { id: "tremor",  label: "Tremor index", unit: "/10", field: "tremor_score", color: COL.tremor, min: 0, max: 10 },
    { id: "freq",    label: "Dominant frequency", unit: "Hz", field: "dominant_frequency_hz", color: COL.freq, min: 0, max: 10 },
    { id: "cadence", label: "Cadence", unit: "Hz", field: "cadence_hz", color: COL.cadence, min: 0, max: 4 },
    { id: "jerk",    label: "Jerk peak", unit: "g/s", field: "jerk_peak", color: COL.jerk, min: 0, max: undefined },
    { id: "rms",     label: "IMU RMS", unit: "g", field: "imu_rms", color: COL.rms, min: 0, max: undefined },
  ];

  const charts = new Map();

  function points(field, range) {
    const now = Date.now();
    const win = { "1h": 3600e3, "24h": 86400e3, "48h": 2 * 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 }[range];
    return st().readings
      .filter((r) => !win || r.timestamp >= now - win)
      .slice()                                   // newest-first in state
      .reverse()                                 // charts want oldest-first
      /* quality gate: a reading with quality != VALID carries null score;
         the chart shows a gap there (Chart.js spanGaps:false) */
      .map((r) => ({ x: r.timestamp, y: typeof r[field] === "number" ? r[field] : null }));
  }

  function ensure(id) {
    const meta = SERIES.find((s) => s.id === id);
    const canvas = document.getElementById(`chart-${id}`);
    if (!canvas || typeof Chart === "undefined") return null;
    if (charts.has(id)) return charts.get(id);
    const c = new Chart(canvas, {
      type: "line",
      data: { datasets: [{
        data: [], borderColor: meta.color, backgroundColor: meta.color + "22",
        borderWidth: 1.5, pointRadius: 0, tension: 0.2, fill: false,
        spanGaps: false,                            // gaps stay gaps
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#161b21", borderColor: COL.grid, borderWidth: 1,
            titleColor: COL.text, bodyColor: "#e6ebef", displayColors: false,
            callbacks: {
              title: (it) => new Date(it[0].parsed.x).toLocaleTimeString(),
              label: (it) => `${meta.label}: ${it.parsed.y == null ? "N/A" : it.parsed.y + " " + meta.unit}`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            grid: { color: COL.grid },
            ticks: { color: COL.text, font: { size: 10 }, maxTicksLimit: 6,
                     callback: (v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
          },
          y: {
            min: meta.min, max: meta.max,
            grid: { color: COL.grid },
            title: { display: true, text: `${meta.label} (${meta.unit || "-"})`, color: COL.text, font: { size: 10 } },
            ticks: { color: COL.text, font: { size: 10 } },
          },
        },
      },
    });
    charts.set(id, c);
    return c;
  }

  function update() {
    for (const meta of SERIES) {
      const c = ensure(meta.id);
      if (!c) continue;
      c.data.datasets[0].data = points(meta.field, st().range);
      c.update("none");
    }
  }

  function init() {
    if (typeof Chart === "undefined") {
      document.querySelectorAll(".chart-wrap").forEach((el) => {
        el.innerHTML = '<div class="chart-fallback">Chart.js failed to load — charts unavailable (table above remains authoritative).</div>';
      });
      return;
    }
    update();
    st().subscribe((topic) => { if (topic === "reading" || topic === "range") update(); });
  }

  window.PDS.charts = { init, update };
})();
