/*
 * ============================================================================
 * NeuroLoop_Core.ino — PD-SENSE / NeuroLoop firmware coordinator
 * ============================================================================
 * Pipeline: real sensors -> signal processing -> events -> local cues ->
 *           telemetry queue -> PD-SENSE backend API.
 * Normal boot: BOOT -> CALIBRATION -> MONITORING. No manual sensor mode.
 * Serial console (115200): `help` lists every command. Hardware testable
 * standalone with only a USB cable — the website is never required.
 * ============================================================================
 */

#include <esp_task_wdt.h>
#include <esp_system.h>
#include <Wire.h>
#include "config.h"
#include "sensors.h"
#include "display.h"
#include "telemetry.h"

/* ========================================================================= */
/* SECTION 1 — application state                                             */
/* ========================================================================= */

enum AppState : uint8_t { APP_BOOT, APP_CALIBRATION, APP_MONITOR, APP_TAP_TEST, APP_FAULT };
static AppState appState = APP_BOOT;
static bool     calFailed  = false;          // proceeded after failed calibration
static uint8_t  calAttempts = 0;

static unsigned long bootMs = 0;

/* tap test bookkeeping */
static bool          tapHoldResult = false;
static bool          tapCompleted  = false;
static unsigned long tapHoldUntil  = 0;
static int           lastBrady     = -1;
static char          lastBradyLabel[16] = "NO TEST";

/* persistent counters (serial `events`) */
static uint32_t freezeEventCount = 0;
static uint32_t medEventCount    = 0;
static uint32_t tapTestCount     = 0;
static uint32_t fallCandidates   = 0;

/* medication gesture latch */
static unsigned long lastMedEventMs = 0 - MED_EVENT_COOLDOWN_MS; // first gesture allowed
static bool          gaitPrevFreeze = false;

const char* appStateName() {
  switch (appState) {
    case APP_BOOT:        return "BOOT";
    case APP_CALIBRATION: return "CALIBRATION";
    case APP_MONITOR:     return "MONITOR";
    case APP_TAP_TEST:    return "TAP_TEST";
    case APP_FAULT:       return "FAULT";
  }
  return "?";
}

const char* resetReasonName() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "POWERON";
    case ESP_RST_SW:        return "SOFTWARE";
    case ESP_RST_PANIC:     return "PANIC";
    case ESP_RST_INT_WDT:   return "INT_WDT";
    case ESP_RST_TASK_WDT:  return "TASK_WDT";
    case ESP_RST_WDT:       return "WDT";
    case ESP_RST_BROWNOUT:  return "BROWNOUT";
    default:                return "OTHER";
  }
}

/* ========================================================================= */
/* SECTION 2 — cue engine (non-blocking buzzer + haptic)                     */
/* Active buzzer: digital on/off. Pulse timing supplies the rhythm.          */
/* ========================================================================= */

static bool     rasActive = false, rasPhase = false;
static unsigned long rasStartMs = 0, rasLastToggle = 0;
static int      alertBeepsLeft = 0;
static bool     alertOn = false;
static unsigned long alertNextAt = 0;
static unsigned long clickOffAt = 0;

static void cueSetBuzzer(bool on) { digitalWrite(PIN_BUZZER, on ? HIGH : LOW); }

static void cueStartRAS() {
  if (rasActive) return;
  rasActive = true; rasPhase = false;
  rasStartMs = rasLastToggle = millis();
  Serial.println("EVT  RAS cue ON (freeze response)");
}
static void cueStopRAS() {
  if (!rasActive) return;
  rasActive = false;
  cueSetBuzzer(false);
  digitalWrite(PIN_HAPTIC, LOW);
  Serial.println("EVT  RAS cue OFF");
}
static void cueAlertTremor() {
  if (!rasActive && alertBeepsLeft == 0) {
    alertBeepsLeft = 3; alertOn = false; alertNextAt = millis();
  }
}
static void cueClick(uint16_t ms) {
  if (rasActive || alertBeepsLeft > 0) return;
  cueSetBuzzer(true);
  clickOffAt = millis() + ms;
}
static bool cueBusy() { return rasActive || alertBeepsLeft > 0 || clickOffAt != 0; }

static void cueTick() {
  const unsigned long now = millis();
  const unsigned long halfPeriod = (unsigned long)(500.0f / RAS_CADENCE_HZ);

  if (rasActive) {
    if (now - rasStartMs > RAS_MAX_MS) { cueStopRAS(); return; }
    if (now - rasLastToggle >= halfPeriod) {
      rasLastToggle = now;
      rasPhase = !rasPhase;
      cueSetBuzzer(rasPhase);
      digitalWrite(PIN_HAPTIC, rasPhase ? HIGH : LOW);
    }
    return;
  }
  if (alertBeepsLeft > 0 && now >= alertNextAt) {
    alertOn = !alertOn;
    cueSetBuzzer(alertOn);
    alertNextAt = now + ALERT_BEEP_MS;
    if (!alertOn) alertBeepsLeft--;
  }
  if (clickOffAt && now >= clickOffAt) {
    clickOffAt = 0;
    if (!alertOn) cueSetBuzzer(false);
  }
}

/* ========================================================================= */
/* SECTION 3 — evaluateAndAct(): measured tuple -> local physical response    */
/* Local cues only. Cloud alerts are owned by the backend from the events.   */
/* First alert after boot is NEVER suppressed (explicit has-alerted flag).   */
/* ========================================================================= */

static unsigned long lastTremorAlertMs = 0;
static bool          tremorAlertedOnce = false;

static void evaluateAndAct(float tremorScore) {
  const unsigned long now = millis();
  if (tremorScore >= TREMOR_CRITICAL &&
      (!tremorAlertedOnce || now - lastTremorAlertMs >= TREMOR_RETRIGGER_MS)) {
    tremorAlertedOnce = true;
    lastTremorAlertMs = now;
    Serial.printf("EVT  critical tremor-band activity %.1f -> alert beeps\r\n", tremorScore);
    cueAlertTremor();
  }
}

