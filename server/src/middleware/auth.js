"use strict";
/* Dashboard auth: a single shared bearer token (DASHBOARD_TOKEN env) gates
 * every /api/v1/* read endpoint. Honest scope: this is classroom-demo auth,
 * NOT per-user clinical accounts (documented in docs/SECURITY.md). If the
 * token is unset the API is open and logs a warning at boot. */
const config = require("../config");

function requireDashboard(req, res, next) {
  if (!config.DASHBOARD_TOKEN) return next();   // open demo mode (warned at boot)
  const h = req.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.query.access_token;
  if (token && token === config.DASHBOARD_TOKEN) return next();
  return res.status(401).json({ error: "invalid or missing dashboard token" });
}

module.exports = { requireDashboard };
