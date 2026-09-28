/*
 * ============================================================================
 * display.h — PD-SENSE / NeuroLoop firmware
 * ============================================================================
 * SSD1306 128x64 OLED. The firmware composes ONE DisplayData struct per
 * frame; this module renders it. The coordinator never draws pixels.
 *
 * Pages (changed only by explicit request — serial `page N` or `v`):
 *   PAGE 0 STATUS   one-line overview + network + sensor indicators
 *   PAGE 1 TREMOR   tremor index, dominant Hz, quality state
 *   PAGE 2 GAIT     gait state, cadence, today's freeze episodes
 *   PAGE 3 TAP      live tap-test progress / result
 *   PAGE 4 SYSTEM   per-subsystem OK/ERR matrix + firmware + uptime
 *
 * Transient full-screen states (calibration, event overlays like
 * "MED EVENT RECORDED" / "FREEZE CUE" / "UPLOAD PENDING") take over the
 * frame briefly and release it — they never replace the page model.
 *
 * Hard rule: nothing renders outside 128x64. Size-1 text = 21 chars/row,
 * size-2 = 10 chars/row. Helpers below keep composition within bounds.
 * ============================================================================
 */

#ifndef NEUROLOOP_DISPLAY_H
#define NEUROLOOP_DISPLAY_H

#include <Arduino.h>

enum UiPage : uint8_t { PAGE_STATUS = 0, PAGE_TREMOR, PAGE_GAIT, PAGE_TAP, PAGE_SYSTEM, PAGE_COUNT };

/* Network indications the OLED needs. Distilled to 3 glyphs per line. */
enum NetIcon : uint8_t {
  NET_OFFLINE = 0,     // wifi down
  NET_CONNECTING,      // wifi up, no backend success yet / reconnecting
  NET_ONLINE,          // backend reachable, queue empty
  NET_PENDING          // backend unreachable, queue holding packets
};

struct DisplayData {
  /* header / status */
  char     header[22];        // e.g. "PD-SENSE  *LIVE" (<=21 chars)
  bool     live;              // sensing active right now

  /* page-agnostic sensor+net status (drawn where a page has room) */
  bool     imuOk, apdsOk;
  bool     oledOk;            // for serial echo completeness; screen can't show its own death
  uint8_t  netIcon;           // NetIcon
  int      wifiRssi;          // dBm, 0 if unknown

  /* tremor */
  float    tremorScore;
  float    tremorFreq;
  char     tremorQuality[21]; // "VALID" / "LOW_SIGNAL" / ...

  /* gait */
  char     gaitState[16];     // "WALKING" etc (wire-format names)
  float    cadenceHz;
  uint16_t freezeEventsToday;
  bool     freezeActive;

  /* tap test */
  bool     tapActive;
  uint16_t tapCount;
  uint16_t tapTarget;
  int      tapSecondsLeft;    // -1 when idle
  char     tapResult[22];     // "GRADE 2 Moderate" / "INCOMPLETE"

  /* system */
  uint32_t uptimeS;
  uint16_t queueDepth;
  uint16_t queueDropped;
  bool     telemetryLoss;

  /* cues */
  bool     cueActive;
  char     cueLabel[22];      // "FREEZE CUE" / "TREMOR ALERT"

  /* system page extras */
  char     fwVersion[16];
  uint32_t tlmSent;
  uint32_t tlmFailed;
};

/* --- lifecycle ------------------------------------------------------ */
bool displayInit();                     // returns OLED health (sensing continues on false)
bool displayOk();
void displaySplash();                   // boot splash, ~1.5 s
void displaySetPage(UiPage p);          // serial page N / v
UiPage displayGetPage();

/* --- transient full-screen states ----------------------------------- */
void displayCalibration(int secondsLeft);   // 5..1 countdown; -1 = "HOLD STILL"
void displayCalibrationResult(bool pass);   // shown briefly by coordinator pacing
void displayEventOverlay(const char* line1, const char* line2); // ~EVENT_OVERLAY_MS

/* --- normal frame ---------------------------------------------------- */
void displayTick(const DisplayData& d); // call at DISPLAY_REFRESH_MS cadence

/* --- diagnostic self-test (`test oled`) ------------------------------ */
void displaySelfTest();                 // blocking bench test: full draw pass of every page
bool displayDrawsSafelyDemo();          // quick probe used by `test all`

#endif // NEUROLOOP_DISPLAY_H