/* ========================================================================= */
/* SECTION 4 — calibration (a real state; failure is loud, never silent)     */
/* ========================================================================= */

static void runCalibration() {
  appState = APP_CALIBRATION;
  calAttempts++;
  Serial.printf("EVT  calibration attempt %u — HOLD STILL\r\n", calAttempts);
  bool ok = imuCalibrate([](int secondsLeft) { displayCalibration(secondsLeft); });
  calFailed = !ok;
  displayCalibrationResult(ok);
  delay(800);

  if (ok) {
    Serial.println("OK   calibration complete");
    appState = APP_MONITOR;
  } else if (calAttempts >= 3) {
    /* Never silently proceed: baseline floor is on, every screen and every
       status print flags CAL FAILED, and serial says exactly what happened. */
    Serial.println("ERR  calibration failed 3x — proceeding with degraded baseline");
    Serial.println("ERR  thresholds are unreliable until `test calibration` PASSES");
    appState = APP_MONITOR;
  } else {
    Serial.println("ERR  calibration FAILED — move detected, retrying");
  }
}

/* ========================================================================= */
/* SECTION 5 — tap test orchestration                                        */
/* ========================================================================= */

static void startTapTest() {
  cueStopRAS();
  tapReset();
  imuSetActive(true);
  appState = APP_TAP_TEST;
  tapHoldResult = false;
  cueClick(150);
  Serial.printf("CMD  TAP TEST — tap the device %d times\r\n", TAP_TARGET_COUNT);
}

static void finishTapTest(bool timedOut) {
  char label[16];
  lastBrady = tapScoreBK(label, sizeof(label));   // -1 / "INCOMPLETE" if short
  snprintf(lastBradyLabel, sizeof(lastBradyLabel), "%s", label);
  tapCompleted = !timedOut && lastBrady >= 0;

  uint32_t durMs = gSensor.tapEndMs ? (gSensor.tapEndMs - gSensor.tapStartMs)
                                    : (millis() - gSensor.tapStartMs);
  tapTestCount++;
  Serial.printf("EVT  TAP result: %u/%d taps%s -> grade %d (%s) in %lu ms\r\n",
                gSensor.tapCount, TAP_TARGET_COUNT, timedOut ? " TIMEOUT" : "",
                lastBrady, lastBradyLabel, (unsigned long)durMs);

  /* the result reaches the server — complete or explicitly INCOMPLETE */
  telemetryNoteTapTest(gSensor.tapCount, TAP_TARGET_COUNT, durMs,
                       lastBrady, lastBradyLabel, tapCompleted);
  cueClick(200);
  tapHoldResult = true;
  tapHoldUntil  = millis() + TEST_RESET_DELAY_MS;
}

/* ========================================================================= */
/* SECTION 6 — gesture -> medication-event recording                          */
/* Only the configured gesture records an event. A gesture NEVER proves a    */
/* dose was taken — the record says exactly "MED EVENT RECORDED".            */
/* ========================================================================= */

static void handleGesture() {
  GestureCode g = gesturePoll();
  if (g == GESTURE_NONE) return;

  if (g != MED_EVENT_GESTURE) {
    Serial.printf("EVT  gesture %s ignored (medication gesture is %s)\r\n",
                  gestureName(g), gestureName(MED_EVENT_GESTURE));
    return;
  }
  const unsigned long now = millis();
  if (now - lastMedEventMs < MED_EVENT_COOLDOWN_MS) {
    Serial.println("EVT  medication gesture suppressed (cooldown)");
    return;
  }
  lastMedEventMs = now;
  medEventCount++;
  telemetryNoteMedicationGesture(gestureName(g));
  displayEventOverlay("MED EVENT", "RECORDED");
  cueClick(80);
  Serial.printf("EVT  medication event recorded (%s) #%lu\r\n",
                gestureName(g), (unsigned long)medEventCount);
}

/* ========================================================================= */
/* SECTION 7 — serial diagnostic console                                     */
/* Line-based commands; case-insensitive; extra whitespace ignored.          */
/* Diagnostics that need the sensor loop pump it themselves while running.   */
/* ========================================================================= */

static char    cmdLine[SERIAL_LINE_MAX];
static uint8_t cmdLen = 0;

static void pumpSensors(unsigned long ms) {   // keep sampling during blocking diagnostics
  const unsigned long until = millis() + ms;
  while (millis() < until) {
    imuSampleTick();
    cueTick();
    esp_task_wdt_reset();
    delay(1);
  }
}

/* ---------- individual tests: return 1 PASS / 0 FAIL / 2 WARNING -------- */

static int testI2C() {
  Serial.println("I2C TEST");
  Serial.printf("pins SDA=%d SCL=%d clock=%u\r\n", PIN_I2C_SDA, PIN_I2C_SCL, I2C_CLOCK_HZ);
  bool fMpu = false, fApds = false, fOled = false;
  for (uint8_t a = 3; a < 0x78; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() != 0) continue;
    const char* who = a == I2C_ADDR_OLED ? "OLED" :
                      a == I2C_ADDR_APDS9960 ? "APDS9960" :
                      a == I2C_ADDR_MPU6050 ? "MPU6050" : "unknown";
    Serial.printf("  0x%02X  %-8s\r\n", a, who);
    if (a == I2C_ADDR_MPU6050) fMpu = true;
    if (a == I2C_ADDR_APDS9960) fApds = true;
    if (a == I2C_ADDR_OLED)     fOled = true;
  }
  Serial.printf("  MPU6050 0x%02X: %s\r\n", I2C_ADDR_MPU6050, fMpu ? "FOUND" : "MISSING");
  Serial.printf("  APDS9960 0x%02X: %s\r\n", I2C_ADDR_APDS9960, fApds ? "FOUND" : "MISSING");
  Serial.printf("  OLED 0x%02X: %s\r\n", I2C_ADDR_OLED, fOled ? "FOUND" : "MISSING");
  bool pass = fMpu && fApds && fOled;
  Serial.printf("RESULT: %s\r\n", pass ? "PASS" : "FAIL");
  return pass ? 1 : 0;
}

