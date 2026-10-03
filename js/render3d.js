/*
 * The 3D match view (three.js / WebGL).
 *
 * The simulation in match.js already runs in 3D world units (x along the
 * pitch, y across it, z up). This file builds a stadium around it and a 3D
 * kid for every player, then each frame copies positions and poses from the
 * simulation onto the models. Name tags, power bars and the HUD are drawn by
 * render.js on a transparent canvas on top, using the projector exported here.
 *
 * Coordinates: sim (x, y, z) -> three (x - PW/2, z, y - PH/2).
 */
(() => {
  'use strict';
  const SK = window.SK;
  const R3 = (SK.render3d = { available: false });
  const T = window.THREE;
  if (!T) return;

  const C = SK.C;
  const PW = C.PW, PH = C.PH, MIDY = PH / 2;
  const GOAL_TOP = MIDY - C.GOAL_W / 2, GOAL_BOT = MIDY + C.GOAL_W / 2;
  const TAU = Math.PI * 2;
  const v3 = (x, y, z = 0) => new T.Vector3(x - PW / 2, z, y - PH / 2);
  const MOBILE = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  let renderer, scene, camera, canvas;
  let match = null, models = [], ballMesh, ballShadow;
  const cam = { x: PW / 2, y: MIDY };
  // Broadcast camera: behind and above the near touchline, panning with play.
  const CAM = { back: 400, height: 285, lookY: 255, fov: 35, margin: 210 };
  R3.CAM = CAM;
  const crowdRows = [];

  // ------------------------------------------------------------ materials

  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new T.MeshLambertMaterial({ color, ...opts }));
    return matCache.get(key);
  }
  function canvasTex(w, h, draw, opts = {}) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new T.CanvasTexture(cv);
    if (opts.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
    t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    return t;
  }
  function mesh(geo, material, { cast = true, receive = false } = {}) {
    const m = new T.Mesh(geo, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }

  // ------------------------------------------------------------ the stadium

  function buildPitch() {
    // Grass: mowing stripes every 80 units, with a little noise.
    const grassTex = canvasTex(256, 256, (c) => {
      for (let i = 0; i < 2; i++) { c.fillStyle = i ? '#2f8c3b' : '#38a045'; c.fillRect(i * 128, 0, 128, 256); }
      for (let n = 0; n < 2600; n++) {
        c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
        c.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 3);
      }
    }, { repeat: [1, 1] });
    const gx0 = -720, gx1 = PW + 720, gy0 = -420, gy1 = PH + 520;
    grassTex.repeat.set((gx1 - gx0) / 160, (gy1 - gy0) / 160);
    grassTex.offset.set(((gx0 % 160) + 160) / 160, 0);
    const grass = mesh(new T.PlaneGeometry(gx1 - gx0, gy1 - gy0), new T.MeshLambertMaterial({ map: grassTex }), { cast: false, receive: true });
    grass.rotation.x = -Math.PI / 2;
    grass.position.copy(v3((gx0 + gx1) / 2, (gy0 + gy1) / 2, 0));
    scene.add(grass);

    // Run-off shading outside the lines.
    const shade = new T.MeshBasicMaterial({ color: 0x002a0a, transparent: true, opacity: 0.18, depthWrite: false });
    const rect = (x0, y0, x1, y1) => {
      const p = new T.Mesh(new T.PlaneGeometry(x1 - x0, y1 - y0), shade);
      p.rotation.x = -Math.PI / 2;
      p.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, 0.15));
      scene.add(p);
    };
    rect(gx0, gy0, gx1, 0); rect(gx0, PH, gx1, gy1); rect(gx0, 0, 0, PH); rect(PW, 0, gx1, PH);

    // Markings as real geometry, so they stay sharp at any distance.
    const pos = [];
    const LW = 2.6;
    const seg = (x0, y0, x1, y1) => {
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * LW / 2, ny = (dx / l) * LW / 2;
      const a = [x0 + nx, y0 + ny], b = [x1 + nx, y1 + ny], c = [x1 - nx, y1 - ny], d = [x0 - nx, y0 - ny];
      for (const [x, y] of [a, b, c, a, c, d]) pos.push(x - PW / 2, 0.3, y - PH / 2);
    };
    const poly = (pts, close) => { for (let i = 0; i < pts.length - 1; i++) seg(...pts[i], ...pts[i + 1]); if (close) seg(...pts[pts.length - 1], ...pts[0]); };
    const arc = (cx, cy, r, a0, a1, n = 48) => {
      const pts = [];
      for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      poly(pts);
    };
    poly([[0, 0], [PW, 0], [PW, PH], [0, PH]], true);
    seg(PW / 2, 0, PW / 2, PH);
    arc(PW / 2, MIDY, C.CIRCLE_R, 0, TAU, 72);
    for (const side of [0, 1]) {
      const gx = side ? PW : 0, dir = side ? -1 : 1;
      poly([[gx, MIDY - C.BOX_W / 2], [gx + dir * C.BOX_D, MIDY - C.BOX_W / 2], [gx + dir * C.BOX_D, MIDY + C.BOX_W / 2], [gx, MIDY + C.BOX_W / 2]]);
      poly([[gx, MIDY - C.SIX_W / 2], [gx + dir * C.SIX_D, MIDY - C.SIX_W / 2], [gx + dir * C.SIX_D, MIDY + C.SIX_W / 2], [gx, MIDY + C.SIX_W / 2]]);
      const spotX = gx + dir * 110, reach = Math.acos((C.BOX_D - 110) / C.CIRCLE_R);
      if (side) arc(spotX, MIDY, C.CIRCLE_R, Math.PI - reach, Math.PI + reach, 24);
      else arc(spotX, MIDY, C.CIRCLE_R, -reach, reach, 24);
      arc(spotX, MIDY, 2.2, 0, TAU, 10);
    }
    arc(PW / 2, MIDY, 2.5, 0, TAU, 10);
    for (const [x, y, a0] of [[0, 0, 0], [PW, 0, Math.PI / 2], [PW, PH, Math.PI], [0, PH, -Math.PI / 2]]) arc(x, y, 12, a0, a0 + Math.PI / 2, 10);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const lines = new T.Mesh(geo, new T.MeshLambertMaterial({ color: 0xf4f6f2, side: T.DoubleSide }));
    lines.receiveShadow = true;
    scene.add(lines);

    // Corner flags.
    for (const [x, y] of [[0, 0], [PW, 0], [PW, PH], [0, PH]]) {
      const pole = mesh(new T.CylinderGeometry(0.8, 0.8, 30, 6), mat('#f1f1f1'));
      pole.position.copy(v3(x, y, 15));
      scene.add(pole);
      const flag = mesh(new T.PlaneGeometry(12, 8), mat('#ffd23f', { side: T.DoubleSide }));
      flag.position.copy(v3(x + (x ? -6 : 6), y, 26));
      flag.userData.wave = true;
      scene.add(flag);
    }
  }

  function boardTexture(text, bg, ink) {
    return canvasTex(512, 64, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, w, 6);
      c.fillStyle = ink;
      c.font = '34px "Russo One", "Arial Black", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 2);
    });
  }

  function buildStadium() {
    const texA = boardTexture('SKYKINGS ELITE JUNIORS', ['#3b2a7a', '#251a52'], '#ffffff');
    const texB = boardTexture('FIRST TO 3 WINS', ['#0b2a6b', '#081c48'], '#ffd23f');
    const boardGeo = new T.BoxGeometry(166, 20, 3);
    let i = 0;
    for (let x = -460; x < PW + 460; x += 170, i++) {
      const b = mesh(boardGeo, [mat('#111a33'), mat('#111a33'), mat('#111a33'), mat('#111a33'), new T.MeshLambertMaterial({ map: i % 3 === 1 ? texB : texA }), mat('#111a33')]);
      b.position.copy(v3(x + 83, -62, 10));
      scene.add(b);
    }
    for (const side of [0, 1]) {
      const ex = side ? PW + C.GOAL_D + 70 : -C.GOAL_D - 70;
      for (let y = -40, j = 0; y < PH + 160; y += 170, j++) {
        const b = mesh(boardGeo, [mat('#111a33'), mat('#111a33'), mat('#111a33'), mat('#111a33'), new T.MeshLambertMaterial({ map: j % 2 ? texB : texA }), mat('#111a33')]);
        b.position.copy(v3(ex, y + 83, 10));
        b.rotation.y = side ? -Math.PI / 2 : Math.PI / 2;
        scene.add(b);
      }
    }

    // Tiered stands: far side and both ends, using the crowd strips that
    // render.js paints (thousands of fans, one textured plane per tier).
    const strips = SK.render.strips || [];
    const ROWS = Math.min(14, strips.length);
    const riserMat = [mat('#0e1938'), mat('#0b142e')];
    const crowdTex = strips.map((st) => {
      const t = new T.CanvasTexture(st.cv);
      t.wrapS = T.RepeatWrapping;
      return t;
    });
    const risers = new T.Group();
    const tier = (r, len, place, rotY) => {
      const tierGroup = new T.Group();
      const tex = crowdTex[r].clone();
      tex.needsUpdate = true;
      tex.repeat.set(len / 1400, 1);
      const fans = new T.Mesh(new T.PlaneGeometry(len, 20), new T.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3 }));
      fans.position.set(0, 24, 2);
      tierGroup.add(fans);
      place(tierGroup);
      tierGroup.rotation.y = rotY;
      scene.add(tierGroup);
      // The riser under this tier joins one merged mesh for all stands.
      tierGroup.updateMatrixWorld(true);
      const step = mesh(new T.BoxGeometry(len, 14, 17), riserMat[r % 2], { cast: false });
      step.matrixAutoUpdate = false;
      step.matrix.copy(tierGroup.matrixWorld).multiply(new T.Matrix4().makeTranslation(0, 7, 0));
      risers.add(step);
      crowdRows.push({ mesh: fans, base: 24, phase: Math.random() * TAU });
    };
    for (let r = 0; r < ROWS; r++) {
      tier(r, PW + 1400, (g) => g.position.copy(v3(PW / 2, -95 - r * 17, r * 14)), 0);
      tier(r, PH + 700, (g) => g.position.copy(v3(-170 - r * 17, PH / 2 + 60, r * 14)), Math.PI / 2);
      tier(r, PH + 700, (g) => g.position.copy(v3(PW + 170 + r * 17, PH / 2 + 60, r * 14)), -Math.PI / 2);
    }
    mergeChildren(risers);
    risers.children.forEach((c) => { c.castShadow = false; });
    scene.add(risers);
    // Roof and back walls closing the bowl.
    const roof = mesh(new T.BoxGeometry(PW + 1800, 10, 160), mat('#070c1d'), { cast: false });
    roof.position.copy(v3(PW / 2, -95 - ROWS * 17 - 40, ROWS * 14 + 70));
    scene.add(roof);

    // Floodlight pylons with glowing panels.
    const glow = canvasTex(128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 2, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,235,1)');
      g.addColorStop(0.2, 'rgba(255,250,215,0.5)');
      g.addColorStop(1, 'rgba(255,250,215,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });
    for (const [x, y] of [[-300, -420], [PW + 300, -420], [-420, PH + 300], [PW + 420, PH + 300]]) {
      const pole = mesh(new T.CylinderGeometry(5, 8, 420, 8), mat('#2a3350'), { cast: false });
      pole.position.copy(v3(x, y, 210));
      scene.add(pole);
      const panel = new T.Mesh(new T.BoxGeometry(70, 40, 6), new T.MeshBasicMaterial({ color: 0xfffbe0 }));
      panel.position.copy(v3(x, y, 430));
      panel.lookAt(v3(PW / 2, MIDY, 0));
      scene.add(panel);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glow, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.scale.set(380, 380, 1);
      sp.position.copy(v3(x, y, 432));
      scene.add(sp);
    }
  }

  function buildGoals() {
    const white = new T.MeshPhongMaterial({ color: 0xffffff, shininess: 60 });
    const netTex = canvasTex(128, 128, (c) => {
      c.clearRect(0, 0, 128, 128);
      c.strokeStyle = 'rgba(245,248,255,0.85)';
      c.lineWidth = 2;
      for (let i = 0; i <= 128; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.moveTo(0, i); c.lineTo(128, i); c.stroke(); }
    });
    netTex.wrapS = netTex.wrapT = T.RepeatWrapping;
    const netMat = (w, h) => {
      const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(w / 16, h / 16);
      return new T.MeshLambertMaterial({ map: t, transparent: true, side: T.DoubleSide, depthWrite: false, alphaTest: 0.05 });
    };
    for (const side of [0, 1]) {
      const gx = side ? PW : 0, dir = side ? 1 : -1, back = gx + dir * C.GOAL_D;
      const g = new T.Group();
      const post = (x, y, h, r = 2.4) => { const m = mesh(new T.CylinderGeometry(r, r, h, 12), white); m.position.copy(v3(x, y, h / 2)); g.add(m); };
      post(gx, GOAL_TOP, C.BAR); post(gx, GOAL_BOT, C.BAR);
      const bar = mesh(new T.CylinderGeometry(2.4, 2.4, C.GOAL_W + 4.8, 12), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.copy(v3(gx, MIDY, C.BAR));
      g.add(bar);
      const backH = C.BAR * 0.62;
      post(back, GOAL_TOP, backH, 1.2); post(back, GOAL_BOT, backH, 1.2);
      // Net panels: back, roof (sloping), two sides.
      const backNet = new T.Mesh(new T.PlaneGeometry(C.GOAL_W, backH), netMat(C.GOAL_W, backH));
      backNet.rotation.y = Math.PI / 2;
      backNet.position.copy(v3(back, MIDY, backH / 2));
      g.add(backNet);
      const roofLen = Math.hypot(C.GOAL_D, C.BAR - backH);
      const roof = new T.Mesh(new T.PlaneGeometry(roofLen, C.GOAL_W), netMat(roofLen, C.GOAL_W));
      roof.rotation.x = -Math.PI / 2;
      roof.rotation.y = dir * Math.atan2(C.BAR - backH, C.GOAL_D) * -1;
      roof.position.copy(v3((gx + back) / 2, MIDY, (C.BAR + backH) / 2));
      g.add(roof);
      for (const y of [GOAL_TOP, GOAL_BOT]) {
        const shape = new T.Shape();
        shape.moveTo(0, 0); shape.lineTo(C.GOAL_D, 0); shape.lineTo(C.GOAL_D, backH); shape.lineTo(0, C.BAR); shape.closePath();
        const sg = new T.ShapeGeometry(shape);
        const uv = sg.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 16, uv.getY(k) / 16);
        const sideNet = new T.Mesh(sg, netMat(16, 16));
        sideNet.material.map.repeat.set(1, 1);
        sideNet.position.copy(v3(gx, y, 0));
        sideNet.scale.x = dir;
        g.add(sideNet);
      }
      scene.add(g);
    }
  }

  // --------------------------------------------------------------- the ball

  function ballTexture() {
    // Same panel maths as the load-screen shader, painted onto an equirect map.
    const PHI = (1 + Math.sqrt(5)) / 2, RP = 0.28746, RH = 0.36477;
    const centers = [];
    const norm = (v) => { const l = Math.hypot(...v); return v.map((a) => a / l); };
    const perms = (v) => [v, [v[2], v[0], v[1]], [v[1], v[2], v[0]]];
    for (const a of [1, -1]) for (const b of [1, -1]) {
      for (const p of perms([0, a, b * PHI])) centers.push({ v: norm(p), r: RP, pent: true });
      for (const p of perms([0, a * PHI, b / PHI])) centers.push({ v: norm(p), r: RH, pent: false });
    }
    for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) centers.push({ v: norm([a, b, c]), r: RH, pent: false });
    return canvasTex(512, 256, (c, w, h) => {
      const img = c.createImageData(w, h);
      for (let j = 0; j < h; j++) {
        const th = (j / h) * Math.PI;
        for (let i = 0; i < w; i++) {
          const ph = (i / w) * TAU;
          const n = [-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)];
          let e1 = 9, e2 = 9, pent = false;
          for (const ce of centers) {
            const d = Math.acos(Math.max(-1, Math.min(1, n[0] * ce.v[0] + n[1] * ce.v[1] + n[2] * ce.v[2]))) / ce.r;
            if (d < e1) { e2 = e1; e1 = d; pent = ce.pent; } else if (d < e2) e2 = d;
          }
          let col = pent ? 22 : 246;
          if (e2 - e1 < 0.035) col *= 0.55;
          const k = (j * w + i) * 4;
          img.data[k] = col; img.data[k + 1] = col; img.data[k + 2] = pent ? col + 8 : col + 4; img.data[k + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
    });
  }

  function buildBall() {
    ballMesh = mesh(new T.SphereGeometry(C.BALL_R * 1.15, 24, 16), new T.MeshPhongMaterial({ map: ballTexture(), shininess: 50 }));
    ballMesh.matrixAutoUpdate = false;
    scene.add(ballMesh);
  }

  // ----------------------------------------------------------------- kids

  function faceTexture(kid) {
    return canvasTex(256, 128, (c) => {
      c.fillStyle = kid.skin; c.fillRect(0, 0, 256, 128);
      const cx = 64, ey = 60;
      // Cheeks.
      c.fillStyle = 'rgba(232,110,110,0.2)';
      for (const s of [-1, 1]) { c.beginPath(); c.ellipse(cx + s * 15, ey + 13, 5, 3, 0, 0, TAU); c.fill(); }
      if (kid.sunglasses) {
        c.fillStyle = '#0d0d12';
        for (const s of [-1, 1]) { c.beginPath(); c.roundRect(cx + s * 10.5 - 8, ey - 5, 16, 10, 3); c.fill(); }
        c.fillRect(cx - 3, ey - 3, 6, 2);
        c.fillStyle = 'rgba(255,255,255,0.6)';
        for (const s of [-1, 1]) c.fillRect(cx + s * 10.5 - 5, ey - 3, 4, 2);
      } else {
        for (const s of [-1, 1]) {
          c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(cx + s * 10, ey, 5, 5.6, 0, 0, TAU); c.fill();
          c.fillStyle = '#21160f'; c.beginPath(); c.ellipse(cx + s * 10, ey + 1, 3.2, 3.8, 0, 0, TAU); c.fill();
          c.fillStyle = '#ffffff'; c.fillRect(cx + s * 10 - 0.5, ey - 1.5, 1.8, 1.8);
          c.strokeStyle = kid.hairColor; c.lineWidth = 2.4;
          c.beginPath(); c.moveTo(cx + s * 5, ey - 9); c.lineTo(cx + s * 15, ey - 10); c.stroke();
        }
      }
      // Smile.
      c.strokeStyle = SK.art.shade(kid.skin, -0.5); c.lineWidth = 2.2;
      c.beginPath(); c.arc(cx, ey + 12, 6, 0.25, Math.PI - 0.25); c.stroke();
    });
  }

  function shirtTexture(kit, number) {
    return canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = kit.shirt; c.fillRect(0, 0, w, h);
      if (kit.stripe) { c.fillStyle = kit.stripe; for (let i = 0; i < 10; i += 2) c.fillRect((i * w) / 10, 0, w / 10, h); }
      if (kit.bib) {
        c.fillStyle = '#1c2541'; c.fillRect(0, 0, w, 14); c.fillRect(0, h - 10, w, 10);
        c.fillStyle = '#ffffff'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('BALL BOY', w * 0.5, h * 0.55);
        c.fillText('BALL BOY', 0, h * 0.55); c.fillText('BALL BOY', w, h * 0.55);
        return;
      }
      // Collar and hem trim.
      c.fillStyle = kit.trim; c.fillRect(0, 0, w, 6); c.fillRect(0, h - 5, w, 5);
      // Crest on the left chest, number on the back.
      c.fillStyle = kit.trim; c.beginPath(); c.arc(w * 0.09, h * 0.32, 6, 0, TAU); c.fill();
      c.font = '900 64px "Russo One", "Arial Black", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.45)';
      c.strokeText(number, w * 0.5, h * 0.56);
      c.fillStyle = kit.number; c.fillText(number, w * 0.5, h * 0.56);
    });
  }

  function hair(kid, R, group) {
    const hm = mat(kid.hairColor);
    const style = kid.hair;
    const capT = style === 'fade' ? 0.85 : style === 'curly' ? 1.12 : 1.02;
    const cap = mesh(new T.SphereGeometry(R * (style === 'fade' ? 1.02 : 1.06), 24, 12, 0, TAU, 0, capT), hm);
    group.add(cap);
    // Back and sides down to the nape (phi pi..2pi is the back half).
    const back = mesh(new T.SphereGeometry(R * 1.04, 20, 10, Math.PI * 0.92, Math.PI * 1.16, 0.6, style === 'fade' ? 0.9 : 1.15), hm);
    group.add(back);
    if (style === 'spiky') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU, tilt = 0.55;
        const sp = mesh(new T.ConeGeometry(1.8, 5.5, 6), hm);
        sp.position.set(Math.cos(a) * R * 0.55, R * 0.92, Math.sin(a) * R * 0.55);
        sp.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
        group.add(sp);
      }
    } else if (style === 'curly') {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU, el = 0.35 + (i % 3) * 0.25;
        const b = mesh(new T.SphereGeometry(2.4, 8, 6), hm);
        b.position.set(Math.cos(a) * Math.cos(el) * R * 1.02, Math.sin(el) * R * 1.02 + 0.5, Math.sin(a) * Math.cos(el) * R * 1.02);
        group.add(b);
      }
    } else if (style === 'swoosh' || style === 'side') {
      const fr = mesh(new T.SphereGeometry(R * 1.08, 16, 8, Math.PI * 0.1, Math.PI * 0.6, 0.55, 0.5), hm);
      fr.rotation.y = style === 'side' ? 0.35 : -0.15;
      group.add(fr);
    }
  }

  function crown(R, group) {
    const gold = new T.MeshPhongMaterial({ color: 0xffc933, emissive: 0x4a3200, specular: 0xfff3a3, shininess: 90 });
    const band = mesh(new T.CylinderGeometry(R * 0.72, R * 0.76, R * 0.42, 20, 1, true), gold);
    band.material.side = T.DoubleSide;
    band.position.y = R * 0.92;
    group.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const pt = mesh(new T.ConeGeometry(1.5, 4.2, 6), gold);
      pt.position.set(Math.cos(a) * R * 0.72, R * 0.92 + R * 0.21 + 2, Math.sin(a) * R * 0.72);
      group.add(pt);
      const pearl = mesh(new T.SphereGeometry(0.9, 8, 6), mat('#fff6cf'));
      pearl.position.set(pt.position.x, pt.position.y + 2.3, pt.position.z);
      group.add(pearl);
      const jewel = mesh(new T.SphereGeometry(1.0, 8, 6), new T.MeshPhongMaterial({ color: i % 2 ? 0x2a6be0 : 0xe0233a, shininess: 100 }));
      const ja = a + TAU / 10;
      jewel.position.set(Math.cos(ja) * R * 0.76, R * 0.92, Math.sin(ja) * R * 0.76);
      group.add(jewel);
    }
  }

  // Merge a group's direct mesh children that share a material into one mesh
  // each (same look, far fewer draw calls). Nested groups (limbs, head) are
  // merged separately so they can still animate.
  function mergeChildren(group) {
    const buckets = new Map();
    for (const ch of [...group.children]) {
      if (!ch.isMesh || Array.isArray(ch.material)) continue;
      if (!buckets.has(ch.material)) buckets.set(ch.material, []);
      buckets.get(ch.material).push(ch);
    }
    for (const [material, list] of buckets) {
      if (list.length < 2) continue;
      const pos = [], nor = [], uv = [];
      for (const ch of list) {
        if (ch.matrixAutoUpdate) ch.updateMatrix();
        const g = (ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone());
        g.applyMatrix4(ch.matrix);
        pos.push(...g.attributes.position.array);
        nor.push(...g.attributes.normal.array);
        if (g.attributes.uv) uv.push(...g.attributes.uv.array);
        else for (let k = 0; k < g.attributes.position.count; k++) uv.push(0, 0);
        g.dispose();
        ch.geometry.dispose();
        group.remove(ch);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      const merged = new T.Mesh(geo, material);
      merged.castShadow = true;
      group.add(merged);
    }
  }

  // One kid: legs, shorts, shirt, arms, head, hair, extras. Feet at y = 0,
  // facing +z. Height and build come straight from the squad data.
  function buildKid(kid, kit, number) {
    const h = kid.height, b = kid.build;
    const legH = 13 * h, torsoH = 14 * h, hipY = legH, shoulderY = hipY + torsoH;
    const armScale = b > 1.1 ? 1.3 : 1;
    const R = 7.6 * (0.94 + 0.06 * h);
    const root = new T.Group();
    const body = new T.Group();
    root.add(body);
    const skin = mat(kid.skin);

    const legs = [];
    for (const side of [1, -1]) {
      const pivot = new T.Group();
      pivot.position.set(side * 3.3 * (0.92 + 0.08 * b), hipY, 0);
      const thigh = mesh(new T.CapsuleGeometry(2.3 * (0.95 + 0.05 * b), legH * 0.42, 4, 8), skin);
      thigh.position.y = -legH * 0.3;
      const sock = mesh(new T.CylinderGeometry(2.6, 2.4, legH * 0.46, 10), mat(kit.socks));
      sock.position.y = -legH * 0.7;
      const boot = mesh(new T.BoxGeometry(4.8, 3, 8.5), mat('#15151b'));
      boot.position.set(0, -legH + 1.5, 1.6);
      pivot.add(thigh, sock, boot);
      body.add(pivot);
      legs.push(pivot);
    }
    const shorts = mesh(new T.CylinderGeometry(6.6 * b, 6.2 * b, 7, 16), mat(kit.shorts));
    shorts.position.y = hipY + 1.5;
    body.add(shorts);

    const torso = mesh(new T.CylinderGeometry(7.3 * b, 6.3 * b, torsoH, 20), new T.MeshLambertMaterial({ map: shirtTexture(kit, number) }));
    torso.position.y = hipY + torsoH / 2 + 2;
    body.add(torso);
    const shoulders = mesh(new T.SphereGeometry(7.3 * b, 20, 8, 0, TAU, 0, Math.PI / 2), mat(kit.bib ? '#1c2541' : kit.shirt));
    shoulders.scale.y = 0.35;
    shoulders.position.y = shoulderY + 2;
    body.add(shoulders);

    const arms = [];
    const armL = 13 * h;
    for (const side of [1, -1]) {
      const pivot = new T.Group();
      pivot.position.set(side * (7.3 * b + 1.6 * armScale), shoulderY + 0.5, 0);
      const sleeve = mesh(new T.CylinderGeometry(2.5 * armScale, 2.3 * armScale, 5, 10), mat(kit.bib ? '#1c2541' : kit.shirt));
      sleeve.position.y = -2;
      const arm = mesh(new T.CapsuleGeometry(1.8 * armScale, armL - 6, 4, 8), skin);
      arm.position.y = -armL / 2 - 1;
      const cuff = mesh(new T.CylinderGeometry(2.55 * armScale, 2.55 * armScale, 1.1, 10), mat(kit.sleeve || kit.trim));
      cuff.position.y = -4.3;
      pivot.add(sleeve, arm, cuff);
      body.add(pivot);
      arms.push(pivot);
    }

    const neck = mesh(new T.CylinderGeometry(2.4, 2.6, 4, 10), skin);
    neck.position.y = shoulderY + 3;
    body.add(neck);

    const head = new T.Group();
    head.position.y = shoulderY + 4 + R * 0.88;
    const face = mesh(new T.SphereGeometry(R, 28, 18), new T.MeshLambertMaterial({ map: faceTexture(kid) }));
    head.add(face);
    for (const side of [1, -1]) {
      const ear = mesh(new T.SphereGeometry(1.9, 8, 6), skin);
      ear.position.set(side * R * 0.97, 0, -0.5);
      ear.scale.set(0.6, 1, 1);
      head.add(ear);
    }
    const nose = mesh(new T.SphereGeometry(1.2, 8, 6), skin);
    nose.position.set(0, -1, R * 0.97);
    head.add(nose);
    hair(kid, R, head);
    if (kid.crown) crown(R, head);
    if (kid.sunglasses) {
      const shades = mesh(new T.BoxGeometry(R * 1.55, 3.6, 1), new T.MeshPhongMaterial({ color: 0x0b0b10, shininess: 120 }));
      shades.position.set(0, 0.9, R * 0.93);
      head.add(shades);
    }
    body.add(head);

    for (const g of [body, head, ...legs, ...arms]) mergeChildren(g);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { root, body, legs, arms, head, hipY };
  }

  function kitOf(p) {
    if (p.kind === 'ballboy') return SK.BALLBOY_KIT;
    return p.role === 'GK' ? p.team.def.gk : p.team.def.kit;
  }

  function buildModels(m) {
    // Free the previous line-up's meshes and per-kid textures (the menu demo
    // restarts constantly, so this must not leak).
    for (const md of models) {
      scene.remove(md.root);
      md.root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        if (o.material.map) { o.material.map.dispose(); o.material.dispose(); }
      });
      if (md.ring) { scene.remove(md.ring); md.ring.geometry.dispose(); md.ring.material.dispose(); }
    }
    models = [];
    for (const p of [...m.players, m.bb]) {
      const md = buildKid(p.kid, kitOf(p), p.number || '');
      md.p = p;
      scene.add(md.root);
      if (p.kind === 'player' || p.human) {
        const gold = p.human;
        const ring = new T.Mesh(
          new T.RingGeometry(gold ? 15 : 12, gold ? 19 : 14, 36),
          new T.MeshBasicMaterial({ color: gold ? 0xffd640 : p.team && p.team.id === 'rma' ? 0xffffff : 0x4f8cff, transparent: true, opacity: gold ? 0.95 : 0.5, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        md.ring = ring;
        scene.add(ring);
      }
      models.push(md);
    }
  }

  // Copy one player's sim state onto its model.
  function pose(md, now) {
    const p = md.p;
    const { root, body, legs, arms } = md;
    root.position.copy(v3(p.x, p.y, 0));
    if (md.ring) {
      md.ring.position.copy(v3(p.x, p.y, 0.5));
      if (p.human) md.ring.material.opacity = 0.65 + 0.35 * Math.sin(now / 180);
    }
    const yaw = Math.atan2(p.fx || 0, p.fy || 0.0001);
    root.rotation.y = yaw;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    const run = p.run || 0, ph = p.phase || 0;
    let lLeg = Math.sin(ph) * 0.8 * run, rLeg = -lLeg;
    let lArm = -Math.sin(ph) * 0.7 * run, rArm = -lArm, armSpread = 0.08;
    body.position.y = Math.abs(Math.sin(ph)) * 1.2 * run;
    body.rotation.x = run * 0.1;   // lean into the run

    // Sideways lean toward world +y (sim) for dives, mapped into local space.
    const diveLean = () => (p.diveDir || 1) * Math.sign(Math.sin(yaw) || 1);

    switch (p.pose) {
      case 'kick': {
        const t = p.poseT || 0;
        rLeg = t < 0.35 ? 0.9 * (t / 0.35) : 0.9 - 2.4 * Math.min(1, (t - 0.35) / 0.3);
        lLeg = 0.15; lArm = 0.6; rArm = -0.6; armSpread = 0.5;
        body.rotation.x = -0.12;
        break;
      }
      case 'tackle':
        body.rotation.x = -0.95;
        body.position.y = 2;
        rLeg = -1.2; lLeg = -0.4; lArm = 0.8; rArm = -1.6; armSpread = 0.4;
        break;
      case 'dive':
        body.rotation.z = diveLean() * 1.25;
        body.position.y = (p.z || 0) + 4;
        lArm = rArm = -3.0; armSpread = 0.25; lLeg = rLeg = 0.1;
        break;
      case 'down':
        body.rotation.z = diveLean() * 1.5;
        body.position.y = 3;
        lArm = rArm = -2.6; lLeg = rLeg = 0;
        break;
      case 'throw':
      case 'celebrate':
        lArm = rArm = -2.85; armSpread = 0.35;
        if (p.pose === 'celebrate') body.position.y += Math.abs(Math.sin(now / 160 + ph)) * 6;
        break;
      case 'stun':
        body.rotation.z = Math.sin(now / 60) * 0.15;
        break;
      default:
        break;
    }
    // A keeper holding the ball cradles it.
    if (match && match.ball.owner === p && match.ball.hands && p.pose !== 'throw') { lArm = rArm = -1.3; armSpread = 0.15; }
    legs[0].rotation.x = lLeg; legs[1].rotation.x = rLeg;
    arms[0].rotation.set(lArm, 0, armSpread);
    arms[1].rotation.set(rArm, 0, -armSpread);
  }

  // ---------------------------------------------------------------- camera

  function updateCamera(m, snap) {
    let tx = m.ball.x;
    const h = m.human;
    const goal = m.phase === 'goal';
    // Lean toward you in open play; frame the net when a goal goes in.
    if (h && h.kind === 'player' && !goal) tx = tx * 0.72 + h.x * 0.28;
    if (h && h.kind === 'ballboy' && m.phase === 'out') tx = h.x;
    const margin = goal ? 150 : CAM.margin;
    tx = Math.max(margin, Math.min(PW - margin, tx));
    cam.x = snap ? tx : cam.x + (tx - cam.x) * (goal ? 0.12 : 0.06);
    // Dolly in and out a little with the play's depth across the pitch.
    const ty = Math.max(60, Math.min(PH - 60, m.ball.y));
    cam.y = snap ? ty : cam.y + (ty - cam.y) * 0.04;
    const fx = SK.render.fx;
    let sx = 0, sy = 0;
    if (fx.shake > 0) { sx = (Math.random() - 0.5) * fx.shake * 0.5; sy = (Math.random() - 0.5) * fx.shake * 0.5; }
    if (camera.fov !== CAM.fov) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); }
    const dy = (cam.y - MIDY) * 0.45;
    camera.position.copy(v3(cam.x + sx, PH + CAM.back + dy, CAM.height + sy));
    camera.lookAt(v3(cam.x, CAM.lookY + dy, 0));
  }

  // ---------------------------------------------------------------- set-up

  R3.init = function (cv) {
    canvas = cv;
    // Check for WebGL quietly first; three.js logs errors when it's missing.
    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return false;
    } catch (_) { return false; }
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('3D unavailable, using the 2D view:', e.message);
      return false;
    }
    if (!renderer.getContext()) return false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    scene = new T.Scene();
    scene.background = new T.Color(0x040817);
    scene.fog = new T.Fog(0x0a1230, 1500, 3400);
    camera = new T.PerspectiveCamera(34, 16 / 9, 10, 6000);

    scene.add(new T.HemisphereLight(0xd8e6ff, 0x24521f, 0.58));
    const sun = new T.DirectionalLight(0xfff6e0, 0.62);
    sun.position.copy(v3(PW / 2 - 260, -520, 900));
    sun.target.position.copy(v3(PW / 2, MIDY, 0));
    sun.castShadow = true;
    const sz = MOBILE ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    Object.assign(sun.shadow.camera, { left: -720, right: 720, top: 520, bottom: -520, near: 100, far: 2600 });
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    // Fill from the camera side, so faces turned toward us aren't in shadow.
    const fill = new T.DirectionalLight(0xfff1dc, 0.45);
    fill.position.copy(v3(PW / 2 + 200, PH + 900, 600));
    scene.add(fill);

    buildPitch();
    buildStadium();
    buildGoals();
    buildBall();
    R3.available = true;
    R3.resize();
    return true;
  };

  R3.resize = function () {
    if (!renderer) return;
    const ref = document.getElementById('pitch');
    const w = parseFloat(ref.style.width) || window.innerWidth, h = parseFloat(ref.style.height) || window.innerHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  // Projector for the 2D overlay: sim coords -> overlay logical pixels.
  const tmp = new T.Vector3();
  R3.project = function (x, y, z = 0) {
    tmp.copy(v3(x, y, z));
    const camSpace = tmp.clone().applyMatrix4(camera.matrixWorldInverse);
    tmp.project(camera);
    const W = SK.render.W, H = 720;
    const depth = Math.max(1, -camSpace.z);
    const focal = (H / 2) / Math.tan((camera.fov * Math.PI) / 360);
    return { x: (tmp.x + 1) * 0.5 * W, y: (1 - tmp.y) * 0.5 * H, s: focal / depth };
  };

  const mtx = new T.Matrix4();
  R3.camState = cam;
  R3.info = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures });
  R3.draw = function (m) {
    const now = performance.now();
    if (m && m !== match) { match = m; buildModels(m); updateCamera(m, true); }
    if (!m) return;
    updateCamera(m, false);
    for (const md of models) pose(md, now);

    // Ball: position, plus its rolling orientation converted from sim axes.
    const b = m.ball, s = b.spin;
    // sim (x, y, z) -> three (x, z, y): swap the y and z rows and columns.
    mtx.set(
      s[0], s[2], s[1], 0,
      s[6], s[8], s[7], 0,
      s[3], s[5], s[4], 0,
      0, 0, 0, 1);
    const p = v3(b.x, b.y, b.z + C.BALL_R * 1.15);
    mtx.setPosition(p);
    ballMesh.matrix.copy(mtx);

    // The crowd bobs, and jumps for goals.
    const hype = SK.render.fx.hype || 0;
    for (const row of crowdRows) row.mesh.position.y = row.base + Math.max(0, Math.sin(now / (hype > 0 ? 120 : 420) + row.phase)) * (1 + hype * 5);
    renderer.render(scene, camera);
  };
})();
