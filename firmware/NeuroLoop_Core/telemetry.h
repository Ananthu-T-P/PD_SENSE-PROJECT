/*
 * ============================================================================
 * telemetry.h — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * ESP32 --(HTTPS/HTTP + device token)--> PD-SENSE backend API --> Supabase.
 *
 * The device NEVER talks to Supabase directly and never holds a database
 * key. It authenticates with DEVICE_ID + DEVICE_TOKEN against the backend;
 * the backend validates the device, derives the patient association, and
 * owns the database.

 * Design rules:
 *   - sensor acquisition is NEVER blocked or paced by networking
 *   - summarized telemetry packet every UPLOAD_INTERVAL_MS (15 s default)
 *   - discrete events (freeze, tap_test_completed, medication_event,
 *     possible_fall) are queued and sent promptly
 *   - every packet has {schema_version, event_id, device_id, sequence}
 *     so the backend can deduplicate retries idempotently
 *   - bounded static FIFO queues; overflow drops the OLDEST packet and
 *     counts the loss — never silently
 *   - retry with backoff; WiFi reconnect is a paced FSM (no churn)
 *   - device timestamps come from NTP when synced; device_ms is always
 *     included and the backend's received_at is the authoritative clock
 *   - persisted cloud ALERTS are owned by the backend; the device emits
 *     candidate events and drives local cues only
 * ============================================================================
 */

#ifndef NEUROLOOP_TELEMETRY_H
#define NEUROLOOP_TELEMETRY_H

#include <Arduino.h>
#include "sensors.h"

enum NetState : uint8_t {
  NET_WIFI_DISCONNECTED = 0,
  NET_WIFI_CONNECTING,
  NET_WIFI_CONNECTED,       // wifi up, backend not yet proven
  NET_BACKEND_OFFLINE,      // wifi up, backend failing
  NET_BACKEND_ONLINE        // wifi up, backend proven by a 2xx
};

struct TelemetryStatus {
  NetState  net;
  int       rssi;            // dBm, 0 while disconnected
  bool      timeSynced;      // NTP acquired
  uint32_t  sequence;        // next sequence number
  uint32_t  sent;            // packets accepted (2xx) incl. duplicates
  uint32_t  failed;          // packets that exhausted/failed attempts
  uint16_t  queueDepth;      // telemetry packets waiting
  uint16_t  eventDepth;      // event packets waiting
  uint32_t  dropped;         // packets lost to queue overflow (total)
  uint32_t  lastOkMs;        // millis() of last 2xx, 0 = never
  char      ip[16];
};

void telemetryInit();   // WiFi FSM init; does NOT block until connected
void telemetryTick();   // every loop(): FSM, accumulation, queue drain, NTP

/* Coordinator feeds the layer each loop with the current gait/freeze and
   serializes nothing itself — all wire format lives here.              */
void telemetryNoteFreezeCompleted(uint32_t durationMs);
void telemetryNoteTapTest(uint16_t taps, uint16_t target, uint32_t durationMs,
                          int grade, const char* label, bool completed);
void telemetryNoteMedicationGesture(const char* gestureName);
void telemetryNoteFallCandidate(float jerkPeak, uint32_t stillMs);

void telemetryGetStatus(TelemetryStatus* out);
const char* netStateName(NetState s);

/* diagnostics (`test api`, `test telemetry`) */
int  telemetryTestApi();      // HTTP status of GET /api/health, or <0 net error, or 0 wifi not up
bool telemetryTestSerialize(char* out, size_t cap);  // builds one packet to a scratch buffer

#endif // NEUROLOOP_TELEMETRY_H