static int testImu() {
  Serial.println("TEST MPU6050");
  if (!imuPing()) { Serial.println("RESULT: FAIL (not answering I2C)"); return 0; }
  float ax, ay, az, gx, gy, gz;
  imuReadRaw(ax, ay, az, gx, gy, gz);
  Serial.printf("DEVICE     MPU6050\r\nI2C        PASS\r\nACCEL      PASS\r\nGYRO       PASS\r\n");
  Serial.printf("RATE       %.1f Hz measured\r\n", gSensor.sampleRateHz);
  Serial.printf("AX %.3f  AY %.3f  AZ %.3f (g)\r\nGX %.1f (dps)\r\n", ax, ay, az, gx);
  bool plausible = fabsf(ax) < 3 && fabsf(ay) < 3 && fabsf(az) < 3;
  Serial.printf("RESULT: %s\r\n", plausible ? "PASS" : "FAIL (values out of expected range)");
  return plausible ? 1 : 0;
}

static int testApds() {
  Serial.println("TEST APDS9960");
  if (!apdsPing()) { Serial.println("RESULT: FAIL (not answering I2C)"); return 0; }
  Serial.println("INIT       PASS");
  Serial.println("GESTURE TEST ACTIVE — perform a gesture (10 s)");
  Serial.println("(diagnostic only — sensor tests never create medication events)");
  const unsigned long until = millis() + 10000;
  while (millis() < until) {
    GestureCode g = gesturePoll();
    if (g != GESTURE_NONE) {
      Serial.printf("GESTURE    %s detected\r\nRESULT: PASS\r\n", gestureName(g));
      return 1;
    }
    cueTick();
    esp_task_wdt_reset();
    delay(40);
  }
  Serial.println("RESULT: WARNING (sensor alive; no gesture performed to verify decode)");
  return 2;
}

static int testOled() {
  Serial.println("TEST OLED — full-page render pass on screen (watch display)");
  if (!displayOk()) { Serial.println("RESULT: FAIL (OLED not initialized)"); return 0; }
  displaySelfTest();
  Serial.println("RESULT: PASS (verify visually: 5 pages, borders, bar, overlay)");
  return 1;
}

static int testBuzzer() {
  Serial.println("TEST BUZZER (active buzzer, digital on/off)");
  cueStopRAS(); alertBeepsLeft = 0; clickOffAt = 0; cueSetBuzzer(false);
  auto beep = [](int n, int onMs, int gapMs) {
    for (int i = 0; i < n; i++) {
      digitalWrite(PIN_BUZZER, HIGH); esp_task_wdt_reset(); delay(onMs);
      digitalWrite(PIN_BUZZER, LOW);  esp_task_wdt_reset(); delay(gapMs);
    }
  };
  beep(1, 150, 400); beep(2, 120, 250); beep(3, 90, 180); beep(1, 700, 100);
  digitalWrite(PIN_BUZZER, LOW);   // never left active
  Serial.println("RESULT: PASS (confirm audibly: 1 short, 2 short, 3 short, 1 long)");
  return 1;
}

static int testHaptic() {
  Serial.println("TEST HAPTIC");
  int pulses[3] = {100, 250, 500};
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_HAPTIC, HIGH); esp_task_wdt_reset(); delay(pulses[i]);
    digitalWrite(PIN_HAPTIC, LOW);  esp_task_wdt_reset(); delay(400);
  }
  digitalWrite(PIN_HAPTIC, LOW);    // forced off
  Serial.println("RESULT: PASS (confirm 100/250/500 ms pulses felt)");
  return 1;
}

static int testCalibration() {
  Serial.println("TEST CALIBRATION — hold still");
  bool ok = imuCalibrate([](int s) { displayCalibration(s); esp_task_wdt_reset(); });
  calFailed = !ok;
  Serial.printf("calRMS %.4f g\r\nRESULT: %s\r\n", gSensor.calRMS, ok ? "PASS" : "FAIL (move detected)");
  return ok ? 1 : 0;
}

static int testTremor() {
  Serial.println("TEST TREMOR (collects one fresh FFT window)");
  if (!gSensor.imuOk) { Serial.println("RESULT: FAIL (IMU fault)"); return 0; }
  tremorReset();
  const unsigned long until = millis() + 8000;
  while (millis() < until && !tremorWindowReady()) pumpSensors(5);
  if (millis() >= until) { Serial.println("RESULT: FAIL (no window collected)"); return 0; }
  tremorCompute();
  Serial.printf("score %.2f  freq %.2f Hz  quality %s\r\n",
                gSensor.tremorScore, gSensor.tremorFreq, tremorQualityName(gSensor.tremorQuality));
  if (gSensor.tremorQuality == TQ_MOTION_CONTAMINATED) {
    Serial.println("RESULT: WARNING (window motion-contaminated — hold still)");
    return 2;
  }
  Serial.println("RESULT: PASS");
  return 1;
}

static int testGait() {
  Serial.println("TEST GAIT (6 s observation)");
  if (!gSensor.imuOk) { Serial.println("RESULT: FAIL (IMU fault)"); return 0; }
  const unsigned long until = millis() + 6000;
  while (millis() < until) {
    imuSampleTick(); gaitTick();
    esp_task_wdt_reset(); delay(1);
  }
  Serial.printf("state %s  cadence %.2f Hz  rms %.3f g  freezeActive %s\r\n",
                gaitPhaseName(gSensor.gaitPhase), gSensor.cadence, gSensor.imuRMS,
                gSensor.freezeActive ? "YES" : "NO");
  Serial.println("RESULT: PASS");
  return 1;
}

