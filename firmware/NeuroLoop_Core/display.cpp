/*
 * ============================================================================
 * display.cpp — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * SSD1306 128x64 rendering. One full redraw per DISPLAY_REFRESH_MS frame —
 * at 128x64 / I2C a full repaint is well under the frame budget and is the
 * most flicker-safe strategy at this rate. Layout discipline:
 *
 *   size-1 text : 6x8 px glyphs  -> max 21 chars/row, rows at y=0,10,...54
 *   size-2 text : 12x16 px       -> max 10 chars/row
 *   pages use : header row (y0), primary value (y14-30), secondary (y36),
 *               status/footer rows (y46 / y56)
 *
 * Every page is drawn by ONE function; shared furniture (header, sensor
 * dots, net glyph, footer) is drawn by helpers so pages cannot drift.
 * ============================================================================
 */

#include "display.h"
#include "config.h"

#include <oled.h>

static oLed oled(128, 64, &Wire, -1);
static bool oledOk = false;

static UiPage currentPage = PAGE_STATUS;

/* event overlay latch */
static char ovL1[22] = "", ovL2[22] = "";
static unsigned long overlayAt = 0;
static bool overlayOn = false;

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

/* status dot: filled = OK, outline = bad/missing. 5px radius circle. */
static void drawDot(int x, int y, bool ok) {
  if (ok) oled.fillCircle(x, y, 3, WHITE);
  else    oled.drawCircle(x, y, 3, WHITE);
}

static void drawHeader(const char* title, bool live) {
  oled.setTextSize(1);
  oled.setTextColor(WHITE);
  oled.setCursor(0, 0);
  oled.print(title);
  if (live) oled.fillCircle(122, 3, 3, WHITE);   // top-right "live" dot
  oled.drawLine(0, 9, 127, 9, WHITE);
}

/* big primary value, up to 10 chars at size 2 */
static void drawPrimary(const char* v) {
  oled.setTextSize(2);
  oled.setCursor(0, 14);
  oled.print(v);
  oled.setTextSize(1);
}

static void drawSecondary(const char* s) {
  oled.setCursor(0, 34);
  oled.print(s);
}

static void drawStatusLine(const char* s) {
  oled.setCursor(0, 46);
  oled.print(s);
}

