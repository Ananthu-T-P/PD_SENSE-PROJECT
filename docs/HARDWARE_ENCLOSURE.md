# Hardware & Enclosure Spec

## Base platform

MYOSA Mini IoT kit: an ESP32 motherboard with stackable sensor boards.

## Sensor suite

| Sensor | Purpose in this project |
|---|---|
| MPU6050 (accelerometer/gyroscope) | Tremor (FFT-based), tap detection, gait analysis |
| APDS9960 (gesture sensor) | Gesture-based medication logging |
| DHT22 | Temperature / humidity |
| SGP30 or MQ-series | Air quality |
| BMP280 | Barometric pressure |
| OLED display | On-device status/readout |
| Buzzer | Audible tremor-response feedback |
| Actuator | Haptic RAS (rhythmic auditory/tactile stimulation) pulse for gait-freeze response |

## Enclosure: `neuroloop_enclosure.scad`

A parametric OpenSCAD model, designed as a two-part clamshell:

**Design features**
- Rounded edges and fillets throughout (wearable comfort against skin).
- OLED window cutout.
- USB-C access slot (charging/programming without opening the case).
- Buzzer vent hole grid (so the buzzer is audible through the closed
  case).
- Sensor breathing slits for the DHT22, air-quality sensor, and BMP280 —
  these sensors need airflow to read ambient conditions correctly, so a
  sealed enclosure would defeat them.
- Wrist strap slots on both ends.
- M2 screw bosses at all four corners to close the clamshell.

**Parametric variables (must stay tunable, not hard-coded)**
- `stack_l`, `stack_w`, `stack_h` — outer dimensions of the assembled
  MYOSA stack (motherboard + all stacked sensor boards).
- OLED module width, height, and window cutout size.

## Status

The enclosure design is complete conceptually but **not yet dimensionally
finalized**. `stack_l`, `stack_w`, `stack_h`, and the OLED module size need
to be taken from the physically assembled MYOSA stack before this is
ready to print — the current parametric values are placeholders.

## Before printing, confirm

1. The MYOSA stack has been physically assembled (motherboard + all
   sensor boards it will actually carry) and measured for length, width,
   and height including any protruding connectors.
2. The specific OLED module's outer footprint and active display area are
   measured, not assumed from a datasheet thumbnail.
3. A test print of just the corner boss + one wrist-strap-slot section is
   checked for M2 screw fit before committing to a full two-part print.