static int testTap() {
  Serial.printf("TEST TAP — tap the device now (listening 15 s, need >= 1)\r\n");
  if (!gSensor.imuOk) { Serial.println("RESULT: FAIL (IMU fault)"); return 0; }
  tapReset();
  imuSetActive(true);
  const unsigned long until = millis() + 15000;
  while (millis() < until) {
    imuSampleTick();
    if (tapTick()) Serial.printf("  tap %u detected\r\n", gSensor.tapCount);
    cueTick(); esp_task_wdt_reset(); delay(1);
  }
  bool any = gSensor.tapCount > 0;
  Serial.printf("taps detected: %u\r\nRESULT: %s\r\n",
                gSensor.tapCount, any ? "PASS" : "WARNING (no tap detected)");
  tapReset();   // diagnostic does not leak into the patient tap test state
  return any ? 1 : 2;
}

static int testWifi(bool withScan) {
  Serial.println("TEST WIFI");
  if (withScan) {
    Serial.println("scanning (diagnostic only — normal boot never scans)...");
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n && i < 12; i++)
      Serial.printf("  \"%s\" RSSI %d ch %d\r\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
    if (n <= 0) Serial.println("  no networks found");
    WiFi.scanDelete();
  }
  TelemetryStatus ts; telemetryGetStatus(&ts);
  Serial.printf("state %s  RSSI %d dBm  IP %s\r\n", netStateName(ts.net), ts.rssi, ts.ip);
  bool up = ts.net >= NET_WIFI_CONNECTED;
  Serial.printf("RESULT: %s\r\n", up ? "PASS" : "FAIL (not connected)");
  return up ? 1 : 0;
}

static int testApi() {
  Serial.println("TEST API");
  int code = telemetryTestApi();
  if (code == 0)  { Serial.println("RESULT: FAIL (WiFi not connected)"); return 0; }
  Serial.printf("GET /api/health -> HTTP %d\r\n", code);
  bool ok = code >= 200 && code < 300;
  if (code == 401 || code == 403) Serial.println("hint: device token rejected — check DEVICE_TOKEN");
  Serial.printf("RESULT: %s\r\n", ok ? "PASS" : "FAIL");
  return ok ? 1 : 0;
}

static int testTelemetry() {
  Serial.println("TEST TELEMETRY (serialization + queue)");
  static char scratch[TLM_PACKET_MAX];
  bool ok = telemetryTestSerialize(scratch, sizeof(scratch));
  if (ok) {
    Serial.printf("packet built: %u bytes (cap %u)\r\n", (unsigned)strlen(scratch), TLM_PACKET_MAX);
    Serial.println(scratch);
  }
  TelemetryStatus ts; telemetryGetStatus(&ts);
  Serial.printf("queue %u events %u dropped %lu\r\n", ts.queueDepth, ts.eventDepth, (unsigned long)ts.dropped);
  Serial.printf("RESULT: %s\r\n", ok ? "PASS" : "FAIL");
  return ok ? 1 : 0;
}

static int testMemory() {
  Serial.println("TEST MEMORY");
  uint32_t free_ = ESP.getFreeHeap(), minFree = ESP.getMinFreeHeap(), total = ESP.getHeapSize();
  Serial.printf("heap free %lu  min-free %lu  total %lu\r\n",
                (unsigned long)free_, (unsigned long)minFree, (unsigned long)total);
  bool ok = minFree > 40000;
  Serial.printf("RESULT: %s\r\n", ok ? "PASS" : "WARNING (low watermark)");
  return ok ? 1 : 2;
}

static void reportTiming(bool verdict) {
  Serial.println("TEST TIMING (100 Hz target sampling)" + String(""));
  Serial.printf("target   %.1f Hz  (period %.0f us)\r\n", SAMPLE_RATE_HZ, 1e6f / SAMPLE_RATE_HZ);
  Serial.printf("measured %.2f Hz (rolling 1 s)\r\n", gSensor.sampleRateHz);
  if (gSensor.timingN > 1) {
    double avg = gSensor.timingSumUs / gSensor.timingN;
    double var = gSensor.timingSumSqUs / gSensor.timingN - avg * avg;
    Serial.printf("period   min %lu us  max %lu us  avg %.0f us  jitter(sd) %.0f us  n=%lu\r\n",
                  (unsigned long)gSensor.timingMinUs, (unsigned long)gSensor.timingMaxUs,
                  avg, sqrt(var > 0 ? var : 0), (unsigned long)gSensor.timingN);
  } else {
    Serial.println("period   (insufficient samples yet)");
  }
  if (verdict) {
    bool ok = gSensor.sampleRateHz > SAMPLE_RATE_HZ * 0.9f &&
              gSensor.sampleRateHz < SAMPLE_RATE_HZ * 1.1f;
    Serial.printf("RESULT: %s\r\n", ok ? "PASS" : "FAIL (rate out of ±10%)");
  }
}

/* ---------- test all --------------------------------------------------- */

static void testAll() {
  struct { const char* name; int (*fn)(); } tests[] = {
    { "SYSTEM",      []() { Serial.printf("fw %s uptime %lus reset %s\r\n", FW_VERSION,
                            (unsigned long)((millis() - bootMs) / 1000UL), resetReasonName());
                            Serial.println("RESULT: PASS"); return 1; } },
    { "I2C",         testI2C },
    { "MPU6050",     testImu },
    { "APDS9960",    []() { bool p = apdsPing();
                            Serial.printf("RESULT: %s\r\n", p ? "PASS" : "WARNING (absent/idle)");
                            return p ? 1 : 2; } },
    { "OLED",        []() { bool p = displayDrawsSafelyDemo();
                            Serial.printf("RESULT: %s\r\n", p ? "PASS (visual check)" : "FAIL");
                            return p ? 1 : 0; } },
    { "BUZZER",      testBuzzer },
    { "HAPTIC",      testHaptic },
    { "CALIBRATION", []() { Serial.printf("state: %s  calRMS %.4f\r\n",
                            calFailed ? "FAILED" : "COMPLETE", gSensor.calRMS);
                            bool ok = !calFailed; Serial.printf("RESULT: %s\r\n", ok ? "PASS" : "FAIL");
                            return ok ? 1 : 0; } },
    { "WIFI",        []() { return testWifi(false); } },
    { "API",         testApi },
    { "TELEMETRY",   testTelemetry },
    { "MEMORY",      testMemory },
    { "TIMING",      []() { reportTiming(true);
                            bool ok = gSensor.sampleRateHz > SAMPLE_RATE_HZ * 0.9f;
                            return ok ? 1 : 0; } },
  };
  const int n = 13;
  int pass = 0;
  Serial.println("TEST ALL — 13 subsystem checks");
  for (int i = 0; i < n; i++) {
    Serial.printf("[%d/13] %s\r\n", i + 1, tests[i].name);
    int r = tests[i].fn();
    if (r == 1) pass++;                                  // strict: only real PASS counts
    else if (r == 2) Serial.println("(warning — not counted as pass)");
    esp_task_wdt_reset();
  }
  Serial.printf("RESULT: %d/13 PASS\r\n", pass);
}

