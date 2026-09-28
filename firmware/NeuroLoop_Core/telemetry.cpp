/*
 * ============================================================================
 * telemetry.cpp — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * ESP32 --(HTTP/HTTPS + device token)--> PD-SENSE backend API.
 *
 * Blocking policy: the sensor loop is never stalled. WiFi reconnect is a
 * paced state machine; HTTP calls only happen when there is a queued packet
 * AND the network is up, and each call is hard-capped by HTTP_TIMEOUT_MS.
 * Every packet carries {schema_version, event_id(deviceId-bootId-seq),
 * device_id, sequence}; the backend enforces event_id uniqueness so a
 * retried POST can never duplicate a row.
 *
 * Wire format: docs/FIRMWARE_TELEMETRY.md (schema_version 2).
 * ============================================================================
 */

#include "telemetry.h"
#include "sensors.h"
#include "config.h"

#if TELEMETRY_ENABLED

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_task_wdt.h>
#include <time.h>

/* ------------------------------------------------------------------ */
/* module state                                                       */
/* ------------------------------------------------------------------ */

static NetState  net          = NET_WIFI_DISCONNECTED;
static bool      wifiBegun    = false;
static unsigned long lastWifiCheckMs  = 0;
static unsigned long lastReconnectMs  = 0;

static char      bootId[9];              // 8 hex chars, per boot
static uint32_t  sequence     = 1;

static uint32_t  sentCount    = 0;
static uint32_t  failedCount  = 0;
static uint32_t  droppedCount = 0;       // overflow losses
static uint32_t  lastOkMs     = 0;
static unsigned long nextRetryMs = 0;
static uint32_t  retryDelayMs = TLM_RETRY_BASE_MS;

/* NTP */
static bool      ntpConfigured = false;
static bool      timeSynced    = false;
static unsigned long lastNtpCheckMs = 0;

/* ------------------------------------------------------------------ */
/* bounded static FIFO queues (serialized JSON, zero heap churn)       */
/* ------------------------------------------------------------------ */

struct QSlot { uint16_t len; char buf[TLM_PACKET_MAX]; };
struct EQSlot { uint16_t len; char buf[EVT_PACKET_MAX]; };

static QSlot  tlq[TLM_QUEUE_LEN];
static uint8_t tlHead = 0, tlCount = 0;
static EQSlot evq[EVT_QUEUE_LEN];
static uint8_t evHead = 0, evCount = 0;

static bool queuePushTelemetry(const char* json) {
  if (tlCount == TLM_QUEUE_LEN) {           // overflow: drop OLDEST, count loss
    tlHead = (tlHead + 1) % TLM_QUEUE_LEN;
    tlCount--;
    droppedCount++;
    Serial.println("ERR  TELEMETRY LOSS — telemetry queue overflow, oldest dropped");
  }
  QSlot& s = tlq[(tlHead + tlCount) % TLM_QUEUE_LEN];
  s.len = snprintf(s.buf, sizeof(s.buf), "%s", json);
  tlCount++;
  return true;
}

static bool queuePushEvent(const char* json) {
  if (evCount == EVT_QUEUE_LEN) {
    evHead = (evHead + 1) % EVT_QUEUE_LEN;
    evCount--;
    droppedCount++;
    Serial.println("ERR  TELEMETRY LOSS — event queue overflow, oldest dropped");
  }
  EQSlot& s = evq[(evHead + evCount) % EVT_QUEUE_LEN];
  s.len = snprintf(s.buf, sizeof(s.buf), "%s", json);
  evCount++;
  return true;
}

/* ------------------------------------------------------------------ */
/* event ids + wire identity                                          */
/* ------------------------------------------------------------------ */

static void makeEventId(char* out, size_t cap) {
  /* deviceId-bootId-seq is unique per boot and monotonic per session;
     the DB unique constraint makes replays idempotent. */
  snprintf(out, cap, "%s-%s-%lu", DEVICE_ID, bootId, (unsigned long)sequence);
}

/* ISO-8601 UTC timestamp if NTP has synced; else empty (backend stamps
   received_at and the packet still carries device_ms). */
