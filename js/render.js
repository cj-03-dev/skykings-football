/*
 * Drawing the match: a 3D broadcast camera behind the near touchline that
 * pans with the play, the stadium, the goals, every kid depth-sorted, the
 * effects, and the HUD.
 *
 * World -> screen is a real pinhole camera, so pitch lines stay straight,
 * goals lean in perspective as the camera pans, and the far side of the
 * pitch is drawn at about 60% of the near side.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const C = SK.C;
  const R = (SK.render = {});
  const TAU = Math.PI * 2;

  // Height is fixed; width follows the screen's shape (16:9 up to phone-wide),
  // so wide phones see more pitch instead of black bars.
  let W = 1280;
  const H = 720;
  const PW = C.PW, PH = C.PH, MIDY = PH / 2;
  const GOAL_TOP = MIDY - C.GOAL_W / 2, GOAL_BOT = MIDY + C.GOAL_W / 2;
  R.W = W; R.H = H;

  // ---------------------------------------------------------------- camera

  const CAM = { back: 380, height: 520, lookY: 300, F: 900, yoff: 50 };
  const cam = { x: PW / 2, cy: PH + CAM.back, cz: CAM.height, fy: 0, fz: 0, uy: 0, uz: 0 };
  (function aim() {
    let fy = CAM.lookY - cam.cy, fz = -cam.cz;
    const l = Math.hypot(fy, fz);
    cam.fy = fy / l; cam.fz = fz / l;
    cam.uy = cam.fz; cam.uz = -cam.fy;
  })();
  const CAM_MIN = 350, CAM_MAX = PW - 350;   // pans just far enough to see each goal
  R.cam = cam;
  R.getK = () => k;

  function proj2d(x, y, z = 0) {
    const dx = x - cam.x, dy = y - cam.cy, dz = z - cam.cz;
    const zc = Math.max(40, dy * cam.fy + dz * cam.fz);
    const yc = dy * cam.uy + dz * cam.uz;
    const s = CAM.F / zc;
    return { x: W / 2 + dx * s, y: H / 2 - yc * s + CAM.yoff, s };
  }
  // The 3D renderer swaps in its own camera so labels and effects line up.
  let proj = proj2d;
  R.setProjector = (fn) => { proj = fn || proj2d; };
  R.proj = (x, y, z) => proj(x, y, z);

  // Follow the ball, leaning a little toward the human player.
  function updateCamera(m, snap) {
    let tx = m.ball.x;
    const h = m.human;
    if (h && h.kind === 'player') tx = tx * 0.75 + h.x * 0.25;
    if (h && h.kind === 'ballboy' && m.phase === 'out') tx = h.x;
    tx = Math.max(CAM_MIN, Math.min(CAM_MAX, tx));
    cam.x = snap ? tx : cam.x + (tx - cam.x) * 0.06;
  }

  const FONT = '"Russo One", "Arial Black", system-ui, sans-serif';
  const SPR = 1.05;                   // sprite size relative to world units
  const UI = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';

  let canvas, ctx, k = 1, dpr = 1, lastMatch = null;
  const fx = { banner: null, flash: 0, shake: 0, toasts: [], parts: [], trail: [], hype: 0, flashes: [] };
  R.fx = fx;

  R.init = function (cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    buildCrowd();
    R.resize();
  };

  R.resize = function () {
    const vw = window.innerWidth, vh = window.innerHeight;
    W = Math.round(Math.max(1280, Math.min(1720, (H * vw) / vh)));
    R.W = W;
    const scale = Math.min(vw / W, vh / H);
    const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    let bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (bw > 2560) { bh = Math.round((bh * 2560) / bw); bw = 2560; }
    canvas.width = bw;
    canvas.height = bh;
    k = bw / W;
    R.cssScale = scale;
  };

  // ------------------------------------------------------------ the ground

  function quad(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  }

  function worldRect(c, x0, y0, x1, y1, z = 0) {
    quad(c, [proj(x0, y0, z), proj(x1, y0, z), proj(x1, y1, z), proj(x0, y1, z)]);
  }

  function polyline(c, pts, close) {
    c.beginPath();
    pts.forEach(([x, y], i) => { const p = proj(x, y); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
    if (close) c.closePath();
    c.stroke();
  }

  function arcLine(c, cx, cy, r, a0, a1, n = 40) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    polyline(c, pts);
  }

  function seeded(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  // The crowd: each tier of the main stand is pre-drawn once into a strip,
  // then stretched into place every frame, so thousands of fans cost a few
  // drawImage calls. Strips bob on their own rhythm and jump for goals.
  const STAND = { x0: -700, x1: PW + 700, rows: 14, y0: -92, dy: 17, dz: 14 };
  const strips = [];
  R.strips = strips;
  const endFans = [];
  function buildCrowd() {
    const rnd = seeded(7);
    const shirts = ['#f4f4f6', '#f4f4f6', '#d4af37', '#a50044', '#004d98', '#004d98', '#a50044', '#edbb00', '#3aa7e8', '#ffffff', '#1d1d2a', '#ff6b1a'];
    const skins = ['#c68642', '#e9b78a', '#c5845c', '#f1c27d', '#e0ac69', '#ffdbac', '#785c50', '#d2a18c', '#8d5524'];
    const len = STAND.x1 - STAND.x0;
    for (let r = 0; r < STAND.rows; r++) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(len / 2);
      cv.height = 16;
      const c = cv.getContext('2d');
      c.fillStyle = r % 2 ? '#0f1a3a' : '#16244f';
      c.fillRect(0, 10, cv.width, 6);
      for (let x = 3 + (r % 2) * 3; x < cv.width; x += 6 + rnd() * 1.5) {
        if (rnd() < 0.07) continue;
        c.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
        c.fillRect(x - 2.2, 7, 4.4, 7);
        c.fillStyle = skins[Math.floor(rnd() * skins.length)];
        c.beginPath(); c.arc(x, 5, 2, 0, TAU); c.fill();
        if (rnd() < 0.08) { c.fillStyle = rnd() < 0.5 ? '#ffd23f' : '#ffffff'; c.fillRect(x - 3, 0, 6, 3); }  // scarves and flags
      }
      strips.push({ cv, phase: rnd() * TAU });
    }
    for (const side of [0, 1]) {
      for (let r = 0; r < 9; r++) {
        for (let y = -60; y < PH + 220; y += 12) {
          if (rnd() < 0.1) continue;
          endFans.push({ side, r, y: y + rnd() * 5, shirt: shirts[Math.floor(rnd() * shirts.length)], phase: rnd() * TAU });
        }
      }
    }
  }

  function drawStadium(c, now) {
    // Night sky and floodlight glow.
    const sky = c.createLinearGradient(0, 0, 0, H * 0.45);
    sky.addColorStop(0, '#040817');
    sky.addColorStop(1, '#0e1a3d');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);

    // Main stand, back row first.
    const jump = fx.hype;
    for (let r = STAND.rows - 1; r >= 0; r--) {
      const y = STAND.y0 - r * STAND.dy, z = 8 + r * STAND.dz;
      const a = proj(STAND.x0, y, z), b = proj(STAND.x1, y, z);
      const hgt = 16 * a.s * 1.25;
      const st = strips[r];
      const bob = Math.max(0, Math.sin(now / (jump > 0 ? 120 : 420) + st.phase)) * (1 + jump * 5) * a.s;
      // Riser behind the fans.
      c.fillStyle = r % 2 ? '#0b142e' : '#0e1938';
      c.fillRect(a.x, a.y - hgt, b.x - a.x, hgt + 2);
      c.drawImage(st.cv, a.x, a.y - hgt - bob, b.x - a.x, hgt);
    }

    // End stands behind each goal: rows of fans running toward the camera.
    for (const f of endFans) {
      const x = f.side ? PW + 150 + f.r * 16 : -150 - f.r * 16;
      const p = proj(x, f.y, 6 + f.r * 13);
      if (p.x < -10 || p.x > W + 10) continue;
      const bob = Math.max(0, Math.sin(now / (jump > 0 ? 120 : 420) + f.phase)) * (1 + jump * 5) * p.s;
      c.fillStyle = f.shirt;
      c.fillRect(p.x - 2.2 * p.s, p.y - 7 * p.s - bob, 4.4 * p.s, 7 * p.s);
    }

    // Camera flashes twinkling in the crowd.
    if (Math.random() < 0.25 + jump * 0.8) {
      const r = Math.floor(Math.random() * STAND.rows);
      const x = STAND.x0 + Math.random() * (STAND.x1 - STAND.x0);
      fx.flashes.push({ x, y: STAND.y0 - r * STAND.dy, z: 14 + r * STAND.dz, t: now });
    }
    fx.flashes = fx.flashes.filter((f) => now - f.t < 140);
    for (const f of fx.flashes) {
      const p = proj(f.x, f.y, f.z);
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath(); c.arc(p.x, p.y, 2.2 * p.s, 0, TAU); c.fill();
    }

    // Roof edge and floodlight pylons.
    c.fillStyle = '#05091a';
    c.fillRect(0, 0, W, 26);
    for (const lx of [-260, 260, PW - 260, PW + 260]) {
      const p = proj(lx, -360, 330);
      const g = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, 120);
      g.addColorStop(0, 'rgba(255,255,230,0.95)');
      g.addColorStop(0.12, 'rgba(255,250,210,0.4)');
      g.addColorStop(1, 'rgba(255,250,210,0)');
      c.fillStyle = g;
      c.fillRect(p.x - 120, p.y - 120, 240, 240);
      c.fillStyle = '#fffbe0';
      c.fillRect(p.x - 26 * p.s, p.y - 6 * p.s, 52 * p.s, 12 * p.s);
    }
  }

  function drawGround(c) {
    // Grass, with mowing stripes across the full surround.
    const gx0 = -480, gx1 = PW + 480, gy0 = -70, gy1 = PH + 200;
    const BAND = 80;
    for (let i = 0, x = gx0; x < gx1; x += BAND, i++) {
      c.fillStyle = i % 2 ? '#2f8c3b' : '#38a045';
      worldRect(c, x, gy0, Math.min(gx1, x + BAND), gy1);
      c.fill();
    }
    // Run-off area shading.
    c.fillStyle = 'rgba(0,30,10,0.18)';
    worldRect(c, gx0, gy0, gx1, 0); c.fill();
    worldRect(c, gx0, PH, gx1, gy1); c.fill();
    worldRect(c, gx0, 0, 0, PH); c.fill();
    worldRect(c, PW, 0, gx1, PH); c.fill();
    // Ball boy's track.
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 12;
    const T0 = -C.TRACK, T1 = PH + C.TRACK, X0 = -C.GOAL_D - 26, X1 = PW + C.GOAL_D + 26;
    polyline(c, [[X0, T0], [X1, T0], [X1, T1], [X0, T1]], true);

    // Advertising boards: standing panels along the far side and both ends.
    const board = (x0, y0, x1, y1, i, label = true) => {
      const a0 = proj(x0, y0, 0), a1 = proj(x1, y1, 0), b1 = proj(x1, y1, 20), b0 = proj(x0, y0, 20);
      c.fillStyle = i % 2 ? '#0b2a6b' : '#3b2a7a';
      quad(c, [a0, a1, b1, b0]); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)';
      quad(c, [proj(x0, y0, 17), proj(x1, y1, 17), b1, b0]); c.fill();
      const mx = proj((x0 + x1) / 2, (y0 + y1) / 2, 9);
      const w = Math.abs(a1.x - a0.x);
      if (label && w > 40) {
        c.fillStyle = i % 3 === 1 ? '#ffd23f' : '#ffffff';
        c.font = `${Math.max(6, Math.round(11 * mx.s))}px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(i % 3 === 1 ? 'FIRST TO 3 WINS' : 'SKYKINGS ELITE JUNIORS', mx.x, mx.y);
      }
    };
    for (let x = -460, i = 0; x < PW + 460; x += 170, i++) board(x, -62, x + 166, -62, i);
    for (const ex of [-C.GOAL_D - 70, PW + C.GOAL_D + 70]) {
      for (let y = -62, i = 0; y < PH + 150; y += 120, i++) board(ex, y, ex, y + 116, i + 1, false);
    }

    // Pitch markings.
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = 2.6;
    polyline(c, [[0, 0], [PW, 0], [PW, PH], [0, PH]], true);
    polyline(c, [[PW / 2, 0], [PW / 2, PH]]);
    arcLine(c, PW / 2, MIDY, C.CIRCLE_R, 0, TAU, 64);
    for (const side of [0, 1]) {
      const gx = side ? PW : 0, dir = side ? -1 : 1;
      polyline(c, [[gx, MIDY - C.BOX_W / 2], [gx + dir * C.BOX_D, MIDY - C.BOX_W / 2], [gx + dir * C.BOX_D, MIDY + C.BOX_W / 2], [gx, MIDY + C.BOX_W / 2]]);
      polyline(c, [[gx, MIDY - C.SIX_W / 2], [gx + dir * C.SIX_D, MIDY - C.SIX_W / 2], [gx + dir * C.SIX_D, MIDY + C.SIX_W / 2], [gx, MIDY + C.SIX_W / 2]]);
      const spotX = gx + dir * 110;
      // The "D": part of a circle round the penalty spot outside the box.
      const reach = Math.acos((C.BOX_D - 110) / C.CIRCLE_R);
      if (side) arcLine(c, spotX, MIDY, C.CIRCLE_R, Math.PI - reach, Math.PI + reach, 24);
      else arcLine(c, spotX, MIDY, C.CIRCLE_R, -reach, reach, 24);
      const p = proj(spotX, MIDY);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.beginPath(); c.ellipse(p.x, p.y, 3 * p.s, 2 * p.s, 0, 0, TAU); c.fill();
    }
    const cs = proj(PW / 2, MIDY);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath(); c.ellipse(cs.x, cs.y, 3.4 * cs.s, 2.3 * cs.s, 0, 0, TAU); c.fill();
    for (const [x, y, a0] of [[0, 0, 0], [PW, 0, Math.PI / 2], [PW, PH, Math.PI], [0, PH, -Math.PI / 2]]) {
      arcLine(c, x, y, 12, a0, a0 + Math.PI / 2, 8);
    }
    // Corner flags.
    for (const [x, y] of [[0, 0], [PW, 0], [PW, PH], [0, PH]]) {
      const b0 = proj(x, y, 0), t0 = proj(x, y, 30);
      c.strokeStyle = '#f1f1f1'; c.lineWidth = 1.6 * b0.s;
      c.beginPath(); c.moveTo(b0.x, b0.y); c.lineTo(t0.x, t0.y); c.stroke();
      const wave = Math.sin(performance.now() / 260 + x) * 2;
      c.fillStyle = '#ffd23f';
      c.beginPath(); c.moveTo(t0.x, t0.y); c.lineTo(t0.x + (x ? -12 : 12) * t0.s, t0.y + (4 + wave) * t0.s); c.lineTo(t0.x, t0.y + 8 * t0.s); c.closePath(); c.fill();
    }
  }

  // ------------------------------------------------------------- the goals

  function drawGoal(c, side) {
    const gx = side ? PW : 0, dir = side ? 1 : -1;      // dir points into the net
    const back = gx + dir * C.GOAL_D;
    const bar = C.BAR, backH = C.BAR * 0.62;
    const fT = proj(gx, GOAL_TOP, bar), fB = proj(gx, GOAL_BOT, bar);
    const fT0 = proj(gx, GOAL_TOP, 0), fB0 = proj(gx, GOAL_BOT, 0);
    const bT = proj(back, GOAL_TOP, backH), bB = proj(back, GOAL_BOT, backH);
    const bT0 = proj(back, GOAL_TOP, 0), bB0 = proj(back, GOAL_BOT, 0);

    // Net panels: back, roof, far side, near side.
    c.fillStyle = 'rgba(235,240,255,0.10)';
    for (const panel of [[bT0, bB0, bB, bT], [fT, fB, bB, bT], [fT0, bT0, bT, fT], [fB0, bB0, bB, fB]]) {
      quad(c, panel); c.fill();
    }
    c.strokeStyle = 'rgba(240,244,255,0.32)';
    c.lineWidth = 0.8;
    const mesh = (a, b, d, e, n) => {
      for (let i = 1; i < n; i++) {
        const t = i / n;
        c.beginPath();
        c.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        c.lineTo(e.x + (d.x - e.x) * t, e.y + (d.y - e.y) * t);
        c.stroke();
      }
    };
    mesh(bT0, bB0, bB, bT, 12); mesh(bT0, bT, bB, bB0, 5);
    mesh(fT, fB, bB, bT, 12); mesh(fT, bT, bB, fB, 4);
    mesh(fT0, bT0, bT, fT, 4); mesh(fT0, fT, bT, bT0, 5);
    mesh(fB0, bB0, bB, fB, 4); mesh(fB0, fB, bB, bB0, 5);
    // Back frame.
    c.strokeStyle = 'rgba(220,225,235,0.8)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(bT0.x, bT0.y); c.lineTo(bT.x, bT.y); c.lineTo(fT.x, fT.y);
    c.moveTo(bB0.x, bB0.y); c.lineTo(bB.x, bB.y); c.lineTo(fB.x, fB.y);
    c.moveTo(bT.x, bT.y); c.lineTo(bB.x, bB.y);
    c.stroke();
    // Front frame: posts and crossbar.
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 6.5 * fB.s;
    c.beginPath(); c.moveTo(fT0.x + 1.5, fT0.y); c.lineTo(fT.x + 1.5, fT.y); c.lineTo(fB.x + 1.5, fB.y); c.lineTo(fB0.x + 1.5, fB0.y); c.stroke();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 5 * fB.s;
    c.beginPath(); c.moveTo(fT0.x, fT0.y); c.lineTo(fT.x, fT.y); c.lineTo(fB.x, fB.y); c.lineTo(fB0.x, fB0.y); c.stroke();
  }

  // --------------------------------------------------------- the entities

  function kitFor(p) {
    if (p.kind === 'ballboy') return SK.BALLBOY_KIT;
    return p.role === 'GK' ? p.team.def.gk : p.team.def.kit;
  }

  function drawShadow(c, x, y, rx, ry, a) {
    const p = proj(x, y);
    c.fillStyle = `rgba(0,0,0,${a})`;
    c.beginPath(); c.ellipse(p.x, p.y, rx * p.s, ry * p.s, 0, 0, TAU); c.fill();
  }

  function drawPerson(c, p, m) {
    const pr = proj(p.x, p.y, 0);
    const s = pr.s;
    // Ground marker: team colour for everyone, a pulsing gold ring for you.
    if (p.human) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
      c.strokeStyle = `rgba(255,214,64,${0.65 + 0.35 * pulse})`;
      c.lineWidth = 2.6 * s;
      c.beginPath(); c.ellipse(pr.x, pr.y, 18 * s, 6.6 * s, 0, 0, TAU); c.stroke();
    } else if (p.kind === 'player') {
      c.strokeStyle = p.team.id === 'rma' ? 'rgba(255,255,255,0.55)' : 'rgba(80,140,255,0.6)';
      c.lineWidth = 1.4 * s;
      c.beginPath(); c.ellipse(pr.x, pr.y, 14 * s, 5 * s, 0, 0, TAU); c.stroke();
    }
    drawShadow(c, p.x + 3, p.y + 1, 11 * p.kid.build, 4.2, 0.3);

    const lift = (p.z || 0) + (p.pose === 'celebrate' ? Math.abs(Math.sin(p.phase * 0.8 + performance.now() / 160)) * 6 : 0);
    c.save();
    c.translate(pr.x, pr.y - lift * s);
    c.scale(s * SPR, s * SPR);
    SK.art.drawKid(c, p.kid, kitFor(p), {
      facing: p.facing, flip: p.flip, phase: p.phase, run: p.run,
      pose: p.pose, poseT: p.poseT, diveDir: (p.diveDir || 1) * (p.team && p.team.dir < 0 ? -1 : 1),
      number: p.number,
    });
    c.restore();

    drawLabel(c, p, lift);
  }

  function drawLabel(c, p, lift = 0) {
    const pr = proj(p.x, p.y, 0);
    const s = pr.s;
    // Name tag over the head (projected at head height, so it works for
    // both the 2D and the 3D camera).
    const top = proj(p.x, p.y, 52 * p.kid.height * SPR + 6 + lift).y;
    c.font = `700 ${Math.round(11 * s)}px ${UI}`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    const label = p.human ? 'YOU' : p.kid.name;
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(5,8,20,0.75)';
    c.fillStyle = p.human ? '#ffd640' : p.kind === 'ballboy' ? '#ffb27a' : 'rgba(255,255,255,0.92)';
    c.strokeText(label, pr.x, top);
    c.fillText(label, pr.x, top);
    if (p.human) {
      c.fillStyle = '#ffd640';
      c.beginPath();
      c.moveTo(pr.x - 5 * s, top - 15 * s); c.lineTo(pr.x + 5 * s, top - 15 * s); c.lineTo(pr.x, top - 9 * s);
      c.closePath(); c.fill();
    }

    // Shot / throw power meter.
    if (p.charging) {
      const w = 40 * s, h = 6 * s, x = pr.x - w / 2, y = top - 30 * s;
      c.fillStyle = 'rgba(5,8,20,0.75)';
      c.beginPath(); c.roundRect(x - 2, y - 2, w + 4, h + 4, 4); c.fill();
      const v = p.charge;
      c.fillStyle = v > 0.86 ? '#ff4d4d' : v > 0.6 ? '#ffd23f' : '#5be37a';
      c.fillRect(x, y, w * v, h);
      c.fillStyle = 'rgba(255,77,77,0.35)';
      c.fillRect(x + w * 0.86, y, w * 0.14, h);
    }
  }

  function drawBall(c, b) {
    drawShadow(c, b.x + b.z * 0.35, b.y + b.z * 0.12, C.BALL_R * (1.1 - Math.min(0.5, b.z / 120)), C.BALL_R * 0.45, Math.max(0.12, 0.38 - b.z / 200));
    const p = proj(b.x, b.y, b.z);
    const r = C.BALL_R * p.s * 1.1;
    SK.art.drawBall(c, p.x, p.y - r, r, b.spin);
  }

  // ------------------------------------------------------------------ HUD

  function scoreboard(c, m) {
    const L = m.teams[0], Rt = m.teams[1];
    const cx = W / 2, y = 12, w = 420, h = 56;
    c.save();
    c.fillStyle = 'rgba(6,10,26,0.82)';
    c.strokeStyle = 'rgba(255,214,64,0.6)';
    c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(cx - w / 2, y, w, h, 14); c.fill(); c.stroke();
    const badge = (id, x) => {
      const img = SK.art.badgeImg(id);
      if (img.complete && img.naturalWidth) c.drawImage(img, x - 19, y + 5, 38, 46);
    };
    badge(L.id, cx - w / 2 + 30);
    badge(Rt.id, cx + w / 2 - 30);
    c.textBaseline = 'middle';
    c.font = `22px ${FONT}`;
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.fillText(L.def.short, cx - w / 2 + 56, y + h / 2);
    c.textAlign = 'right';
    c.fillText(Rt.def.short, cx + w / 2 - 56, y + h / 2);
    c.textAlign = 'center';
    c.font = `34px ${FONT}`;
    const goalFlash = fx.flash > 0 && Math.floor(fx.flash / 6) % 2 === 0;
    c.fillStyle = goalFlash ? '#ffd640' : '#ffffff';
    c.fillText(`${L.score}  :  ${Rt.score}`, cx, y + h / 2 + 1);
    c.font = `700 12px ${UI}`;
    c.fillStyle = 'rgba(255,214,64,0.95)';
    c.fillText('FIRST TO 3', cx, y + h + 10);
    c.restore();
  }

  function youPanel(c, m) {
    const h = m.human;
    if (!h) return;
    const role = h.kind === 'ballboy' ? 'BALL BOY' : SK.POSITIONS.find((p) => p.id === h.role).name.toUpperCase();
    const team = h.kind === 'ballboy' ? '' : ` · ${h.team.def.short}`;
    const text = `${h.kid.name.toUpperCase()} · ${role}${team}`;
    c.save();
    c.font = `700 15px ${UI}`;
    const w = c.measureText(text).width + 30;
    c.fillStyle = 'rgba(6,10,26,0.75)';
    c.beginPath(); c.roundRect(14, 14, w, 28, 8); c.fill();
    c.fillStyle = '#ffd640';
    c.beginPath(); c.arc(28, 28, 4, 0, TAU); c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, 38, 29);
    c.restore();
  }

  function banner(c, title, sub, t, color) {
    // Slide in, hold, slide out over the banner's life (t: 0..1).
    const ease = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
    const y = H * 0.42;
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, ease));
    const band = c.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, 'rgba(6,10,26,0)');
    band.addColorStop(0.2, 'rgba(6,10,26,0.82)');
    band.addColorStop(0.8, 'rgba(6,10,26,0.82)');
    band.addColorStop(1, 'rgba(6,10,26,0)');
    c.fillStyle = band;
    c.fillRect(0, y - 52, W, sub ? 104 : 84);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const off = (1 - Math.min(1, ease)) * 60;
    c.font = `64px ${FONT}`;
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.strokeText(title, W / 2 - off, y - (sub ? 10 : 0));
    c.fillStyle = color || '#ffffff';
    c.fillText(title, W / 2 - off, y - (sub ? 10 : 0));
    if (sub) {
      c.font = `700 22px ${UI}`;
      c.fillStyle = '#ffffff';
      c.fillText(sub, W / 2 + off, y + 34);
    }
    c.restore();
  }

  function prompt(c, text) {
    c.save();
    c.font = `700 20px ${UI}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const w = c.measureText(text).width + 36;
    const y = H - 46;
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 200);
    c.globalAlpha = pulse;
    c.fillStyle = 'rgba(6,10,26,0.8)';
    c.beginPath(); c.roundRect(W / 2 - w / 2, y - 18, w, 36, 18); c.fill();
    c.fillStyle = '#ffd640';
    c.fillText(text, W / 2, y + 1);
    c.restore();
  }

  // Events from the match, turned into banners and flashes.
  R.onEvent = function (e, m) {
    R.effectEvent(e, m);
    const now = performance.now();
    const show = (title, sub, ms, color) => { fx.banner = { title, sub, color, start: now, ms }; };
    switch (e.type) {
      case 'goal': {
        const g = e.goal;
        const T = m.teamOf(g.team);
        show('GOAL!', g.own ? `Own goal by ${g.by}  ·  ${T.def.name}` : `${g.human ? 'YOU' : g.by} scores for ${T.def.name}`, 3000, '#ffd640');
        fx.flash = 90;
        fx.shake = 18;
        fx.toasts = [];
        break;
      }
      case 'save': if (e.by && m.ball.last === e.by) toast(e.catch ? 'SAVED!' : 'WHAT A SAVE!', e.by); break;
      case 'miss': toast('MISSED!', e.by, '#ff8a8a'); break;
      case 'post': toast(e.bar ? 'OFF THE BAR!' : 'OFF THE POST!', null, '#ffd640'); break;
      case 'out': toast('OUT!  BALL BOY!', null, '#ffb27a'); break;
      case 'tackle': if (e.won) toast('TACKLE!', e.by); break;
      case 'fulltime': show('FULL TIME', `${e.winner.def.name} win ${e.winner.score}–${e.winner.opp.score}`, 2600, '#ffd640'); break;
      default: break;
    }
  };

  // One call-out at a time; the newest replaces the last.
  function toast(text, by, color) {
    fx.toasts = [{ text, by, color: color || '#ffffff', start: performance.now() }];
  }

  function drawToasts(c) {
    const now = performance.now();
    fx.toasts = fx.toasts.filter((t) => now - t.start < 1300);
    fx.toasts.forEach((t, i) => {
      const age = (now - t.start) / 1300;
      c.save();
      c.globalAlpha = age < 0.1 ? age / 0.1 : age > 0.75 ? (1 - age) / 0.25 : 1;
      c.font = `30px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const y = 122 + i * 38 - age * 10;
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(0,0,0,0.55)';
      c.strokeText(t.text, W / 2, y);
      c.fillStyle = t.color;
      c.fillText(t.text, W / 2, y);
      c.restore();
    });
  }

  // --------------------------------------------------------------- effects

  function puff(x, y, n, col) {
    for (let i = 0; i < n; i++) {
      fx.parts.push({ kind: 'dust', x, y, z: 1, vx: (Math.random() - 0.5) * 1.6, vy: (Math.random() - 0.5) * 1.2, vz: Math.random() * 1.2, life: 1, col });
    }
  }

  function confetti(T) {
    const cols = T.id === 'rma' ? ['#ffffff', '#d4af37', '#3b2a7a'] : ['#a50044', '#004d98', '#edbb00'];
    for (let i = 0; i < 140; i++) {
      fx.parts.push({ kind: 'conf', x: cam.x + (Math.random() - 0.5) * 900, y: Math.random() * PH, z: 160 + Math.random() * 140,
        vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, vz: -0.6 - Math.random() * 0.8,
        spin: Math.random() * TAU, col: cols[i % cols.length], life: 1 });
    }
  }

  function stepParts(c) {
    const next = [];
    for (const q of fx.parts) {
      q.x += q.vx; q.y += q.vy; q.z += q.vz;
      if (q.kind === 'dust') { q.vz -= 0.05; q.life -= 0.035; if (q.z < 0) q.z = 0; }
      else { q.spin += 0.2; q.vx += (Math.random() - 0.5) * 0.08; if (q.z <= 0) { q.z = 0; q.life -= 0.01; } }
      if (q.life <= 0) continue;
      next.push(q);
      const p = proj(q.x, q.y, q.z);
      if (q.kind === 'dust') {
        c.fillStyle = `rgba(214,236,190,${q.life * 0.45})`;
        c.beginPath(); c.arc(p.x, p.y, (2 + (1 - q.life) * 5) * p.s, 0, TAU); c.fill();
      } else {
        c.fillStyle = q.col;
        const w = 4 * p.s, h = 2.4 * p.s * Math.abs(Math.cos(q.spin));
        c.globalAlpha = Math.min(1, q.life * 2);
        c.fillRect(p.x - w / 2, p.y - h / 2, w, Math.max(0.6, h));
        c.globalAlpha = 1;
      }
    }
    fx.parts = next.length > 600 ? next.slice(-600) : next;
  }

  // A fading streak behind fast balls: shots look like shots.
  function drawTrail(c, b) {
    const sp = Math.hypot(b.vx, b.vy);
    if (!b.owner && sp > 9) fx.trail.push({ x: b.x, y: b.y, z: b.z });
    else if (fx.trail.length) fx.trail.shift();
    if (fx.trail.length > 10) fx.trail.shift();
    for (let i = 1; i < fx.trail.length; i++) {
      const a = proj(fx.trail[i - 1].x, fx.trail[i - 1].y, fx.trail[i - 1].z + C.BALL_R);
      const d = proj(fx.trail[i].x, fx.trail[i].y, fx.trail[i].z + C.BALL_R);
      c.strokeStyle = `rgba(255,255,255,${(i / fx.trail.length) * 0.5})`;
      c.lineWidth = C.BALL_R * 1.6 * d.s * (i / fx.trail.length);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(d.x, d.y); c.stroke();
    }
  }

  // When you're off the side of the screen, an arrow at the edge shows where.
  function offscreenArrow(c, m) {
    const h = m.human;
    if (!h) return;
    const p = proj(h.x, h.y, 30);
    if (p.x > 24 && p.x < W - 24) return;
    const left = p.x <= 24;
    const x = left ? 30 : W - 30, y = Math.max(110, Math.min(H - 60, p.y));
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 160);
    c.save();
    c.globalAlpha = pulse;
    c.fillStyle = '#ffd640';
    c.beginPath();
    if (left) { c.moveTo(x - 16, y); c.lineTo(x + 6, y - 14); c.lineTo(x + 6, y + 14); }
    else { c.moveTo(x + 16, y); c.lineTo(x - 6, y - 14); c.lineTo(x - 6, y + 14); }
    c.closePath(); c.fill();
    c.font = `700 14px ${UI}`;
    c.textAlign = left ? 'left' : 'right';
    c.textBaseline = 'middle';
    c.fillText('YOU', left ? x + 12 : x - 12, y + 24);
    c.restore();
  }

  R.effectEvent = function (e, m) {
    const b = m.ball;
    if (e.type === 'shot' || e.type === 'clear') puff(b.x, b.y, 8);
    else if (e.type === 'tackle' && e.won) puff(b.x, b.y, 10);
    else if (e.type === 'dive') puff(e.by.x, e.by.y, 8);
    else if (e.type === 'goal') { confetti(e.team); fx.hype = 1; }
  };

  // ------------------------------------------------------------------ frame

  R.draw = function (m, opts = {}) {
    const now = performance.now();
    if (m && m !== lastMatch) { lastMatch = m; updateCamera(m, true); fx.parts = []; fx.trail = []; }
    else if (m) updateCamera(m, false);
    if (fx.hype > 0) fx.hype = Math.max(0, fx.hype - 0.004);

    let sx = 0, sy = 0;
    if (fx.shake > 0) { sx = (Math.random() - 0.5) * fx.shake * 0.6; sy = (Math.random() - 0.5) * fx.shake * 0.6; fx.shake *= 0.9; if (fx.shake < 0.5) fx.shake = 0; }
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    drawStadium(ctx, now);
    drawGround(ctx);
    if (!m) { vignette(ctx); return; }

    const b = m.ball;
    const behindGoal = (o) => (o.x < -2 || o.x > PW + 2) && Math.abs(o.y - MIDY) < C.GOAL_W / 2 + 40;
    const ents = [...m.players, m.bb];
    const back = [], front = [];
    for (const e of ents) (behindGoal(e) ? back : front).push(e);
    const ballBack = behindGoal(b);
    back.sort((a, c) => a.y - c.y);
    for (const e of back) drawPerson(ctx, e, m);
    if (ballBack) drawBall(ctx, b);
    drawGoal(ctx, 0);
    drawGoal(ctx, 1);
    drawTrail(ctx, b);

    // Depth sort: the ball goes behind whoever is in front of it.
    const list = front.map((e) => ({ y: e.y, e }));
    if (!ballBack) list.push({ y: b.y + 0.5, ball: true });
    list.sort((a, c) => a.y - c.y);
    for (const it of list) {
      if (it.ball) drawBall(ctx, b);
      else drawPerson(ctx, it.e, m);
    }
    stepParts(ctx);

    ctx.setTransform(k, 0, 0, k, 0, 0);
    vignette(ctx);
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,236,170,${Math.min(0.28, fx.flash / 160)})`;
      ctx.fillRect(0, 0, W, H);
      fx.flash--;
    }
    if (opts.hud !== false) drawHud(ctx, m, opts);
  };

  // Overlay mode: the 3D renderer has drawn the world underneath, so this
  // canvas only adds name tags, power bars, effects and the HUD.
  R.drawOverlay = function (m, opts = {}) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (fx.hype > 0) fx.hype = Math.max(0, fx.hype - 0.004);
    if (!m) return;
    if (m !== lastMatch) { lastMatch = m; fx.parts = []; fx.trail = []; }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawTrail(ctx, m.ball);
    const ents = [...m.players, m.bb].sort((a, c) => a.y - c.y);
    if (opts.hud !== false) for (const e of ents) drawLabel(ctx, e, e.pose === 'celebrate' ? 4 : (e.z || 0));
    stepParts(ctx);
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,236,170,${Math.min(0.28, fx.flash / 160)})`;
      ctx.fillRect(0, 0, W, H);
      fx.flash--;
    }
    if (opts.hud !== false) drawHud(ctx, m, opts);
  };

  function drawHud(ctx, m, opts) {
    scoreboard(ctx, m);
    youPanel(ctx, m);
    offscreenArrow(ctx, m);
    drawToasts(ctx);
    if (m.phase === 'kickoff' && m.phaseT < m.KO_FREEZE) {
      banner(ctx, 'KICK OFF', m.kickTeam.def.name, m.phaseT / m.KO_FREEZE, '#ffffff');
    }
    if (fx.banner) {
      const t = (performance.now() - fx.banner.start) / fx.banner.ms;
      if (t >= 1) fx.banner = null;
      else banner(ctx, fx.banner.title, fx.banner.sub, t, fx.banner.color);
    }
    const h = m.human;
    const touch = opts.touch;
    if (h && h.kind === 'ballboy') {
      if (m.phase === 'out' && h.state === 'fetch') prompt(ctx, 'RUN TO THE BALL!');
      else if (h.state === 'hold') prompt(ctx, touch ? 'HOLD THROW, AIM, RELEASE' : 'HOLD SPACE TO THROW · AIM WITH ARROWS');
    } else if (h && m.phase === 'kickoff' && m.ball.owner === h && m.phaseT >= m.KO_FREEZE) {
      prompt(ctx, touch ? 'MOVE OR PASS TO KICK OFF' : 'MOVE OR PRESS E TO KICK OFF');
    }
  }

  function vignette(c) {
    const v = c.createRadialGradient(W / 2, H * 0.55, H * 0.4, W / 2, H * 0.55, H * 1.0);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.42)');
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);
  }
})();