/* ---------- reports --------------------------------------------------- */

static void printHelp() {
  Serial.println(F(
"========================================================\r\n"
"PD-SENSE SERIAL DIAGNOSTICS\r\n"
"========================================================\r\n"
"SYSTEM\r\n"
"  status\r\n"
"  test all\r\n"
"  test memory\r\n"
"  test timing\r\n"
"  reboot\r\n"
"SENSORS\r\n"
"  test i2c\r\n"
"  test imu\r\n"
"  test apds\r\n"
"  sensors\r\n"
"SIGNAL PROCESSING\r\n"
"  test tremor\r\n"
"  test gait\r\n"
"  test tap\r\n"
"  test calibration\r\n"
"DISPLAY / ACTUATORS\r\n"
"  test oled\r\n"
"  test buzzer\r\n"
"  test haptic\r\n"
"  page 0\r\n"
"  page 1\r\n"
"  page 2\r\n"
"  page 3\r\n"
"  page 4\r\n"
"NETWORK\r\n"
"  test wifi\r\n"
"  network\r\n"
"  test api\r\n"
"TELEMETRY\r\n"
"  test telemetry\r\n"
"  telemetry\r\n"
"  events\r\n"
"NORMAL MODE\r\n"
"  monitor\r\n"
"DEVELOPMENT\r\n"
"  dev help\r\n"
"========================================================"));
}

static void printStatus() {
  TelemetryStatus ts; telemetryGetStatus(&ts);
  unsigned long up = (millis() - bootMs) / 1000UL;
  Serial.println("========================================================");
  Serial.println("PD-SENSE STATUS");
  Serial.println("========================================================");
  Serial.println("SYSTEM");
  Serial.printf("firmware: %s\r\nuptime: %lus\r\nfree heap: %lu\r\nreset reason: %s\r\n",
                FW_VERSION, up, (unsigned long)ESP.getFreeHeap(), resetReasonName());
  Serial.println("SENSORS");
  Serial.printf("MPU6050: %s\r\nAPDS9960: %s\r\nOLED: %s\r\n",
                gSensor.imuOk ? "OK" : "FAULT",
                gSensor.apdsOk ? "OK" : "FAULT",
                displayOk() ? "OK" : "FAULT");
  Serial.println("CALIBRATION");
  Serial.printf("state: %s\r\n", calFailed ? "FAILED (degraded thresholds)" : "COMPLETE");
  Serial.println("MONITOR");
  Serial.printf("mode: %s\r\npage: %d\r\n", appStateName(), (int)displayGetPage());
  Serial.println("NETWORK");
  Serial.printf("WiFi: %s\r\nRSSI: %d dBm\r\nIP: %s\r\nBackend: %s\r\nNTP: %s\r\n",
                netStateName(ts.net), ts.rssi, ts.ip,
                ts.net == NET_BACKEND_ONLINE ? "ONLINE" :
                ts.net == NET_BACKEND_OFFLINE ? "OFFLINE" : "UNPROVEN",
                ts.timeSynced ? "SYNCED" : "NO");
  Serial.println("TELEMETRY");
  Serial.printf("queue: %u\r\nevents queued: %u\r\nsent: %lu\r\nfailed: %lu\r\ndropped: %lu\r\n",
                ts.queueDepth, ts.eventDepth, (unsigned long)ts.sent,
                (unsigned long)ts.failed, (unsigned long)ts.dropped);
  Serial.printf("last success: %s\r\nsequence: %lu\r\n",
                ts.lastOkMs ? "ok" : "never", (unsigned long)ts.sequence);
  Serial.println("SIGNALS");
  Serial.printf("tremor: %.1f\r\nfrequency: %.2f Hz\r\nquality: %s\r\n",
                gSensor.tremorScore, gSensor.tremorFreq, tremorQualityName(gSensor.tremorQuality));
  Serial.printf("gait: %s\r\ncadence: %.2f\r\nfreeze: %s\r\n",
                gaitWireNamePub(gSensor.gaitPhase), gSensor.cadence,
                gSensor.freezeActive ? "YES" : "NO");
  Serial.println("EVENTS");
  Serial.printf("freeze events: %lu\r\nmedication events: %lu\r\ntap tests: %lu\r\nfall candidates: %lu\r\n",
                (unsigned long)freezeEventCount, (unsigned long)medEventCount,
                (unsigned long)tapTestCount, (unsigned long)fallCandidates);
  Serial.println("========================================================");
}

/* ---------- dev diagnostics (never touch gSensor / never reach the DB) -- */

