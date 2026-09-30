/* =========================================================
   PD-SENSE Live Monitor — graphics.js
   The live system visualization. NOT decorative: the scene is a
   technical diagram of the actual data path, and every animated
   element is driven by real state:

     MPU6050 ─ ESP32 ─ PROCESSING ─ TELEMETRY ─ API ─ DATABASE ─ MONITOR

   * a packet dot travels the path ONLY when the app ingests a real
     reading/event (PDS.state topic), at the ingest moment
   * link state follows PDS.state.backend / freshness (colour + flow)
   * the signal-trace amplitude follows the latest tremor index;
     the cadence heartbeat follows the actual cadence_hz
   * gait FREEZE visibly stalls the movement trace

   dataState (normalized readings) -> visualState (amplitudes, node
   states) -> render(). No component mutates the animation directly.

   Fallback: no WebGL required — the schematic is Canvas 2D. If
   THREE.js is present, a small device model renders beside it; if
   not, an SVG drawing takes its place. prefers-reduced-motion
   freezes packets but NEVER hides data. ?debugGraphics=true shows
   FPS / frame time / packet throughput.
   ========================================================= */
window.PDS = window.PDS || {};
(function () {
  "use strict";
  const st = () => window.PDS.state;
  const cfg = () => window.PDS.config;

  const FPS = { frames: 0, t: performance.now(), fps: 0, frameMs: 0 };

  /* ---------------- visual state derived from data ---------------- */
  const visual = {
    linkUp: false,           // backend online
    deviceUp: false,         // freshness === online
    traceAmp: 0.05,          // from tremor index (0..10 -> 0.05..1)
    cadenceHz: 0,            // pulse rate
    frozen: false,           // gait freeze -> trace stalls
    packets: [],             // in-flight packet dots {t0, kind}
  };

  function pullData() {
    const r = st().latest;
    visual.linkUp = st().backend === "online";
    visual.deviceUp = st().freshness.state === "online";
    visual.traceAmp = r && r.tremor_score != null ? 0.08 + (r.tremor_score / 10) * 0.8 : 0.05;
    visual.cadenceHz = r && r.cadence_hz ? r.cadence_hz : 0;
    visual.frozen = !!(r && r.freeze_active);
  }

  /* ---------------- canvas 2D pipeline schematic ---------------- */

  const NODES = ["MPU6050", "ESP32", "PROCESSING", "TELEMETRY", "API", "DATABASE", "LIVE MONITOR"];

  function drawSchematic(cv, nowMs) {
    const g = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    g.save();
    g.scale(dpr, dpr);
    const w = W / dpr, h = H / dpr;
    g.clearRect(0, 0, w, h);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = NODES.length;
    const x0 = 60, x1 = w - 60, yMid = h * 0.52;
    const xs = NODES.map((_, i) => x0 + (x1 - x0) * (i / (n - 1)));

    /* links */
    for (let i = 0; i < n - 1; i++) {
      const up = i < 2 ? visual.deviceUp : visual.linkUp;
      g.strokeStyle = up ? "rgba(127,179,159,.85)" : "rgba(224,120,86,.35)";
      if (!up) g.setLineDash([3, 5]);
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(xs[i] + 26, yMid); g.lineTo(xs[i + 1] - 26, yMid); g.stroke();
      g.setLineDash([]);
    }

    /* packet dots: positioned along the whole path by age / 1.6 s */
    for (const p of visual.packets) {
      const T = reduced ? 0.0001 : (nowMs - p.t0) / 1600;
      if (T >= 1) continue;
      const fx = T * (n - 1);
      const i = Math.min(n - 2, Math.floor(fx));
      const x = (xs[i] + 26) + (xs[i + 1] - xs[i] - 52) * (fx - i);
      g.fillStyle = p.kind === "event" ? "#c9a25a" : "#7fb39f";
      g.beginPath(); g.arc(x, yMid, 3.2, 0, Math.PI * 2); g.fill();
    }
    visual.packets = visual.packets.filter((p) => (nowMs - p.t0) / 1600 < 1);

    /* nodes */
    g.font = "600 9px Inter, sans-serif";
    g.textAlign = "center";
    NODES.forEach((label, i) => {
      const active = (i <= 3 ? visual.deviceUp : visual.linkUp) || i === 6;
      g.strokeStyle = active ? "#3E6E5E" : "#424b53";
      g.fillStyle = "#141a20";
      roundRect(g, xs[i] - 26, yMid - 16, 52, 32, 5);
      g.fill(); g.stroke();
      g.fillStyle = active ? "#e6ebef" : "#5c6770";
      g.fillText(label, xs[i], yMid + 30);
      /* state dot */
      g.fillStyle = active ? "#7fb39f" : "#e07856";
      g.beginPath(); g.arc(xs[i], yMid, 3, 0, Math.PI * 2); g.fill();
    });

    /* live signal trace over the sensor->processing span, amplitude =
       real tremor index; cadence heartbeat pulses along it */
    const yTrace = h * 0.2;
    g.strokeStyle = "#2c3640"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(40, yTrace); g.lineTo(w - 40, yTrace); g.stroke();

    g.strokeStyle = "#5aa2c4"; g.lineWidth = 1.6;
    g.beginPath();
    for (let x = 40; x <= w - 40; x += 3) {
      const t = (x + (reduced ? 0 : nowMs / 8)) * 0.045;
      const carrier = visual.frozen ? 0 : Math.sin(t);       // freeze stalls the trace
      const amp = 14 * visual.traceAmp * carrier;
      g.lineTo(x, yTrace + amp);
    }
    g.stroke();

    if (visual.cadenceHz > 0 && !visual.frozen) {
      const beat = (nowMs / 1000) * visual.cadenceHz;
      const phase = beat % 1;
      const bx = 40 + (w - 80) * phase;
      g.fillStyle = "rgba(127,179,159,.9)";
      g.beginPath(); g.arc(bx, yTrace, 4 * (1 - phase) + 1.5, 0, Math.PI * 2); g.fill();
    }

    g.fillStyle = "#76838d";
    g.textAlign = "left";
    g.font = "10px Inter, sans-serif";
    g.fillText(
      visual.frozen ? "MOVEMENT TRACE — STALLED (FREEZE ACTIVE)" :
      st().latest && st().latest.tremor_score != null
        ? `movement trace — amplitude follows tremor index ${st().latest.tremor_score.toFixed(1)}/10`
        : "movement trace — awaiting valid tremor window", 40, yTrace - 22);

    /* status line */
    g.font = "600 10px Inter, sans-serif";
    g.fillStyle = visual.linkUp ? "#7fb39f" : "#e07856";
    g.fillText(
      visual.linkUp ? "PIPELINE LIVE" : "PIPELINE OFFLINE — telemetry queued on device",
      40, h - 14);

    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ---------------- THREE.js device model (optional) --------------- */
  let three = null;

  function initThree(container) {
    if (typeof THREE === "undefined") { container.querySelector(".scene-fallback").hidden = false; return; }
    const cv = document.createElement("canvas");
    container.appendChild(cv);
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    cam.position.set(0, 1.4, 5.2);
    cam.lookAt(0, 0.1, 0);

    scene.add(new THREE.HemisphereLight(0xdfe8ef, 0x14181c, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 5, 4); scene.add(key);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x22282f, roughness: 0.6, metalness: 0.3 });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.9 });
    const okMat = new THREE.MeshStandardMaterial({ color: 0x3e6e5e, emissive: 0x1c3a30, roughness: 0.4 });
    const oledMat = new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: 0x16232c, roughness: 0.2 });

    const dev = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.5), bodyMat); dev.add(body);
    const strapL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 1.1), strapMat); strapL.position.x = -1.7; dev.add(strapL);
    const strapR = strapL.clone(); strapR.position.x = 1.7; dev.add(strapR);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.7), oledMat); screen.position.y = 0.3; dev.add(screen);
    const imuChip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), okMat); imuChip.position.set(-0.55, 0.26, -0.45); dev.add(imuChip);
    const apdsChip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), okMat.clone()); apdsChip.position.set(0.6, 0.26, -0.45); dev.add(apdsChip);
    scene.add(dev);

    /* orientation axes driven by the latest reading's motion energy */
    const axes = new THREE.Group();
    const mkAxis = (dir, color) => {
      const a = new THREE.ArrowHelper(dir, new THREE.Vector3(), 1.0, color, 0.16, 0.09);
      axes.add(a);
    };
    mkAxis(new THREE.Vector3(1, 0, 0), 0xe07856);
    mkAxis(new THREE.Vector3(0, 1, 0), 0x7fb39f);
    mkAxis(new THREE.Vector3(0, 0, 1), 0x5aa2c4);
    axes.position.set(2.4, -0.8, 0);
    scene.add(axes);

    /* on-screen OLED glyphs: a tiny canvas texture that updates */
    const oledCv = document.createElement("canvas");
    oledCv.width = 128; oledCv.height = 64;
    const oledTex = new THREE.CanvasTexture(oledCv);
    screen.material = new THREE.MeshBasicMaterial({ map: oledTex });

    three = { renderer, scene, cam, dev, axes, oledCv, oledTex, container };
  }

  function drawThree(nowMs, dtMs) {
    if (!three) return;
    const { renderer, scene, cam, dev, oledCv, oledTex, container } = three;
    const W = container.clientWidth, H = container.clientHeight;
    renderer.setSize(W, H, false);
    cam.aspect = W / H;
    cam.updateProjectionMatrix();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = st().latest;
    /* motion energy drives device wobble — real data, not decoration */
    const energy = r ? Math.min(1, (r.imu_rms || 0) * 2.5) : 0;
    if (!reduced) {
      const t = nowMs / 1000;
      dev.rotation.z = Math.sin(t * 1.1) * 0.06 * energy;
      dev.rotation.x = Math.sin(t * 0.7) * 0.05 * energy;
      dev.position.y = Math.sin(t * (r && r.cadence_hz ? r.cadence_hz * Math.PI : 0.8)) * 0.05 * energy;
      if (r && r.freeze_active) { dev.rotation.z *= 0.02; dev.position.y = 0; }
    }
    /* OLED face shows the same numbers as the physical device */
    const g = oledCv.getContext("2d");
    g.fillStyle = "#0a0f14"; g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#9fd3c4"; g.font = "10px monospace";
    g.fillText("PD-SENSE", 4, 12);
    if (r) {
      g.fillText(`TR ${r.tremor_score == null ? "--" : r.tremor_score.toFixed(1)} ${r.tremor_quality}`, 4, 28);
      g.fillText(`${r.gait_state} ${r.cadence_hz == null ? "" : r.cadence_hz.toFixed(2) + "Hz"}`, 4, 42);
      g.fillText(`NET ${st().backend === "online" ? "OK" : "X"}`, 4, 56);
    } else {
      g.fillText("AWAITING TELEMETRY", 4, 34);
    }
    oledTex.needsUpdate = true;
    renderer.render(scene, cam);
  }

  /* ---------------- main loop ----------------
     Hardening rules (learned from the "animation does not work" field bug):
       1. a frame exception must NEVER kill the rAF chain (try/finally)
       2. WebGL/renderer failure degrades to the 2D schematic, never blank
       3. a watchdog re-arms the loop if rAF gets throttled/paused
   ---------------------------------------------------------------- */

  let running = false;
  let lastFrameMs = 0;
  let loopErrLogged = false;

  function loop(nowMs) {
    if (!running) return;
    const t0 = performance.now();
    try {
      const mainCv = document.getElementById("pipeline-canvas");
      if (mainCv) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = mainCv.clientWidth * dpr, ch = mainCv.clientHeight * dpr;
        if (mainCv.width !== cw || mainCv.height !== ch) { mainCv.width = cw; mainCv.height = ch; }
        if (cw > 0 && ch > 0) drawSchematic(mainCv, nowMs);
      }
      drawThree(nowMs, 16);
      FPS.frameMs = performance.now() - t0;
      FPS.frames++;
      lastFrameMs = performance.now();
      if (nowMs - FPS.t >= 1000) { FPS.fps = FPS.frames; FPS.frames = 0; FPS.t = nowMs; }
    } catch (err) {
      if (!loopErrLogged) {                       /* log once, keep the loop alive */
        loopErrLogged = true;
        console.warn("[graphics] frame error (loop continues):", err && err.message);
        if (window.PDS.diagnostics) window.PDS.diagnostics.note("graphics frame error: " + (err && err.message));
        three = null;                             /* 3D may be the broken part — degrade */
      }
    }
    requestAnimationFrame(loop);                   /* ALWAYS reschedule */
  }

  function spawnPacket(kind) {
    visual.packets.push({ t0: performance.now(), kind });
    if (visual.packets.length > 8) visual.packets.shift();
  }

  function init() {
    pullData();
    const host3d = document.getElementById("device-3d");
    if (host3d) {
      try {
        initThree(host3d);
      } catch (err) {                             /* WebGL unavailable/broken -> 2D only */
        console.warn("[graphics] 3D init failed, using fallback:", err && err.message);
        const fb = host3d.querySelector(".scene-fallback");
        if (fb) fb.hidden = false;
        three = null;
      }
    }

    st().subscribe((topic) => {
      pullData();
      if (topic === "reading" || topic === "event") spawnPacket(topic === "event" ? "event" : "reading");
    });

    /* pause rendering when off-screen */
    const holder = document.getElementById("viz-panel");
    running = true;
    if (holder && "IntersectionObserver" in window) {
      new IntersectionObserver((es) => {
        const vis = es[0].isIntersecting;
        if (vis && !running) { running = true; lastFrameMs = 0; }
        if (!vis) running = false;
      }, { threshold: 0.05 }).observe(holder);
    }
    requestAnimationFrame(loop);

    /* watchdog: if rAF stalls while the page is VISIBLE (some renderers
       throttle rAF heavily), drive a frame directly so the UI never looks
       dead. Hidden pages render nothing (correct — saves CPU). */
    setInterval(() => {
      if (running && document.visibilityState === "visible" &&
          performance.now() - lastFrameMs > 1200) {
        lastFrameMs = performance.now();
        loop(performance.now());
      }
    }, 500);
  }

  window.PDS.graphics = { init, spawnPacket, FPS, visual };
})();