static bool isoNow(char* out, size_t cap) {
  time_t now = time(nullptr);
  if (now < 1700000000) return false;
  struct tm tm_utc;
  gmtime_r(&now, &tm_utc);
  strftime(out, cap, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
  return true;
}

static bool backendIsHttps() { return strncmp(API_BASE_URL, "https://", 8) == 0; }

/* ------------------------------------------------------------------ */
/* low-level POST (bounded, watchdog-fed)                              */
/* ------------------------------------------------------------------ */

static int postPacket(const char* json) {
  /* returns: HTTP status (>=100), 0 = not attempted, <0 = transport error */
  if (WiFi.status() != WL_CONNECTED) return 0;

  WiFiClient*        plain  = nullptr;
  WiFiClientSecure*  secure = nullptr;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/v1/telemetry";

  bool began;
  if (backendIsHttps()) {
    secure = new WiFiClientSecure();
#if ALLOW_INSECURE_TLS
    secure->setInsecure();   // documented prototype fallback — see docs/SECURITY.md
#else
    if (strlen(API_ROOT_CA_PEM) == 0) {
      Serial.println("ERR  https API needs ALLOW_INSECURE_TLS=1 or API_ROOT_CA_PEM set");
      delete secure;
      return -99;
    }
    secure->setCACert(API_ROOT_CA_PEM);
#endif
    began = http.begin(*secure, url);
  } else {
    plain = new WiFiClient();
    began = http.begin(*plain, url);
  }
  if (!began) { delete plain; delete secure; return -98; }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  esp_task_wdt_reset();
  int code = http.POST((uint8_t*)json, strlen(json));
  esp_task_wdt_reset();
  http.end();
  delete plain;
  delete secure;
  return code;
}

/* ------------------------------------------------------------------ */
/* packet builders                                                     */
/* ------------------------------------------------------------------ */

static size_t buildTelemetryPacket(char* out, size_t cap) {
  char eid[40], iso[24];
  makeEventId(eid, sizeof(eid));
  bool ts = isoNow(iso, sizeof(iso));
  const char* gait = gaitWireNamePub(gSensor.gaitPhase);

  int n = snprintf(out, cap,
    "{\"schema_version\":2,\"type\":\"telemetry\",\"event_id\":\"%s\","
    "\"device_id\":\"%s\",\"device_ms\":%lu,\"sequence\":%lu,",
    eid, DEVICE_ID, (unsigned long)millis(), (unsigned long)sequence);
  if (ts) n += snprintf(out + n, cap - n, "\"timestamp\":\"%s\",", iso);

  if (gSensor.tremorQuality == TQ_VALID)
    n += snprintf(out + n, cap - n,
                  "\"tremor_score\":%.2f,\"dominant_frequency_hz\":%.2f,",
                  gSensor.tremorScore, gSensor.tremorFreq);
  else
    n += snprintf(out + n, cap - n,
                  "\"tremor_score\":null,\"dominant_frequency_hz\":null,");

  n += snprintf(out + n, cap - n,
    "\"tremor_quality\":\"%s\",\"imu_rms\":%.4f,\"jerk_peak\":%.2f,"
    "\"gait_state\":\"%s\",\"cadence_hz\":%.2f,\"freeze_active\":%s,"
    "\"sensors\":{\"imu\":\"%s\",\"apds\":\"%s\",\"oled\":\"%s\"},"
    "\"network\":{\"rssi\":%d},\"uptime_ms\":%lu,"
    "\"queue_depth\":%u,\"queue_dropped\":%lu,\"fw\":\"%s\"}",
    tremorQualityName(gSensor.tremorQuality), gSensor.imuRMS, gSensor.jerkPeak,
    gait, gSensor.cadence, gSensor.freezeActive ? "true" : "false",
    gSensor.imuOk ? "OK" : "FAULT", gSensor.apdsOk ? "OK" : "FAULT",
    "OK",                              // OLED health surfaced on serial; device page
    (int)(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0),
    (unsigned long)millis(),
    (unsigned)tlCount, (unsigned long)droppedCount, FW_VERSION);
  return (size_t)n;
}

static size_t openEvent(char* out, size_t cap, const char* eventType) {
  char eid[40], iso[24];
  makeEventId(eid, sizeof(eid));
  bool ts = isoNow(iso, sizeof(iso));
  int n = snprintf(out, cap,
    "{\"schema_version\":2,\"type\":\"event\",\"event_type\":\"%s\","
    "\"event_id\":\"%s\",\"device_id\":\"%s\",\"device_ms\":%lu,"
    "\"sequence\":%lu,",
    eventType, eid, DEVICE_ID, (unsigned long)millis(), (unsigned long)sequence);
  if (ts) n += snprintf(out + n, cap - n, "\"timestamp\":\"%s\",", iso);
  return (size_t)n;
}

void telemetryNoteFreezeCompleted(uint32_t durationMs) {
  char buf[EVT_PACKET_MAX];
  size_t n = openEvent(buf, sizeof(buf), "freeze");
  snprintf(buf + n, sizeof(buf) - n, "\"duration_ms\":%lu,\"source\":\"device\"}",
           (unsigned long)durationMs);
  if (queuePushEvent(buf)) sequence++;
}

void telemetryNoteTapTest(uint16_t taps, uint16_t target, uint32_t durationMs,
                          int grade, const char* label, bool completed) {
  char buf[EVT_PACKET_MAX];
  size_t n = openEvent(buf, sizeof(buf), "tap_test_completed");
  snprintf(buf + n, sizeof(buf) - n,
           "\"tap_count\":%u,\"target_count\":%u,\"duration_ms\":%lu,"
           "\"bradykinesia_grade\":%d,\"bradykinesia_label\":\"%s\","
           "\"quality\":\"%s\",\"source\":\"device\"}",
           (unsigned)taps, (unsigned)target, (unsigned long)durationMs,
           grade, label, completed ? "COMPLETE" : "INCOMPLETE");
  if (queuePushEvent(buf)) sequence++;
}

void telemetryNoteMedicationGesture(const char* gesture) {
  char buf[EVT_PACKET_MAX];
  size_t n = openEvent(buf, sizeof(buf), "medication_event");
  snprintf(buf + n, sizeof(buf) - n,
           "\"gesture\":\"%s\",\"source\":\"device\"}", gesture);
  if (queuePushEvent(buf)) sequence++;
}

void telemetryNoteFallCandidate(float jerkPeak, uint32_t stillMs) {
  char buf[EVT_PACKET_MAX];
  size_t n = openEvent(buf, sizeof(buf), "possible_fall");
  snprintf(buf + n, sizeof(buf) - n,
           "\"jerk_peak\":%.2f,\"still_ms\":%lu,\"duration_ms\":%lu,"
           "\"severity\":\"critical\",\"source\":\"device\"}",
           jerkPeak, (unsigned long)stillMs, (unsigned long)stillMs);
  if (queuePushEvent(buf)) sequence++;
}

/* ------------------------------------------------------------------ */
/* WiFi FSM (paced, never the sensor loop's business)                  */
/* ------------------------------------------------------------------ */

static void wifiFsmTick() {
  const unsigned long now = millis();
  if (!wifiBegun) {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    wifiBegun = true;
    net = NET_WIFI_CONNECTING;
    Serial.printf("NET  WiFi connecting to \"%s\"\r\n", WIFI_SSID);
    return;
  }
  if (now - lastWifiCheckMs < WIFI_CHECK_MS) return;
  lastWifiCheckMs = now;

  wl_status_t st = WiFi.status();
  if (st == WL_CONNECTED) {
    if (net == NET_WIFI_DISCONNECTED || net == NET_WIFI_CONNECTING) {
      Serial.printf("NET  CONNECTED RSSI=%d IP=%s\r\n",
                    (int)WiFi.RSSI(), WiFi.localIP().toString().c_str());
      net = NET_WIFI_CONNECTED;    // backend proven separately
      if (!ntpConfigured) { configTime(0, 0, NTP_SERVER); ntpConfigured = true; }
    }
    return;
  }
  if (net >= NET_WIFI_CONNECTED) Serial.println("NET  WiFi lost");
  if (net != NET_WIFI_CONNECTING) {
    net = NET_WIFI_DISCONNECTED;
    if (now - lastReconnectMs >= WIFI_RECONNECT_GAP_MS) {
      lastReconnectMs = now;
      Serial.println("NET  RECONNECTING");
      WiFi.disconnect(false);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      net = NET_WIFI_CONNECTING;
    }
  }
}

static void ntpTick() {
  if (!ntpConfigured || timeSynced) return;
  const unsigned long now = millis();
  if (now - lastNtpCheckMs < 5000) return;
  lastNtpCheckMs = now;
  if (time(nullptr) > 1700000000) {
    timeSynced = true;
    Serial.println("NET  time synced (NTP, UTC)");
  }
}

/* ------------------------------------------------------------------ */
/* queue drain                                                         */
/* ------------------------------------------------------------------ */

static void drainQueue() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (tlCount == 0 && evCount == 0) { nextRetryMs = 0; return; }

  const unsigned long now = millis();
  if (now < nextRetryMs) return;

  /* events first (discrete, time-sensitive), then oldest telemetry (FIFO) */
  const char* body = nullptr;
  bool isEvent = false;
  if (evCount)      { body = evq[evHead].buf; isEvent = true; }
  else if (tlCount) { body = tlq[tlHead].buf; }

  int code = postPacket(body);
  if (code >= 200 && code < 300) {
    if (isEvent) { evHead = (evHead + 1) % EVT_QUEUE_LEN; evCount--; }
    else         { tlHead = (tlHead + 1) % TLM_QUEUE_LEN; tlCount--; }
    sentCount++;
    lastOkMs = now;
    retryDelayMs = TLM_RETRY_BASE_MS;
    nextRetryMs  = now;                    // drain next packet next loop
    if (net != NET_BACKEND_ONLINE) {
      net = NET_BACKEND_ONLINE;
      Serial.println("NET  backend ONLINE");
    }
    Serial.printf("NET  %s upload OK (%d)  q=%u/%u\r\n",
                  isEvent ? "event" : "telemetry", code, (unsigned)evCount, (unsigned)tlCount);
  } else {
    failedCount++;
    if (net >= NET_WIFI_CONNECTED) net = NET_BACKEND_OFFLINE;
    Serial.printf("NET  upload FAILED (%s, code %d) — retry in %lus\r\n",
                  isEvent ? "event" : "telemetry", code, (unsigned long)(retryDelayMs / 1000));
    nextRetryMs  = now + retryDelayMs;
    retryDelayMs = min(retryDelayMs * 2, (uint32_t)TLM_RETRY_MAX_MS);
  }
}

