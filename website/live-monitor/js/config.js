/* =========================================================
   PD-SENSE Live Monitor — configuration.
   UI-facing constants only. NO database keys. The only credential
   here is the shared dashboard API token (read from URL ?token=
   once and remembered as a UI preference in localStorage).
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const prefs = JSON.parse(localStorage.getItem("pds_ui_prefs") || "{}");

  /* demo mode is explicit, isolated and loudly labelled */
  const demo = qs.get("mode") === "demo" || location.protocol === "file:" && qs.get("mode") === "demo";

  if (qs.get("token")) { prefs.token = qs.get("token"); localStorage.setItem("pds_ui_prefs", JSON.stringify(prefs)); }

  window.PDS.config = {
    /* same-origin default: backend serves this site on :3000.
       Override with ?api=http://host:3000 when opened from file:// */
    /* same-origin default: backend serves this site on :3000.
       When opened from Live Server / file://, we try the remembered or
       localhost:3000 backend automatically (see ensureReachable). */
    apiBase: qs.get("api") || (location.port === "3000" ? "" : (prefs.api || null)),
    token: prefs.token || null,

    demo,
    pollMs: 5000,                    // REST safety net; SSE is the primary push
    pageSizes: [25, 50, 100],
    defaultPageSize: 25,

    /* freshness thresholds mirror the backend (docs/API.md) */
    freshOnlineMs: 45000,
    freshStaleMs: 120000,

    debugData: qs.get("debugData") === "true" || qs.get("debugData") === "1",
    debugGraphics: qs.get("debugGraphics") === "true" || qs.get("debugGraphics") === "1",

    prefs,
    savePrefs() { localStorage.setItem("pds_ui_prefs", JSON.stringify(this.prefs)); },
  };
})();
