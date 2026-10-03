/*
 * The load screen: a 3D football, ray-traced per pixel in a WebGL shader,
 * screams in spinning at high speed (with motion blur), hits centre stage in
 * a flash and a shockwave, and the title slams down beneath it.
 *
 * The ball's panels are real geometry: the 12 black pentagons sit on the
 * vertices of an icosahedron and the 20 white hexagons on its face centres,
 * with each pixel taking the nearest panel, weighted by panel size so the
 * seams fall where a real truncated-icosahedron ball's do.
 *
 * Falls back to a 2D canvas ball if WebGL isn't available.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const I = (SK.intro = {});

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uT;
uniform vec3 uBall;      // centre x, y (pixels, origin bottom-left), radius
uniform float uAngle;    // spin angle
uniform float uSpinV;    // spin speed, radians per second (drives the blur)
uniform float uFlash;
uniform float uRing;     // shockwave radius in pixels, < 0 for none
uniform float uRays;

const float PHI = 1.6180340;
const float RP = 0.28746;   // angular inradius of a pentagon panel (16.47 deg)
const float RH = 0.36477;   // angular inradius of a hexagon panel  (20.90 deg)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 perm(vec3 v, int i) {
  if (i == 1) return v.zxy;
  if (i == 2) return v.yzx;
  return v;
}

// Nearest panel to direction n: x = 1 for a pentagon, y = distance to its seam.
vec2 panel(vec3 n) {
  float e1 = 9.0, e2 = 9.0, pent = 0.0;
  for (int i = 0; i < 3; i++) {
    for (int a = 0; a < 2; a++) {
      for (int b = 0; b < 2; b++) {
        float sa = a == 0 ? 1.0 : -1.0, sb = b == 0 ? 1.0 : -1.0;
        // Pentagons: icosahedron vertices (0, +-1, +-phi) and cyclic perms.
        vec3 v = normalize(perm(vec3(0.0, sa, sb * PHI), i));
        float e = acos(clamp(dot(n, v), -1.0, 1.0)) / RP;
        if (e < e1) { e2 = e1; e1 = e; pent = 1.0; } else if (e < e2) { e2 = e; }
        // Hexagons: the dual dodecahedron's vertices (0, +-phi, +-1/phi) and perms...
        vec3 h = normalize(perm(vec3(0.0, sa * PHI, sb / PHI), i));
        e = acos(clamp(dot(n, h), -1.0, 1.0)) / RH;
        if (e < e1) { e2 = e1; e1 = e; pent = 0.0; } else if (e < e2) { e2 = e; }
      }
    }
  }
  // ...plus the eight cube corners (+-1, +-1, +-1).
  for (int c = 0; c < 8; c++) {
    float fc = float(c);
    vec3 h = normalize(vec3(mod(fc, 2.0) < 1.0 ? 1.0 : -1.0, mod(floor(fc / 2.0), 2.0) < 1.0 ? 1.0 : -1.0, fc < 4.0 ? 1.0 : -1.0));
    float e = acos(clamp(dot(n, h), -1.0, 1.0)) / RH;
    if (e < e1) { e2 = e1; e1 = e; pent = 0.0; } else if (e < e2) { e2 = e; }
  }
  return vec2(pent, e2 - e1);
}

mat3 spin(float a) {
  // Tilted spin axis, so the ball tumbles rather than just turning.
  float c = cos(a), s = sin(a);
  mat3 ry = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  float t = 0.55, ct = cos(t), st = sin(t);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, ct, st, 0.0, -st, ct);
  return rx * ry;
}

vec3 background(vec2 frag) {
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  float d = length(uv);
  vec3 col = mix(vec3(0.10, 0.20, 0.46), vec3(0.012, 0.022, 0.07), smoothstep(0.0, 0.95, d));
  // Floodlight rays turning slowly, fanning out from the ball itself.
  vec2 bv = (frag - uBall.xy) / uRes.y;
  float a = atan(bv.y, bv.x);
  d = length(bv);
  float rays = pow(abs(sin(a * 7.0 + uT * 0.35)), 18.0) + 0.6 * pow(abs(sin(a * 11.0 - uT * 0.22)), 26.0);
  col += rays * uRays * vec3(0.35, 0.55, 1.0) * 0.28 * exp(-d * 1.4);
  // Gold haze up from the "pitch" at the bottom.
  col += vec3(0.95, 0.72, 0.2) * 0.16 * exp(-pow((frag.y / uRes.y) * 3.2, 2.0));
  col += vec3(0.1, 0.45, 0.2) * 0.12 * exp(-pow((frag.y / uRes.y) * 5.0, 2.0));
  // Twinkling camera flashes in the dark: round glints with a soft halo.
  float cellSize = uRes.y / 26.0;
  vec2 cell = floor(frag / cellSize);
  float h = hash(cell);
  vec2 off = vec2(hash(cell + 7.1), hash(cell + 3.3)) - 0.5;
  vec2 f = (fract(frag / cellSize) - 0.5 - off * 0.6) * cellSize;
  float glint = exp(-dot(f, f) / (cellSize * 0.05)) + 0.25 * exp(-dot(f, f) / (cellSize * 0.6));
  float tw = step(0.975, h) * pow(max(0.0, sin(uT * (2.0 + h * 6.0) + h * 40.0)), 18.0);
  col += tw * glint * vec3(1.0, 0.95, 0.85);
  // Shockwave ring.
  if (uRing > 0.0) {
    float r = length(frag - uBall.xy);
    float ring = exp(-pow((r - uRing) / 10.0, 2.0)) * clamp(1.0 - uRing / (uRes.x * 0.9), 0.0, 1.0);
    col += ring * vec3(1.0, 0.85, 0.45) * 1.4;
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 col = background(frag);
  vec2 p = (frag - uBall.xy) / uBall.z;
  float r2 = dot(p, p);
  // Halo round the ball.
  col += vec3(1.0, 0.8, 0.35) * 0.35 * exp(-max(0.0, sqrt(r2) - 1.0) * 6.0) * step(1.0, r2) * (0.4 + uFlash);
  if (r2 < 1.0) {
    vec3 N = vec3(p, sqrt(1.0 - r2));
    // Motion blur: average the panels over the shutter time.
    vec3 base = vec3(0.0);
    float span = clamp(uSpinV / 60.0, 0.0, 1.2);
    for (int k = 0; k < 12; k++) {
      float a = uAngle - span * float(k) / 11.0;
      vec2 pnl = panel(spin(a) * N);
      vec3 c = mix(vec3(0.96, 0.97, 1.0), vec3(0.05, 0.06, 0.11), pnl.x);
      float seam = smoothstep(0.0, 0.035, pnl.y);
      c *= mix(0.45, 1.0, seam);
      base += c;
    }
    base /= 12.0;
    vec3 L = normalize(vec3(-0.45, 0.55, 0.75));
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 42.0);
    float rim = pow(1.0 - N.z, 3.0);
    vec3 lit = base * (0.22 + 0.9 * diff) + spec * 0.7 + rim * vec3(0.35, 0.6, 1.0) * 0.55;
    float edge = smoothstep(1.0, 1.0 - 2.0 / uBall.z, sqrt(r2));
    col = mix(col, lit, edge);
  }
  col += uFlash * vec3(1.0, 0.93, 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;

  let canvas, gl, prog, U = {}, fallback = null, raf = 0, running = false;
  let t0 = 0, revealed = false, angle = 0, lastT = 0, skipped = false;
  const ARRIVE = 1.7;   // seconds until impact

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function setupGL() {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false }) || canvas.getContext('experimental-webgl');
    if (!gl) return false;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      console.warn('Intro shader failed, using 2D ball:', e.message);
      return false;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uT', 'uBall', 'uAngle', 'uSpinV', 'uFlash', 'uRing', 'uRays']) U[n] = gl.getUniformLocation(prog, n);
    return true;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }

  const easeOutCubic = (x) => 1 - Math.pow(1 - Math.min(1, x), 3);

  // Ball path and spin over time; the same choreography drives both renderers.
  function state(t, w, h) {
    const portrait = h > w;
    const restR = Math.min(w, h) * (portrait ? 0.24 : 0.185);
    const restX = w / 2, restY = h * (portrait ? 0.66 : 0.705);    // GL y runs upward
    let x, y, r, spinV, flash = 0, ring = -1, rays;
    if (t < ARRIVE) {
      // Curls in from far away top-right, growing as it comes.
      const k = easeOutCubic(t / ARRIVE);
      const kz = Math.pow(t / ARRIVE, 2.2);
      x = w * 0.9 + (restX - w * 0.9) * k + Math.sin(k * Math.PI) * w * 0.12;
      y = h * 0.95 + (restY - h * 0.95) * k;
      r = restR * (0.04 + 0.96 * kz);
      spinV = 48 - 34 * k;
      rays = k * 0.6;
    } else {
      const s = t - ARRIVE;
      const settle = Math.exp(-s * 5) * Math.sin(s * 22) * 0.06;
      x = restX;
      y = restY + Math.sin(t * 1.6) * restR * 0.05;
      r = restR * (1 + settle);
      spinV = 5 + 9 * Math.exp(-s * 1.2);
      flash = Math.max(0, 0.85 - s * 2.6);
      ring = s < 1.6 ? s * Math.max(w, h) * 0.75 : -1;
      rays = 0.6 + 0.4 * Math.min(1, s * 2);
    }
    return { x, y, r, spinV, flash, ring, rays };
  }

  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
    lastT = now;
    const w = canvas.width, h = canvas.height;
    const st = state(t, w, h);
    angle += st.spinV * dt;
    if (!revealed && t >= ARRIVE) reveal();

    if (gl) {
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uT, t);
      gl.uniform3f(U.uBall, st.x, st.y, st.r);
      gl.uniform1f(U.uAngle, angle);
      gl.uniform1f(U.uSpinV, st.spinV);
      gl.uniform1f(U.uFlash, st.flash);
      gl.uniform1f(U.uRing, st.ring);
      gl.uniform1f(U.uRays, st.rays);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else drawFallback(st, t, w, h);
    raf = requestAnimationFrame(frame);
  }

  // 2D fallback: same choreography with the canvas ball.
  const spinM = SK.art.newSpin();
  function drawFallback(st, t, w, h) {
    const c = fallback;
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, '#1a3375');
    g.addColorStop(1, '#03060f');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    const y = h - st.y;
    if (st.ring > 0) {
      c.strokeStyle = `rgba(255,215,110,${Math.max(0, 1 - st.ring / w)})`;
      c.lineWidth = 6;
      c.beginPath(); c.arc(st.x, y, st.ring, 0, Math.PI * 2); c.stroke();
    }
    SK.art.spin(spinM, 0.3, 1, 0.2, st.spinV / 60);
    SK.art.drawBall(c, st.x, y, st.r, spinM);
    if (st.flash > 0) { c.fillStyle = `rgba(255,240,200,${st.flash})`; c.fillRect(0, 0, w, h); }
  }

  // ------------------------------------------------------------- loading

  let progress = 0, assetsDone = false;
  function load() {
    const steps = [
      document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
      // Warm the cache for the FAAH clip so the first miss plays instantly.
      fetch('assets/faah.mp3').then((r) => r.arrayBuffer()).catch(() => null),
      new Promise((r) => setTimeout(r, ARRIVE * 1000 + 700)),
    ];
    let done = 0;
    const bar = document.getElementById('loadBar');
    const pct = document.getElementById('loadPct');
    const tick = () => {
      const target = Math.min(1, (done + 0.0001) / steps.length);
      progress += (target - progress) * 0.15;
      if (bar) bar.style.transform = `scaleX(${progress.toFixed(3)})`;
      if (pct) pct.textContent = Math.round(progress * 100) + '%';
      if (assetsDone && progress > 0.995) { finishLoading(); return; }
      requestAnimationFrame(tick);
    };
    steps.forEach((p) => p.then(() => { done++; }, () => { done++; }));
    Promise.all(steps.map((p) => p.catch(() => null))).then(() => { assetsDone = true; done = steps.length; });
    tick();
  }

  function finishLoading() {
    document.getElementById('screen-title').classList.add('loaded');
  }

  function reveal() {
    revealed = true;
    document.getElementById('screen-title').classList.add('revealed');
  }

  // Tap during the fly-in jumps straight to the finished title.
  function skip() {
    if (revealed || skipped) return;
    skipped = true;
    t0 = performance.now() - ARRIVE * 1000 - 600;
  }

  I.start = function () {
    canvas = document.getElementById('intro');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resize();
    if (!setupGL()) { gl = null; fallback = canvas.getContext('2d'); }
    window.addEventListener('resize', resize);
    canvas.parentElement.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip, { once: true });
    t0 = performance.now() - (reduce ? (ARRIVE + 2) * 1000 : 0);
    running = true;
    raf = requestAnimationFrame(frame);
    load();
  };

  // The title screen keeps the spinning ball; other screens stop the shader.
  I.setActive = function (on) {
    if (on && !running && canvas) { running = true; lastT = 0; raf = requestAnimationFrame(frame); }
    if (!on && running) { running = false; cancelAnimationFrame(raf); }
  };

  I.isRevealed = () => revealed;
})();
