/* =========================================================
   PD-SENSE Live Monitor — events.js
   Unified event timeline: freeze / possible_fall / medication_event /
   tap_test_completed / alerts. Distinct icons AND labels (never
   color alone). Consumes the normalized event contract.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const st = () => window.PDS.state;
  const api = () => window.PDS.api;
  const $ = (id) => document.getElementById(id);

  const META = {
    freeze:             { icon: "❄", label: "FREEZE",              cls: "ev-freeze" },
    possible_fall:      { icon: "⚠", label: "FALL CANDIDATE",      cls: "ev-fall" },
    medication_event:   { icon: "✚", label: "MEDICATION EVENT",    cls: "ev-med" },
    tap_test_completed: { icon: "✔", label: "TAP TEST",            cls: "ev-tap" },
    prolonged_freeze:   { icon: "▲", label: "ALERT: PROLONGED FREEZE", cls: "ev-alert" },
    high_tremor:        { icon: "▲", label: "ALERT: HIGH TREMOR",  cls: "ev-alert" },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function describe(e) {
    switch (e.event_type) {
      case "freeze":
        return `duration ${(e.duration_ms / 1000).toFixed(1)} s`;
      case "possible_fall":
        return `impact ${e.payload.jerk_peak ?? "?"} g/s + ${((e.payload.still_ms || 0) / 1000).toFixed(0)} s stillness — candidate, not confirmed`;
      case "medication_event":
        return `gesture ${esc(e.payload.gesture || "?")} recorded on device (event only — not proof of intake)`;
      case "tap_test_completed": {
        const q = e.payload.quality || "COMPLETE";
        return q === "COMPLETE"
          ? `${e.payload.tap_count}/${e.payload.target_count} taps — grade ${e.payload.bradykinesia_grade} (${esc(e.payload.bradykinesia_label || "")})`
          : `${e.payload.tap_count}/${e.payload.target_count} taps — INCOMPLETE`;
      }
      default:
        return esc(e.detail || e.event_type);
    }
  }

  function merged() {
    const ev = st().events.map((e) => ({ ...eMeta(e), _kind: "event" }));
    const al = st().alerts.map((a) => ({
      _kind: "alert", event_id: a.id, event_type: a.event_type,
      timestamp: Date.parse(a.ts), severity: a.severity, detail: a.detail, status: a.status, id: a.id,
    }));
    const all = [...ev, ...al];
    all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return all;
  }
  function eMeta(e) { return e; }

  function render() {
    const box = $("events-timeline");
    if (!box) return;
    const items = merged().slice(0, 60);
    if (!items.length) {
      box.innerHTML = '<div class="ev-empty">No events recorded yet. Freeze episodes, device medication gestures, tap tests and alerts appear here.</div>';
      return;
    }
    box.innerHTML = items.map((e) => {
      const m = META[e.event_type] || { icon: "•", label: e.event_type, cls: "" };
      return `<div class="ev-row ${m.cls}">
        <span class="ev-ico">${m.icon}</span>
        <span class="ev-time">${e.timestamp ? new Date(e.timestamp).toLocaleTimeString([], { hour12: false }) : "—"}</span>
        <span class="ev-label">${m.label}${e._kind === "alert" ? (e.status ? ` · ${e.status}` : "") : ""}</span>
        <span class="ev-desc">${describe(e)}</span>
        ${e._kind === "alert" && e.status === "open"
          ? `<button class="btn small" data-ack="${e.id}">acknowledge</button>` : ""}
      </div>`;
    }).join("");
    box.querySelectorAll("[data-ack]").forEach((b) =>
      b.onclick = async () => {
        try { await api().ackAlert(b.dataset.ack, "acknowledged"); b.closest(".ev-row").querySelector(".ev-label").textContent += " ✓"; }
        catch (err) { alert("ack failed: " + err.message); }
      });
  }

  function init() {
    render();
    st().subscribe((topic) => { if (topic === "event" || topic === "alerts") render(); });
  }

  window.PDS.events = { init, render };
})();