static void drawFooter(const DisplayData& d) {
  /* "IMU* APDS* NET*" — dot filled=OK, plus "Q" if telemetry is queued */
  oled.setCursor(0, 56);
  oled.print("IMU");  drawDot(28, 59, d.imuOk);
  oled.setCursor(36, 56);
  oled.print("APDS"); drawDot(68, 59, d.apdsOk);
  oled.setCursor(76, 56);
  oled.print("NET");
  drawDot(102, 59, d.netIcon == NET_ONLINE);
  if (d.netIcon == NET_PENDING && d.queueDepth) {
    oled.setCursor(108, 56);
    char q[8]; snprintf(q, sizeof(q), "Q%u", d.queueDepth > 99 ? 99 : d.queueDepth);
    oled.print(q);
  }
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

bool displayInit() {
  oledOk = oled.begin();
  if (oledOk) {
    oled.clearDisplay();
    oled.setTextColor(WHITE);
    oled.setTextSize(1);
    oled.display();
  }
  return oledOk;
}

bool displayOk() { return oledOk; }

void displaySplash() {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.setTextColor(WHITE);
  oled.setTextSize(2);
  oled.setCursor(4, 10);  oled.print(DEVICE_NAME);
  oled.setTextSize(1);
  oled.setCursor(4, 34);  oled.print("FW " FW_VERSION);
  oled.setCursor(4, 46);  oled.print("motor signal monitor");
  oled.display();
  delay(1200);
}

void displaySetPage(UiPage p) { currentPage = p; }
UiPage displayGetPage() { return currentPage; }

/* ------------------------------------------------------------------ */
/* transient full-screen states                                        */
/* ------------------------------------------------------------------ */

void displayCalibration(int secondsLeft) {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.setTextColor(WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);  oled.print("CALIBRATION");
  oled.setCursor(0, 22); oled.print("HOLD STILL");
  if (secondsLeft >= 0) {
    oled.setTextSize(2);
    oled.setCursor(58, 40);
    oled.print(secondsLeft);
    oled.setTextSize(1);
  }
  oled.display();
}

void displayCalibrationResult(bool pass) {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.setTextColor(WHITE);
  oled.setTextSize(2);
  oled.setCursor(0, 12);
  if (pass) {
    oled.print("CAL PASS");
  } else {
    oled.print("CAL FAIL");
    oled.setTextSize(1);
    oled.setCursor(0, 40);
    oled.print("MOVE DETECTED");
  }
  oled.display();
}

void displayEventOverlay(const char* line1, const char* line2) {
  snprintf(ovL1, sizeof(ovL1), "%s", line1);
  snprintf(ovL2, sizeof(ovL2), "%s", line2 ? line2 : "");
  overlayAt = millis();
  overlayOn = true;
}

static void renderOverlay() {
  oled.clearDisplay();
  oled.setTextColor(WHITE);
  oled.drawRect(0, 0, 128, 64, WHITE);
  oled.setTextSize(1);
  int w1 = strlen(ovL1) * 6;
  int w2 = strlen(ovL2) * 6;
  oled.setCursor(max(0, (128 - w1) / 2), 20); oled.print(ovL1);
  if (ovL2[0]) { oled.setCursor(max(0, (128 - w2) / 2), 36); oled.print(ovL2); }
  oled.display();
}

/* ------------------------------------------------------------------ */
/* page renderers                                                      */
/* ------------------------------------------------------------------ */

static void pageStatus(const DisplayData& d) {
  drawHeader("PD-SENSE", d.live);
  char prim[12];
  snprintf(prim, sizeof(prim), "%.1f/10", d.tremorScore);
  drawPrimary(prim);
  char sec[22];
  snprintf(sec, sizeof(sec), "GAIT %s", d.gaitState);
  drawSecondary(sec);
  char st[22];
  const char* net = d.netIcon == NET_ONLINE ? "ONLINE" :
                    d.netIcon == NET_PENDING ? "PENDING" :
                    d.netIcon == NET_CONNECTING ? "CONN.." : "OFFLINE";
  snprintf(st, sizeof(st), "NET %s %s", net, d.cueActive ? "CUE" : "");
  drawStatusLine(st);
  drawFooter(d);
}

static void pageTremor(const DisplayData& d) {
  drawHeader("TREMOR", d.live);
  char prim[12];
  snprintf(prim, sizeof(prim), "%.1f /10", d.tremorScore);
  drawPrimary(prim);
  char sec[22];
  snprintf(sec, sizeof(sec), "%.1f Hz dom", d.tremorFreq);
  drawSecondary(sec);
  drawStatusLine(d.tremorQuality);
  drawFooter(d);
}

static void pageGait(const DisplayData& d) {
  drawHeader("GAIT", d.live);
  char prim[12];
  snprintf(prim, sizeof(prim), "%.10s", d.gaitState);   // FREEZE_CANDIDATE -> "FREEZE_CAN"
  drawPrimary(prim);
  char sec[22];
  snprintf(sec, sizeof(sec), "CAD %.2f Hz", d.cadenceHz);
  drawSecondary(sec);
  char st[22];
  snprintf(st, sizeof(st), "FREEZE TODAY %u", d.freezeEventsToday);
  drawStatusLine(st);
  drawFooter(d);
}

static void pageTap(const DisplayData& d) {
  drawHeader("TAP TEST", d.live);
  if (d.tapActive) {
    char prim[12];
    snprintf(prim, sizeof(prim), "%u/%u", d.tapCount, d.tapTarget);
    drawPrimary(prim);
    /* progress bar, 100 px wide */
    oled.drawRect(14, 36, 100, 8, WHITE);
    int w = d.tapTarget ? (int)((100L * d.tapCount) / d.tapTarget) : 0;
    if (w > 0) oled.fillRect(14, 36, min(w, 100), 8, WHITE);
    char st[22];
    if (d.tapSecondsLeft >= 0) snprintf(st, sizeof(st), "T-%ds", d.tapSecondsLeft);
    else st[0] = 0;
    drawStatusLine(st);
  } else {
    drawPrimary("IDLE");
    drawSecondary(d.tapResult[0] ? d.tapResult : "NO TEST YET");
    drawStatusLine("serial: test tap");
  }
  drawFooter(d);
}

static void pageSystem(const DisplayData& d) {
  drawHeader("SYSTEM", false);
  char l1[22], l2[22], l3[22];
  unsigned long m = d.uptimeS / 60UL;
  snprintf(l1, sizeof(l1), "IMU %s APDS %s", d.imuOk ? "OK" : "ERR", d.apdsOk ? "OK" : "ERR");
  const char* net = d.netIcon == NET_ONLINE ? "OK" :
                    d.netIcon == NET_PENDING ? "PEND" :
                    d.netIcon == NET_CONNECTING ? "CONN" : "DOWN";
  snprintf(l2, sizeof(l2), "NET %s Q%u/%u %s", net, d.queueDepth, d.queueDropped,
           d.telemetryLoss ? "LOSS" : "");
  snprintf(l3, sizeof(l3), "UP %02lu:%02lu OK%lu ER%lu", (unsigned long)(m / 60) % 100,
           (unsigned long)(m % 60),
           (unsigned long)(d.tlmSent > 9999 ? 9999 : d.tlmSent),
           (unsigned long)(d.tlmFailed > 9999 ? 9999 : d.tlmFailed));
  oled.setCursor(0, 14); oled.print(l1);
  oled.setCursor(0, 26); oled.print(l2);
  oled.setCursor(0, 38); oled.print(l3);
  oled.setCursor(0, 50); oled.print(d.fwVersion);
  oled.setCursor(0, 58); oled.print(d.cueActive ? d.cueLabel : "");
}

/* ------------------------------------------------------------------ */
/* frame entry                                                         */
/* ------------------------------------------------------------------ */

void displayTick(const DisplayData& d) {
  if (!oledOk) return;   // OLED failure never stops sensing

  const unsigned long now = millis();
  if (overlayOn) {
    if (now - overlayAt < EVENT_OVERLAY_MS) { renderOverlay(); return; }
    overlayOn = false;
  }

  oled.clearDisplay();
  oled.setTextColor(WHITE);
  oled.setTextSize(1);

  switch (currentPage) {
    case PAGE_TREMOR: pageTremor(d); break;
    case PAGE_GAIT:   pageGait(d);   break;
    case PAGE_TAP:    pageTap(d);    break;
    case PAGE_SYSTEM: pageSystem(d); break;
    case PAGE_STATUS:
    default:          pageStatus(d); break;
  }
  oled.display();
}

/* ------------------------------------------------------------------ */
/* diagnostic self-test (`test oled`)                                   */
/* ------------------------------------------------------------------ */

/* Every renderable surface passes through here once. Blocking on purpose:
 * this runs from the serial console with monitoring paused by the caller. */
void displaySelfTest() {
  if (!oledOk) return;

  oled.clearDisplay(); oled.display();                            // clear
  delay(300);

  oled.setTextSize(1); oled.setTextColor(WHITE);
  oled.setCursor(0, 0);  oled.print("OLED SELF TEST");            // text small
  oled.setTextSize(2);
  oled.setCursor(0, 16); oled.print("128x64 OK");                 // text big
  oled.setTextSize(1); oled.display();
  delay(600);

  oled.drawRect(0, 40, 128, 12, WHITE);                           // border
  oled.fillRect(0, 56, 64, 8, WHITE);                             // progress 50%
  oled.display();
  delay(600);

  /* every production page, held briefly */
  DisplayData d = {};
  d.live = true;
  snprintf(d.header, sizeof(d.header), "PD-SENSE");
  d.imuOk = true; d.apdsOk = true; d.netIcon = NET_ONLINE;
  d.tremorScore = 4.2f; d.tremorFreq = 4.7f;
  snprintf(d.tremorQuality, sizeof(d.tremorQuality), "VALID");
  snprintf(d.gaitState, sizeof(d.gaitState), "WALKING");
  d.cadenceHz = 1.72f; d.freezeEventsToday = 1;
  d.tapActive = true; d.tapCount = 12; d.tapTarget = 20; d.tapSecondsLeft = 12;
  snprintf(d.tapResult, sizeof(d.tapResult), "GRADE 2 Mild");
  d.uptimeS = 65; d.queueDepth = 2; d.queueDropped = 0;
  snprintf(d.fwVersion, sizeof(d.fwVersion), FW_VERSION);

  UiPage keep = currentPage;
  for (uint8_t p = 0; p < PAGE_COUNT; p++) { currentPage = (UiPage)p; overlayOn = false; displayTick(d); delay(700); }
  currentPage = keep;

  displayEventOverlay("MED EVENT", "RECORDED");                   // overlay style
  delay(10); overlayOn = true; overlayAt = millis() - EVENT_OVERLAY_MS + 600;
  DisplayData dummy = {};
  (void)dummy;
  renderOverlay();
  delay(600);
  overlayOn = false;
}

/* quick probe used by `test all`: init state + one harmless render */
bool displayDrawsSafelyDemo() {
  if (!oledOk) return false;
  DisplayData d = {};
  d.netIcon = NET_OFFLINE;
  snprintf(d.fwVersion, sizeof(d.fwVersion), FW_VERSION);
  displayTick(d);
  return true;
}
