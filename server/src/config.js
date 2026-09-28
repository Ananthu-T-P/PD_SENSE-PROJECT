"use strict";
/* Central configuration. Every secret comes from the environment.
 * The process REFUSES to start without database credentials; it starts
 * (loudly, in open demo mode) without a dashboard token. */
require("dotenv").config();

const SKIP_ENV_CHECK = process.env.PD_SENSE_SKIP_ENV_CHECK === "1";   // tests

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = REQUIRED.filter((k) => {
  const v = process.env[k];
  return !v || v.startsWith("PASTE") || v.includes("YOUR_PROJECT_REF");
});
if (!SKIP_ENV_CHECK && missing.length) {
  console.error(`[config] FATAL: missing/placeholder env: ${missing.join(", ")} — see .env.example`);
  process.exit(1);
}

const config = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  CORS_ORIGINS: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),

  SUPABASE_URL: (process.env.SUPABASE_URL || "http://localhost:54321").replace(/\/$/, ""),
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key",

  DASHBOARD_TOKEN: process.env.DASHBOARD_TOKEN || null,
  DEVICE_SEED: (process.env.DEVICE_SEED || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => {
      const [deviceId, token, patientId] = s.split(":");
      return { deviceId, token, patientId };
    }),

  FRESH_ONLINE_MS: parseInt(process.env.FRESH_ONLINE_MS || "45000", 10),
  FRESH_STALE_MS: parseInt(process.env.FRESH_STALE_MS || "120000", 10),

  ALERTS: {
    PROLONGED_FREEZE_MS: parseInt(process.env.ALERT_PROLONGED_FREEZE_MS || "8000", 10),
    HIGH_TREMOR_SCORE: parseFloat(process.env.ALERT_HIGH_TREMOR_SCORE || "6.5"),
    HIGH_TREMOR_CONSEC: parseInt(process.env.ALERT_HIGH_TREMOR_CONSEC || "3", 10),
    COOLDOWN_MS: parseInt(process.env.ALERT_COOLDOWN_MS || "600000", 10),
  },
};

if (!config.DASHBOARD_TOKEN) {
  console.warn("[config] WARNING: DASHBOARD_TOKEN unset — API runs in OPEN DEMO MODE (no browser auth).");
}

module.exports = config;