/* periodic telemetry roll: one summarized window packet per interval */
static void tickTelemetryRoll() {
  static unsigned long lastRollMs = 0;
  const unsigned long now = millis();
  if (now - lastRollMs < UPLOAD_INTERVAL_MS) return;
  lastRollMs = now;
  if (tlCount >= TLM_QUEUE_LEN) { /* overflow counted inside push */ }
  char buf[TLM_PACKET_MAX];
  size_t n = buildTelemetryPacket(buf, sizeof(buf));
  if (n > 0 && n < sizeof(buf) && queuePushTelemetry(buf)) sequence++;
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

void telemetryInit() {
  snprintf(bootId, sizeof(bootId), "%08lx", (unsigned long)esp_random());
  lastWifiCheckMs = millis() - WIFI_CHECK_MS;   // FSM evaluates immediately
  /* no boot-time scan, no blocking wait: the FSM handles it in-loop */
}

void telemetryTick() {
  wifiFsmTick();
  ntpTick();
  tickTelemetryRoll();
  drainQueue();
}

void telemetryGetStatus(TelemetryStatus* out) {
  if (!out) return;
  memset(out, 0, sizeof(*out));
  out->net        = net;
  out->rssi       = WiFi.status() == WL_CONNECTED ? (int)WiFi.RSSI() : 0;
  out->timeSynced = timeSynced;
  out->sequence   = sequence;
  out->sent       = sentCount;
  out->failed     = failedCount;
  out->queueDepth = tlCount;
  out->eventDepth = evCount;
  out->dropped    = droppedCount;
  out->lastOkMs   = lastOkMs;
  snprintf(out->ip, sizeof(out->ip), "%s",
           WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "-");
}

const char* netStateName(NetState s) {
  switch (s) {
    case NET_WIFI_DISCONNECTED: return "DISCONNECTED";
    case NET_WIFI_CONNECTING:   return "CONNECTING";
    case NET_WIFI_CONNECTED:    return "WIFI_UP";
    case NET_BACKEND_OFFLINE:   return "BACKEND_OFFLINE";
    case NET_BACKEND_ONLINE:    return "ONLINE";
  }
  return "?";
}

int telemetryTestApi() {
  if (WiFi.status() != WL_CONNECTED) return 0;
  WiFiClient*        plain  = nullptr;
  WiFiClientSecure*  secure = nullptr;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/health";
  bool began;
  if (backendIsHttps()) {
    secure = new WiFiClientSecure();
#if ALLOW_INSECURE_TLS
    secure->setInsecure();
#else
    if (strlen(API_ROOT_CA_PEM) == 0) { delete secure; return -99; }
    secure->setCACert(API_ROOT_CA_PEM);
#endif
    began = http.begin(*secure, url);
  } else {
    plain = new WiFiClient();
    began = http.begin(*plain, url);
  }
  if (!began) { delete plain; delete secure; return -98; }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = http.GET();
  http.end();
  delete plain; delete secure;
  return code;
}

bool telemetryTestSerialize(char* out, size_t cap) {
  if (!out || cap < TLM_PACKET_MAX) return false;
  return buildTelemetryPacket(out, cap) > 0;
}

#else  /* TELEMETRY_ENABLED == 0 — whole layer compiled out */

void telemetryInit() {}
void telemetryTick() {}
void telemetryNoteFreezeCompleted(uint32_t) {}
void telemetryNoteTapTest(uint16_t, uint16_t, uint32_t, int, const char*, bool) {}
void telemetryNoteMedicationGesture(const char*) {}
void telemetryNoteFallCandidate(float, uint32_t) {}
void telemetryGetStatus(TelemetryStatus* out) { if (out) memset(out, 0, sizeof(*out)); }
const char* netStateName(NetState) { return "DISABLED"; }
int  telemetryTestApi() { return 0; }
bool telemetryTestSerialize(char*, size_t) { return false; }

#endif