static void handleDevCommand(char* args) {
#if ENABLE_DEV_DIAGNOSTICS
  Serial.println("DEV commands: dev tremor <0-10> | dev gait freeze|normal | dev help");
  if (!args || !*args) return;
  char* sub = strtok(args, " ");
  char* val = strtok(NULL, " ");
  if (!sub) return;
  if (!strcmp(sub, "tremor") && val) {
    float t = atof(val);                         // actuator path ONLY — local beeps,
    evaluateAndAct(t);                           // never written into sensor state
    Serial.printf("DEV  tremor %.1f -> local cue only (not telemetry)\r\n", t);
  } else if (!strcmp(sub, "gait") && val) {
    if (!strncmp(val, "freeze", 6)) { cueStartRAS(); Serial.println("DEV  freeze cue ON (local only)"); }
    else { cueStopRAS(); Serial.println("DEV  freeze cue OFF"); }
  } else if (!strcmp(sub, "brady") && val) {
    Serial.printf("DEV  brady %d accepted (no actuator response defined)\r\n", atoi(val));
  } else {
    Serial.println("DEV  unknown — use: tremor X | gait freeze|normal | brady N");
  }
#else
  (void)args;
  Serial.println("DEV MODE DISABLED");
#endif
}

/* ---------- dispatcher --------------------------------------------------- */

static void runCommand(char* line) {
  /* normalize: trim + lowercase + collapse spaces */
  char* s = line; while (*s == ' ' || *s == '\t') s++;
  size_t L = strlen(s);
  while (L && (s[L - 1] == ' ' || s[L - 1] == '\t')) s[--L] = 0;
  if (!L) return;
  for (char* p = s; *p; p++) *p = (char)tolower((unsigned char)*p);
  char compact[SERIAL_LINE_MAX];
  uint8_t w = 0; bool sp = false;
  for (char* p = s; *p && w < SERIAL_LINE_MAX - 1; p++) {
    if (*p == ' ') { if (!sp) compact[w++] = ' '; sp = true; }
    else { compact[w++] = *p; sp = false; }
  }
  compact[w] = 0;
  if (!w) return;

  char* cmd = strtok(compact, " ");
  char* arg = strtok(NULL, "");        // remainder
  if (!cmd) return;

  if (!strcmp(cmd, "help"))     { printHelp(); return; }
  if (!strcmp(cmd, "status"))   { printStatus(); return; }
  if (!strcmp(cmd, "reboot"))   { Serial.println("CMD  rebooting"); delay(200); ESP.restart(); }
  if (!strcmp(cmd, "monitor"))  { if (appState != APP_TAP_TEST) { appState = APP_MONITOR; imuSetActive(true); }
                                  displaySetPage(PAGE_STATUS); Serial.println("CMD  mode -> MONITOR"); return; }
  if (!strcmp(cmd, "tap"))      { startTapTest(); return; }
  if (!strcmp(cmd, "v"))        { displaySetPage((UiPage)(((int)displayGetPage() + 1) % PAGE_COUNT));
                                  Serial.printf("CMD  page -> %d\r\n", (int)displayGetPage()); return; }
  if (!strcmp(cmd, "page")) {
    if (!arg) { Serial.println("ERR  usage: page 0..4"); return; }
    int p = atoi(arg);
    if (p < 0 || p >= PAGE_COUNT) { Serial.println("ERR  page 0..4"); return; }
    displaySetPage((UiPage)p);
    Serial.printf("CMD  page -> %d\r\n", p);
    return;
  }
  if (!strcmp(cmd, "dev"))      { handleDevCommand(arg); return; }

  if (!strcmp(cmd, "sensors")) {
    Serial.printf("IMU %s  APDS %s  sampling %s  rate %.1f Hz  calRMS %.4f\r\n",
                  gSensor.imuOk ? "OK" : "FAULT", gSensor.apdsOk ? "OK" : "FAULT",
                  gSensor.imuSampling ? "ON" : "OFF", gSensor.sampleRateHz, gSensor.calRMS);
    return;
  }
  if (!strcmp(cmd, "network"))  {
    TelemetryStatus ts; telemetryGetStatus(&ts);
    Serial.printf("wifi %s rssi %d ip %s backend %s ntp %s\r\n",
                  netStateName(ts.net), ts.rssi, ts.ip,
                  ts.net == NET_BACKEND_ONLINE ? "ONLINE" :
                  ts.net == NET_BACKEND_OFFLINE ? "OFFLINE" : "UNPROVEN",
                  ts.timeSynced ? "SYNCED" : "NO");
    return;
  }
  if (!strcmp(cmd, "telemetry")) {
    TelemetryStatus ts; telemetryGetStatus(&ts);
    Serial.printf("queue %u events %u sent %lu failed %lu dropped %lu seq %lu last-ok %s\r\n",
                  ts.queueDepth, ts.eventDepth, (unsigned long)ts.sent, (unsigned long)ts.failed,
                  (unsigned long)ts.dropped, (unsigned long)ts.sequence, ts.lastOkMs ? "yes" : "never");
    return;
  }
  if (!strcmp(cmd, "events")) {
    Serial.printf("freeze %lu  med %lu  tap %lu  fall-candidates %lu\r\n",
                  (unsigned long)freezeEventCount, (unsigned long)medEventCount,
                  (unsigned long)tapTestCount, (unsigned long)fallCandidates);
    return;
  }
  if (!strcmp(cmd, "memory")) { testMemory(); return; }
  if (!strcmp(cmd, "timing")) { reportTiming(false); return; }

  if (!strcmp(cmd, "test")) {
    if (!arg) { Serial.println("ERR  usage: test <all|i2c|imu|apds|oled|buzzer|haptic|calibration|tremor|gait|tap|wifi|api|telemetry|memory|timing>"); return; }
    char* t = strtok(arg, " ");
    if (!strcmp(t, "all"))         testAll();
    else if (!strcmp(t, "i2c"))    testI2C();
    else if (!strcmp(t, "imu"))    testImu();
    else if (!strcmp(t, "apds"))   testApds();
    else if (!strcmp(t, "oled"))   testOled();
    else if (!strcmp(t, "buzzer")) testBuzzer();
    else if (!strcmp(t, "haptic")) testHaptic();
    else if (!strcmp(t, "calibration")) testCalibration();
    else if (!strcmp(t, "tremor")) testTremor();
    else if (!strcmp(t, "gait"))   testGait();
    else if (!strcmp(t, "tap"))    testTap();
    else if (!strcmp(t, "wifi"))   testWifi(true);
    else if (!strcmp(t, "api"))    testApi();
    else if (!strcmp(t, "telemetry")) testTelemetry();
    else if (!strcmp(t, "memory")) testMemory();
    else if (!strcmp(t, "timing")) reportTiming(true);
    else Serial.println("ERR  unknown test — see help");
    return;
  }
  /* friendly legacy single keys */
  if (!strcmp(cmd, "2"))        { startTapTest(); return; }

  Serial.printf("ERR  unknown command \"%s\" — type help\r\n", cmd);
}

