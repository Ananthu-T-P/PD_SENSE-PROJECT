"use strict";
/* PD-SENSE backend API. Composition root: config -> express app -> routes.
 * Static hosting for the website (live monitor / doctor portal / public site)
 * so the whole demo runs from one origin and never fights CORS. */
const path = require("path");
const express = require("express");
const config = require("./config");
const db = require("./db");
const { sha256 } = require("./middleware/deviceAuth");
const { requireDashboard } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const healthRoutes = require("./routes/health");
const telemetryRoutes = require("./routes/telemetry");
const readingsRoutes = require("./routes/readings");
const eventsRoutes = require("./routes/events");
const patientsRoutes = require("./routes/patients");
const devicesRoutes = require("./routes/devices");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

/* CORS: reflect configured origins; dashboards served from this same origin
 * never cross origins at all. file:// dashboards send Origin "null". */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin === "null" || config.CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Device-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* health — always open (ESP32 `test api` targets this) */
app.use("/api", healthRoutes);

/* device write path — device credential auth */
app.use("/api/v1", telemetryRoutes);

/* everything else — dashboard token auth */
app.use("/api/v1/readings", requireDashboard);
app.use("/api/v1/events", requireDashboard);
app.use("/api/v1/alerts", requireDashboard);
app.use("/api/v1/medication-events", requireDashboard);
app.use("/api/v1/tap-tests", requireDashboard);
app.use("/api/v1/patients", requireDashboard);
app.use("/api/v1/devices", requireDashboard);
app.use("/api/v1/export", requireDashboard);
app.use("/api/v1/stream", requireDashboard);

app.use("/api/v1", readingsRoutes);   // also mounts /api/v1/export/readings.csv
app.use("/api/v1", eventsRoutes);
app.use("/api/v1", patientsRoutes);
app.use("/api/v1", devicesRoutes);

/* static sites: /live-monitor/, /doctor/, / (public site) */
app.use(express.static(path.join(__dirname, "..", "..", "website")));

app.use(notFound);
app.use(errorHandler);

/* device seeding: DEVICE_SEED="id:token:patientId[, ...]" */
async function seedDevices() {
  for (const s of config.DEVICE_SEED) {
    if (!s.deviceId || !s.token || !s.patientId) continue;
    try {
      await db.upsert("patients", { id: s.patientId, display_name: s.patientId, updated_at: new Date().toISOString() }, "id");
      await db.upsert("devices", {
        device_id: s.deviceId, patient_id: s.patientId, enabled: true,
        token_hash: sha256(s.token), updated_at: new Date().toISOString(),
      }, "device_id");
      console.log(`[seed] device ${s.deviceId} -> patient ${s.patientId}`);
    } catch (err) {
      console.error(`[seed] failed for ${s.deviceId}: ${err.message} (migrations applied? see docs/DEPLOYMENT.md)`);
    }
  }
}

async function main() {
  const { createServer } = require("http");
  const server = createServer(app);
  await seedDevices();
  server.listen(config.PORT, () => {
    console.log(`[pd-sense] backend listening on http://0.0.0.0:${config.PORT}`);
    console.log(`[pd-sense] live monitor: http://localhost:${config.PORT}/live-monitor/`);
    console.log(`[pd-sense] doctor portal: http://localhost:${config.PORT}/doctor/`);
  });
}

if (require.main === module) {
  main().catch((err) => { console.error(`[fatal] ${err.message}`); process.exit(1); });
}

module.exports = app;
