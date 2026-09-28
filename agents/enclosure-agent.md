<!--
 SUPERSEDED — v7 rebuild
 ---------------------------------------------------------------------------
 This agent brief described the PRE-REBUILD architecture (ESP32 `/data`
 endpoint, laptop poller, local-only device, Blynk-era constraints). Those
 contracts no longer exist.

 Current source of truth:
   docs/ARCHITECTURE.md  — system diagram + rules
   docs/FIRMWARE.md, docs/FIRMWARE_TELEMETRY.md, docs/SERIAL_COMMANDS.md
   docs/API.md, docs/DATA_MODEL.md, docs/DASHBOARD.md, docs/DOCTOR_WEBSITE.md
   docs/SECURITY.md, docs/DEPLOYMENT.md, docs/TROUBLESHOOTING.md
 Build state: docs/BUILD_ORDER.md · audit baseline: docs/CURRENT_STATE.md
-->
# Agent scope: Wrist Enclosure (OpenSCAD)

Full spec: [`../docs/HARDWARE_ENCLOSURE.md`](../docs/HARDWARE_ENCLOSURE.md).

## You own

- `neuroloop_enclosure.scad` — the parametric two-part clamshell enclosure.
- All cutouts: OLED window, USB-C access slot, buzzer vent hole grid,
  sensor breathing slits (temp/humidity/air-quality/pressure), wrist strap
  slots on both ends, M2 screw bosses at corners.

## You do NOT own

- Any electronics or firmware. Your only inputs from the electrical side
  are physical dimensions: `stack_l`, `stack_w`, `stack_h` for the MYOSA
  stack, and the OLED module's outer dimensions and window cutout size.

## Hard constraints

1. **Stay parametric.** Every dimension that depends on the actual MYOSA
   stack or OLED module must remain a named variable at the top of the
   file (`stack_l`, `stack_w`, `stack_h`, OLED width/height/window), never
   a hard-coded magic number buried in a `translate()` call. These values
   are not finalized yet — they need to be tuned against physically
   measured hardware before the first print.
2. **Do not print until dimensions are measured.** The current file is a
   design, not a fabrication-ready model. Flag clearly if asked to
   "finalize for print" that the stack/OLED measurements are still
   placeholders unless a human confirms they've been measured.
3. **Preserve rounded edges/fillets** as a deliberate design choice for a
   wearable that sits against skin — don't simplify to sharp box edges for
   convenience.
4. **Sensor breathing slits must stay unobstructed** by any other design
   change — the DHT22, SGP30/MQ, and BMP280 need airflow to read
   correctly; a sealed enclosure defeats those sensors.

## Definition of done for this piece

- The `.scad` file renders as two mating clamshell halves with every
  listed cutout present and correctly positioned relative to the
  (currently placeholder) stack dimensions.
- Changing `stack_l`, `stack_w`, `stack_h`, or the OLED dimensions at the
  top of the file correctly resizes/repositions all dependent cutouts
  without manual editing elsewhere.