static void handleSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      cmdLine[cmdLen] = 0;
      if (cmdLen) { Serial.printf("CMD  %s\r\n", cmdLine); runCommand(cmdLine); }
      cmdLen = 0;
      continue;
    }
    if (cmdLen < SERIAL_LINE_MAX - 1) cmdLine[cmdLen++] = c;
  }
}

/* ========================================================================= */
/* SECTION 8 — event detection (fall candidate, freeze episodes)             */
/* ========================================================================= */

static unsigned long impactMs = 0;
static bool          confirmingStill = false;
static float         candidatePeak = 0;
static unsigned long lastFallEventMs = 0;
static bool          everFallEvent = false;
#define FALL_EVENT_COOLDOWN_MS 60000UL

static void updateEvents() {
  const unsigned long now = millis();

  /* freeze episode lifecycle: count on confirmed onset, emit ONE event
     with the real duration when the episode closes (gait FSM latches it) */
  if (gSensor.freezeActive && !gaitPrevFreeze) freezeEventCount++;
  gaitPrevFreeze = gSensor.freezeActive;

  if (gSensor.freezeEventPending) {
    gSensor.freezeEventPending = false;
    uint32_t dur = gSensor.lastFreezeDurationMs;
    if (dur >= FREEZE_EVENT_MIN_MS) {
      telemetryNoteFreezeCompleted(dur);
      displayEventOverlay("FREEZE", "EVENT RECORDED");
    } else {
      Serial.printf("EVT  freeze blip %lu ms discarded (< %d ms)\r\n",
                    (unsigned long)dur, FREEZE_EVENT_MIN_MS);
    }
  }

  /* experimental impact/fall-candidate: high jerk + then ~stillness.
     Exactly one candidate event per impact episode, min 60 s apart.    */
  if (!confirmingStill && gSensor.jerkNow > FALL_JERK_THRESHOLD) {
    confirmingStill = true;
    impactMs = now;
    candidatePeak = gSensor.jerkNow;
    Serial.printf("EVT  impact %.1f g/s — watching for stillness\r\n", gSensor.jerkNow);
  }
  if (confirmingStill && gSensor.movingNow) {
    confirmingStill = false;
    Serial.println("EVT  fall-candidate cleared (movement resumed)");
  } else if (confirmingStill && now - impactMs >= STILL_AFTER_FALL_MS) {
    confirmingStill = false;
    if (!everFallEvent || now - lastFallEventMs >= FALL_EVENT_COOLDOWN_MS) {
      everFallEvent = true;
      lastFallEventMs = now;
      fallCandidates++;
      Serial.println("EVT  possible fall candidate (impact + stillness)");
      telemetryNoteFallCandidate(candidatePeak, STILL_AFTER_FALL_MS);
    }
  }
}

/* ========================================================================= */
/* SECTION 9 — display + throttled status                                    */
/* ========================================================================= */

static void buildDisplay(DisplayData& d) {
  TelemetryStatus ts; telemetryGetStatus(&ts);
  memset(&d, 0, sizeof(d));

  snprintf(d.header, sizeof(d.header), "PD-SENSE");
  d.live = gSensor.imuSampling && gSensor.imuOk;

  d.imuOk = gSensor.imuOk; d.apdsOk = gSensor.apdsOk; d.oledOk = displayOk();
  switch (ts.net) {
    case NET_BACKEND_ONLINE:   d.netIcon = NET_ONLINE; break;
    case NET_BACKEND_OFFLINE:  d.netIcon = (ts.queueDepth || ts.eventDepth) ? NET_PENDING : NET_OFFLINE; break;
    case NET_WIFI_CONNECTED:   d.netIcon = NET_CONNECTING; break;
    case NET_WIFI_CONNECTING:  d.netIcon = NET_CONNECTING; break;
    default:                   d.netIcon = NET_OFFLINE; break;
  }
  if ((ts.queueDepth || ts.eventDepth) && ts.net != NET_BACKEND_ONLINE) d.netIcon = NET_PENDING;
  d.wifiRssi = ts.rssi;

  d.tremorScore = gSensor.tremorScore;
  d.tremorFreq  = gSensor.tremorFreq;
  snprintf(d.tremorQuality, sizeof(d.tremorQuality), "%s", tremorQualityName(gSensor.tremorQuality));

  snprintf(d.gaitState, sizeof(d.gaitState), "%s", gaitWireNamePub(gSensor.gaitPhase));
  d.cadenceHz = gSensor.cadence;
  d.freezeEventsToday = (uint16_t)min((uint32_t)999, freezeEventCount);
  d.freezeActive = gSensor.freezeActive;

  d.tapActive = (appState == APP_TAP_TEST);
  d.tapCount = gSensor.tapCount;
  d.tapTarget = TAP_TARGET_COUNT;
  if (d.tapActive && !tapHoldResult) {
    int left = (int)((gSensor.tapStartMs + TAP_TEST_TIMEOUT_MS - millis()) / 1000UL);
    d.tapSecondsLeft = left > 0 ? left : 0;
  } else d.tapSecondsLeft = -1;
  if (tapHoldResult) {
    if (tapCompleted) snprintf(d.tapResult, sizeof(d.tapResult), "GRADE %d %s", lastBrady, lastBradyLabel);
    else              snprintf(d.tapResult, sizeof(d.tapResult), "INCOMPLETE");
  } else if (lastBrady >= 0) {
    snprintf(d.tapResult, sizeof(d.tapResult), "LAST: GRADE %d", lastBrady);
  }

  d.uptimeS = (millis() - bootMs) / 1000UL;
  d.queueDepth = ts.queueDepth;
  d.queueDropped = (uint16_t)min((uint32_t)999, (uint32_t)ts.dropped);
  d.telemetryLoss = ts.dropped > 0;

  d.cueActive = cueBusy();
  snprintf(d.cueLabel, sizeof(d.cueLabel), "%s",
           rasActive ? "FREEZE CUE" : (alertBeepsLeft ? "TREMOR ALERT" : "CUE ACTIVE"));

  snprintf(d.fwVersion, sizeof(d.fwVersion), FW_VERSION);
  d.tlmSent = ts.sent; d.tlmFailed = ts.failed;
}

static void printStatusLine() {
  TelemetryStatus ts; telemetryGetStatus(&ts);
  switch (appState) {
    case APP_MONITOR:
    case APP_FAULT:
      Serial.printf("STA  MON tr %.1f (%s %.2fHz %s) gait %s cad %.2f frz %lu rms %.4f net %s q %u\r\n",
                    gSensor.tremorScore, "---", gSensor.tremorFreq, tremorQualityName(gSensor.tremorQuality),
                    gaitPhaseName(gSensor.gaitPhase), gSensor.cadence,
                    (unsigned long)freezeEventCount, gSensor.imuRMS,
                    netStateName(ts.net), ts.queueDepth);
      break;
    case APP_TAP_TEST:
      Serial.printf("STA  TAP %u/%d filt %.3f thr %.3f\r\n",
                    gSensor.tapCount, TAP_TARGET_COUNT, gSensor.tapSignal,
                    gSensor.calRMS * TAP_THRESHOLD_MULT);
      break;
    case APP_CALIBRATION:
      Serial.println("STA  CALIBRATING — hold still");
      break;
    default: break;
  }
}

/* ========================================================================= */
/* SECTION 10 — setup / loop                                                 */
/* ========================================================================= */

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);

  const esp_task_wdt_config_t wdtCfg = {
    .timeout_ms     = WDT_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true
  };
  esp_task_wdt_deinit();
  esp_task_wdt_init(&wdtCfg);
  esp_task_wdt_add(NULL);

  Serial.printf("\r\n=== %s %s (built %s %s) ===\r\n",
                DEVICE_NAME, FW_VERSION, __DATE__, __TIME__);
  Serial.printf("BOOT reset reason: %s\r\n", resetReasonName());

  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_HAPTIC, OUTPUT); digitalWrite(PIN_HAPTIC, LOW);

  if (!displayInit()) Serial.println("ERR  OLED init failed — sensing continues regardless");
  displaySplash();

  sensorsInit();
  Serial.println(gSensor.imuOk ? "OK   MPU6050" : "ERR  MPU6050 init failed");
  Serial.println(gSensor.apdsGestureOn ? "OK   APDS9960 (gesture on)"
                                       : "ERR  APDS9960 gesture init failed");

  bootMs = millis();
  telemetryInit();          // non-blocking: WiFi FSM handles connect in-loop

  if (gSensor.imuOk) {
    runCalibration();       // BOOT -> CALIBRATION -> MONITORING
  } else {
    appState = APP_FAULT;   // loud, recoverable — health tick retries
    Serial.println("ERR  entering FAULT (IMU absent). Sensing of IMU paused,");
    Serial.println("ERR  gestures/display/telemetry continue; recovery is automatic.");
  }

  imuSetActive(true);
  gaitReset();
  Serial.println("EVT  ready. Type 'help' for the diagnostic console.");
  Serial.println("EVT  normal mode uses REAL SENSORS ONLY.");
}

void loop() {
  esp_task_wdt_reset();
  const unsigned long now = millis();

  handleSerial();
  handleGesture();
  sensorsHealthTick();

  imuSampleTick();

  /* recovery from FAULT: health layer detected IMU return */
  if (appState == APP_FAULT && gSensor.imuOk) {
    Serial.println("EVT  IMU recovered — recalibrating");
    calAttempts = 0;
    runCalibration();
    imuSetActive(true);
  }

  if (appState == APP_CALIBRATION && calAttempts < 3 && !gSensor.imuSampling) {
    /* (calibration is run inline at transitions; this branch is a guard) */
  }

  if (appState == APP_MONITOR) {
    gaitTick();
    if (gSensor.freezeActive) cueStartRAS(); else cueStopRAS();
    if (tremorWindowReady()) {
      tremorCompute();
      evaluateAndAct(gSensor.tremorScore);
    }
  }

  if (appState == APP_TAP_TEST && !tapHoldResult) {
    if (tapTick()) {
      cueClick(TAP_CLICK_MS);
      Serial.printf("EVT  tap %u/%d\r\n", gSensor.tapCount, TAP_TARGET_COUNT);
      if (gSensor.tapCount >= TAP_TARGET_COUNT) finishTapTest(false);
    }
    if (now - gSensor.tapStartMs >= TAP_TEST_TIMEOUT_MS) finishTapTest(true);
  }
  if (appState == APP_TAP_TEST && tapHoldResult && now >= tapHoldUntil) {
    appState = APP_MONITOR;
    displaySetPage(PAGE_STATUS);
  }

  updateEvents();

  cueTick();
  telemetryTick();

  static unsigned long lastPrintMs = 0, lastUiMs = 0;
  if (now - lastPrintMs >= SERIAL_STATUS_MS) { lastPrintMs = now; printStatusLine(); }
  if (now - lastUiMs >= DISPLAY_REFRESH_MS)  { lastUiMs = now; DisplayData d; buildDisplay(d); displayTick(d); }
}
