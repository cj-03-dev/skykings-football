/*
 * All the drawing that isn't the pitch: the kids, the ball and the club crests.
 * Everything is canvas paths or inline SVG, so the game ships no image files.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const art = (SK.art = {});
  const TAU = Math.PI * 2;
  const OUTLINE = 'rgba(18,16,28,0.82)';

  // Polyfill for older Safari, which lacks roundRect.
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rad = Math.max(0, Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + rad, y);
      this.arcTo(x + w, y, x + w, y + h, rad);
      this.arcTo(x + w, y + h, x, y + h, rad);
      this.arcTo(x, y + h, x, y, rad);
      this.arcTo(x, y, x + w, y, rad);
      this.closePath();
      return this;
    };
  }

  function shade(hex, amt) {
    // amt < 0 darkens, > 0 lightens; works on #rrggbb.
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  art.shade = shade;

  // ------------------------------------------------------------------ kids
  //
  // drawKid paints one kid with the feet at (0, 0) and the body growing up the
  // negative y axis; the caller translates and scales. An average kid is about
  // 44 units tall, and `height` stretches legs and torso so the tall boys tower
  // over Reyansh and Ibrahim.
  //
  // o.facing: 'down' (toward camera) | 'up' (away) | 'side' (o.flip = facing left)
  // o.pose:   'idle' | 'run' | 'kick' | 'tackle' | 'dive' | 'down' | 'throw' | 'celebrate' | 'stun'

  art.drawKid = function (ctx, kid, kit, o = {}) {
    const h = kid.height, b = kid.build;
    const g = {
      h, b,
      legH: 12 * h,
      torsoH: 14 * h,
      torsoW: 14.5 * b,
      armW: b > 1.1 ? 4.6 : 3.5,
      armL: 12.5 * h,
      headR: 8.4 * (0.94 + 0.06 * h),
    };
    g.hipY = -g.legH;
    g.shoulderY = g.hipY - g.torsoH;
    g.headY = g.shoulderY - 2 - g.headR * 0.86;

    const pose = o.pose || 'idle';
    const run = o.run || 0;
    const phase = o.phase || 0;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (pose === 'tackle') {
      ctx.translate(0, -2);
      ctx.scale(o.flip ? -1 : 1, 1);
      ctx.rotate(-0.95);
      sideBody(ctx, kid, kit, g, { front: -0.55, back: 0.35, armNear: -1.6, armFar: 0.9 }, o);
    } else if (pose === 'dive') {
      // Rotate about the hips toward the dive; arms stretch past the head.
      const dir = o.diveDir || 1;
      ctx.translate(0, g.hipY * 0.6);
      ctx.rotate(dir * 1.2);
      ctx.translate(0, -g.hipY * 0.6);
      frontBody(ctx, kid, kit, g, { armsUp: 1, legSpread: 0.25 }, o);
    } else if (pose === 'down') {
      const dir = o.diveDir || 1;
      ctx.translate(0, -3);
      ctx.rotate(dir * 1.5);
      ctx.translate(0, g.hipY * 0.2);
      frontBody(ctx, kid, kit, g, { armsUp: 0.7, legSpread: 0.1 }, o);
    } else if (pose === 'kick') {
      ctx.scale(o.flip ? -1 : 1, 1);
      const t = o.poseT || 0;               // 0..1 through the swing
      const swing = t < 0.35 ? 0.7 * (t / 0.35) : 0.7 - 2.0 * Math.min(1, (t - 0.35) / 0.3);
      sideBody(ctx, kid, kit, g, { front: swing, back: 0.12, armNear: -0.9, armFar: 0.7 }, o);
    } else if (o.facing === 'side') {
      ctx.scale(o.flip ? -1 : 1, 1);
      if (pose === 'stun') ctx.rotate(Math.sin(phase * 3) * 0.12);
      const a = run * 0.62 * Math.sin(phase);
      const armsUp = pose === 'celebrate' || pose === 'throw';
      sideBody(ctx, kid, kit, g, {
        front: -a, back: a,
        armNear: armsUp ? -2.7 : a * 0.95,
        armFar: armsUp ? -2.5 : -a * 0.95,
        lean: run * 0.08,
      }, o);
    } else {
      if (pose === 'stun') ctx.rotate(Math.sin(phase * 3) * 0.12);
      const armsUp = pose === 'celebrate' ? 1 : pose === 'throw' ? 0.95 : 0;
      frontBody(ctx, kid, kit, g, { run, phase, armsUp }, o);
    }
    ctx.restore();
  };

  // Front and back views share one skeleton; only the face/hair/number differ.
  function frontBody(ctx, kid, kit, g, p, o) {
    const back = o.facing === 'up';
    const run = p.run || 0, phase = p.phase || 0;
    const spread = p.legSpread || 0;

    // Legs: alternate foot lifts while running.
    for (const side of [-1, 1]) {
      const lift = run * Math.max(0, Math.sin(phase + (side > 0 ? Math.PI : 0))) * 3.2;
      const lx = side * (3.3 + spread * 6) * (0.92 + 0.08 * g.b);
      legStraight(ctx, kid, kit, g, lx, lift, side * spread);
    }

    // Shorts.
    ctx.fillStyle = kit.shorts;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-g.torsoW / 2 + 0.6, g.hipY - 2.5, g.torsoW - 1.2, 7.5, 2.5);
    ctx.fill(); ctx.stroke();

    // Arms behind the torso when raised, beside it otherwise.
    const armX = g.torsoW / 2 + g.armW / 2 - 0.8;
    const armSwing = (side) => run * 0.18 * Math.sin(phase + (side > 0 ? 0 : Math.PI));
    const drawArms = () => {
      for (const side of [-1, 1]) {
        let ang;
        if (p.armsUp) ang = side * (Math.PI - 0.38 * p.armsUp);    // overhead, slightly out
        else ang = side * 0.12 + armSwing(side) * side;
        arm(ctx, kid, kit, g, side * armX, g.shoulderY + 2, ang);
      }
    };
    if (p.armsUp) drawArms();

    // Torso.
    torso(ctx, kit, g, -g.torsoW / 2, g.torsoW, back, o.number);
    if (!p.armsUp) drawArms();

    // Neck and head.
    ctx.fillStyle = shade(kid.skin, -0.12);
    ctx.fillRect(-2.6, g.shoulderY - 3.5, 5.2, 4.5);
    head(ctx, kid, g, back ? 'up' : 'down');
  }

  function sideBody(ctx, kid, kit, g, p, o) {
    const lean = p.lean || 0;
    // Far limbs first, darker.
    const hip = { x: 0, y: g.hipY + 2 };
    legAngled(ctx, kid, kit, g, hip, p.back, true);
    arm(ctx, kid, kit, g, 0.5, g.shoulderY + 2, p.armFar, true);
    legAngled(ctx, kid, kit, g, hip, p.front, false);

    ctx.save();
    ctx.translate(0, g.hipY);
    ctx.rotate(lean);
    ctx.translate(0, -g.hipY);
    const w = g.torsoW * 0.66;
    ctx.fillStyle = kit.shorts;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-w / 2, g.hipY - 2.5, w, 7, 2.5); ctx.fill(); ctx.stroke();
    torso(ctx, kit, g, -w / 2, w, false, null, true);
    ctx.fillStyle = shade(kid.skin, -0.12);
    ctx.fillRect(-2, g.shoulderY - 3.5, 4.4, 4.5);
    head(ctx, kid, g, 'side');
    arm(ctx, kid, kit, g, 0, g.shoulderY + 2, p.armNear, false);
    ctx.restore();
  }

  function legStraight(ctx, kid, kit, g, x, lift, tilt) {
    ctx.save();
    ctx.translate(x, g.hipY + 2);
    if (tilt) ctx.rotate(-tilt);
    const L = g.legH - 2 - lift;
    const w = 4.3 * (0.94 + 0.06 * g.b);
    ctx.fillStyle = kid.skin;
    ctx.fillRect(-w / 2, 0, w, L * 0.5);
    ctx.fillStyle = kit.socks;
    ctx.fillRect(-w / 2, L * 0.5, w, L * 0.5 - 1.6);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.8;
    ctx.strokeRect(-w / 2, 0, w, L - 1.6);
    ctx.fillStyle = '#16161c';
    ctx.beginPath(); ctx.roundRect(-w / 2 - 0.7, L - 2.6, w + 1.4, 3.4, 1.4); ctx.fill();
    ctx.restore();
  }

  function legAngled(ctx, kid, kit, g, hip, ang, far) {
    ctx.save();
    ctx.translate(hip.x, hip.y);
    ctx.rotate(ang);
    const L = g.legH - 1;
    const w = 4.4 * (0.94 + 0.06 * g.b);
    ctx.fillStyle = far ? shade(kid.skin, -0.18) : kid.skin;
    ctx.fillRect(-w / 2, 0, w, L * 0.52);
    ctx.fillStyle = far ? shade(kit.socks, -0.18) : kit.socks;
    ctx.fillRect(-w / 2, L * 0.52, w, L * 0.48 - 1.8);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.8;
    ctx.strokeRect(-w / 2, 0, w, L - 1.8);
    ctx.fillStyle = far ? '#0c0c10' : '#17171d';
    ctx.beginPath(); ctx.roundRect(-w / 2 - 0.6, L - 2.8, w + 4.2, 3.6, 1.6); ctx.fill();
    ctx.restore();
  }

  function arm(ctx, kid, kit, g, x, y, ang, far) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const w = g.armW, L = g.armL;
    ctx.fillStyle = far ? shade(kit.shirt, -0.2) : kit.shirt;
    ctx.beginPath(); ctx.roundRect(-w / 2 - 0.4, -1.2, w + 0.8, 5.6, 2); ctx.fill();
    ctx.fillStyle = kit.sleeve || kit.trim;
    ctx.fillRect(-w / 2 - 0.4, 3.4, w + 0.8, 1.1);
    ctx.fillStyle = far ? shade(kid.skin, -0.18) : kid.skin;
    ctx.beginPath(); ctx.roundRect(-w / 2, 4.4, w, L - 5.4, w / 2); ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.roundRect(-w / 2, -1, w, L, w / 2); ctx.stroke();
    ctx.restore();
  }

  function torso(ctx, kit, g, x, w, back, number, side) {
    const y = g.shoulderY, hgt = g.torsoH + 1.5;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, hgt, 4);
    ctx.fillStyle = kit.shirt;
    ctx.fill();
    ctx.clip();
    if (kit.stripe) {
      ctx.fillStyle = kit.stripe;
      const n = side ? 3 : 5, sw = w / n;
      for (let i = 1; i < n; i += 2) ctx.fillRect(x + i * sw, y, sw, hgt);
    }
    if (kit.bib) {
      // Ball boy bib over a dark top.
      ctx.fillStyle = '#1c2541';
      ctx.fillRect(x, y, w, hgt);
      ctx.fillStyle = kit.shirt;
      ctx.fillRect(x + 1.6, y + 1.8, w - 3.2, hgt - 3);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(3, w * 0.22)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (!side) ctx.fillText('BALL', x + w / 2, y + hgt * 0.38), ctx.fillText('BOY', x + w / 2, y + hgt * 0.68);
    }
    // Soft vertical shading for some volume.
    const grd = ctx.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.18)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.07)');
    grd.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w, hgt);
    ctx.restore();

    // Collar.
    ctx.strokeStyle = kit.trim;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (back || side) ctx.moveTo(x + w / 2 - 3, y + 0.8), ctx.lineTo(x + w / 2 + 3, y + 0.8);
    else ctx.moveTo(x + w / 2 - 3.2, y + 0.6), ctx.lineTo(x + w / 2, y + 3.6), ctx.lineTo(x + w / 2 + 3.2, y + 0.6);
    ctx.stroke();

    if (back && number && !kit.bib) {
      ctx.font = `900 ${Math.round(g.torsoH * 0.62)}px "Russo One", "Arial Black", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(number, x + w / 2, y + hgt * 0.52);
      ctx.fillStyle = kit.number;
      ctx.fillText(number, x + w / 2, y + hgt * 0.52);
    } else if (!back && !side && !kit.bib) {
      // Small crest dot on the chest.
      ctx.fillStyle = kit.trim;
      ctx.beginPath(); ctx.arc(x + w * 0.28, y + 4.6, 1.3, 0, TAU); ctx.fill();
    }

    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, hgt, 4); ctx.stroke();
  }

  function head(ctx, kid, g, view) {
    const R = g.headR, cy = g.headY;
    const side = view === 'side';
    const cx = side ? 0.8 : 0;

    // Ears.
    ctx.fillStyle = shade(kid.skin, -0.08);
    if (side) {
      ctx.beginPath(); ctx.ellipse(cx - 1.4, cy + 1, 1.8, 2.4, 0, 0, TAU); ctx.fill();
    } else {
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * R * 0.95, cy + 1, 1.9, 2.5, 0, 0, TAU); ctx.fill(); }
    }

    // Face.
    ctx.fillStyle = kid.skin;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (side) ctx.ellipse(cx, cy, R * 0.94, R, 0, 0, TAU);
    else ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill(); ctx.stroke();
    if (side) {
      // Nose bump.
      ctx.beginPath(); ctx.ellipse(cx + R * 0.9, cy + 1.6, 1.6, 1.5, 0, 0, TAU); ctx.fill();
    }

    hair(ctx, kid, g, view, cx);

    if (view !== 'up') face(ctx, kid, g, view, cx);
    if (kid.crown) crown(ctx, cx, cy - R * 0.78, side ? 11 : 13.5);
  }

  function face(ctx, kid, g, view, cx) {
    const R = g.headR, cy = g.headY;
    const ink = '#21160f';
    if (view === 'side') {
      if (kid.sunglasses) {
        ctx.fillStyle = '#0e0e12';
        ctx.beginPath(); ctx.roundRect(cx + R * 0.32, cy - 1.2, 4.6, 3.2, 1.2); ctx.fill();
        ctx.strokeStyle = '#0e0e12'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(cx + R * 0.32, cy - 0.4); ctx.lineTo(cx - 1, cy); ctx.stroke();
      } else {
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.ellipse(cx + R * 0.52, cy + 0.2, 1.1, 1.35, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(cx + R * 0.32, cy - 2.4); ctx.lineTo(cx + R * 0.78, cy - 2.2); ctx.stroke();
      }
      ctx.strokeStyle = shade(kid.skin, -0.45); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(cx + R * 0.48, cy + 4.6); ctx.lineTo(cx + R * 0.74, cy + 4.3); ctx.stroke();
      return;
    }
    if (kid.sunglasses) {
      ctx.fillStyle = '#0d0d12';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.roundRect(cx + s * 3.4 - 2.8, cy - 1.1, 5.6, 3.6, 1.4); ctx.fill(); }
      ctx.strokeStyle = '#0d0d12'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 0.8, cy - 0.2); ctx.lineTo(cx + 0.8, cy - 0.2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const s of [-1, 1]) ctx.fillRect(cx + s * 3.4 - 1.8, cy - 0.5, 1.4, 0.8);
    } else {
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx + s * 3.1, cy + 0.6, 1.7, 1.9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.ellipse(cx + s * 3.1, cy + 0.9, 1.1, 1.35, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx + s * 3.1 - 0.2, cy + 0.2, 0.6, 0.6);
      }
      ctx.strokeStyle = shade(kid.hairColor, 0.05); ctx.lineWidth = 0.9;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + s * 1.6, cy - 2.2); ctx.lineTo(cx + s * 4.6, cy - 2.6); ctx.stroke();
      }
    }
    // Cheeks and smile.
    ctx.fillStyle = 'rgba(232,110,110,0.18)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * 5, cy + 3.6, 1.6, 1, 0, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = shade(kid.skin, -0.5); ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(cx, cy + 3.4, 2.2, 0.2, Math.PI - 0.2); ctx.stroke();
  }

  function hair(ctx, kid, g, view, cx) {
    const R = g.headR, cy = g.headY;
    const col = kid.hairColor;
    ctx.fillStyle = col;
    ctx.strokeStyle = shade(col, -0.35);
    ctx.lineWidth = 0.8;
    const style = kid.hair;

    if (view === 'up') {
      // Back of the head: hair covers all but the nape.
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.03, Math.PI * 0.86, Math.PI * 2.14);
      ctx.closePath();
      ctx.fill();
      if (style === 'curly') bumps(ctx, cx, cy, R, 9, Math.PI * 0.9, Math.PI * 2.1, 1.9);
      if (style === 'spiky') spikes(ctx, cx, cy, R, 7, Math.PI * 1.05, Math.PI * 1.95);
      return;
    }

    if (view === 'side') {
      ctx.beginPath();
      ctx.moveTo(cx + R * 0.7, cy - R * 0.5);
      ctx.quadraticCurveTo(cx + R * 0.3, cy - R * 1.22, cx - R * 0.5, cy - R * 0.95);
      ctx.quadraticCurveTo(cx - R * 1.2, cy - R * 0.4, cx - R * 0.92, cy + R * 0.45);
      ctx.lineTo(cx - R * 0.35, cy + R * 0.2);
      ctx.quadraticCurveTo(cx - R * 0.1, cy - R * 0.45, cx + R * 0.7, cy - R * 0.5);
      ctx.fill();
      if (style === 'curly') bumps(ctx, cx - 0.5, cy, R, 6, Math.PI * 1.0, Math.PI * 1.85, 1.8);
      if (style === 'spiky') spikes(ctx, cx - 0.5, cy, R, 5, Math.PI * 1.05, Math.PI * 1.85);
      if (style === 'swoosh') {
        ctx.beginPath();
        ctx.moveTo(cx + R * 0.95, cy - R * 0.55);
        ctx.quadraticCurveTo(cx + R * 0.4, cy - R * 1.25, cx - R * 0.2, cy - R * 1.0);
        ctx.lineTo(cx + R * 0.5, cy - R * 0.55);
        ctx.fill();
      }
      return;
    }

    // Front view: a cap of hair over the forehead, styled per kid.
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.02, Math.PI * 1.02, Math.PI * 1.98);
    switch (style) {
      case 'fade':
        ctx.lineTo(cx + R * 0.8, cy - R * 0.55);
        ctx.lineTo(cx - R * 0.8, cy - R * 0.55);
        break;
      case 'side':
        ctx.quadraticCurveTo(cx + R * 0.6, cy - R * 0.25, cx - R * 0.15, cy - R * 0.5);
        ctx.quadraticCurveTo(cx - R * 0.6, cy - R * 0.3, cx - R * 0.98, cy - R * 0.05);
        break;
      case 'swoosh':
        ctx.quadraticCurveTo(cx + R * 0.7, cy - R * 0.2, cx + R * 0.2, cy - R * 0.38);
        ctx.quadraticCurveTo(cx - R * 0.5, cy - R * 0.62, cx - R * 0.98, cy - R * 0.1);
        break;
      default:
        ctx.quadraticCurveTo(cx, cy - R * 0.32, cx - R * 0.98, cy - R * 0.1);
    }
    ctx.closePath();
    ctx.fill();
    if (style === 'curly') bumps(ctx, cx, cy, R, 9, Math.PI * 1.0, Math.PI * 2.0, 2.1);
    if (style === 'spiky') spikes(ctx, cx, cy, R, 7, Math.PI * 1.08, Math.PI * 1.92);
    if (style === 'fade') {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * R * 0.86, cy - R * 0.2, 1.6, 3, 0, 0, TAU); ctx.fill(); }
    }
  }

  function bumps(ctx, cx, cy, R, n, a0, a1, r) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98, r, 0, TAU); ctx.fill();
    }
  }

  function spikes(ctx, cx, cy, R, n, a0, a1) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      const x0 = cx + Math.cos(a - 0.12) * R * 0.92, y0 = cy + Math.sin(a - 0.12) * R * 0.92;
      const x1 = cx + Math.cos(a) * R * 1.32, y1 = cy + Math.sin(a) * R * 1.32;
      const x2 = cx + Math.cos(a + 0.12) * R * 0.92, y2 = cy + Math.sin(a + 0.12) * R * 0.92;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.fill();
  }

  // Shaurya's golden crown.
  function crown(ctx, cx, baseY, w) {
    const hgt = w * 0.62;
    const grd = ctx.createLinearGradient(0, baseY - hgt, 0, baseY + 2);
    grd.addColorStop(0, '#fff3a3');
    grd.addColorStop(0.45, '#ffcc33');
    grd.addColorStop(1, '#b07a0c');
    ctx.fillStyle = grd;
    ctx.strokeStyle = '#6e4a05';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, baseY + 1.5);
    ctx.lineTo(cx - w / 2, baseY - hgt * 0.75);
    ctx.lineTo(cx - w / 4, baseY - hgt * 0.32);
    ctx.lineTo(cx, baseY - hgt);
    ctx.lineTo(cx + w / 4, baseY - hgt * 0.32);
    ctx.lineTo(cx + w / 2, baseY - hgt * 0.75);
    ctx.lineTo(cx + w / 2, baseY + 1.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Tip pearls and jewels on the band.
    ctx.fillStyle = '#fff6cf';
    for (const [x, y] of [[cx - w / 2, baseY - hgt * 0.75], [cx, baseY - hgt], [cx + w / 2, baseY - hgt * 0.75]]) {
      ctx.beginPath(); ctx.arc(x, y, 1.1, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#e0233a';
    ctx.beginPath(); ctx.arc(cx, baseY - 1.2, 1.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a6be0';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * w * 0.3, baseY - 1, 1, 0, TAU); ctx.fill(); }
  }

  // ------------------------------------------------------------------ ball
  //
  // The ball keeps a real 3D orientation: rolling turns it about the axis
  // perpendicular to travel, and the twelve black pentagons are the vertices
  // of an icosahedron projected through that orientation.

  const PHI = (1 + Math.sqrt(5)) / 2;
  const ICO = [];
  for (const [a, b] of [[1, PHI], [-1, PHI], [1, -PHI], [-1, -PHI]]) {
    ICO.push([0, a, b], [a, b, 0], [b, 0, a]);
  }
  for (const v of ICO) { const l = Math.hypot(v[0], v[1], v[2]); v[0] /= l; v[1] /= l; v[2] /= l; }
  art.ICO = ICO;

  art.newSpin = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // Rotate orientation matrix m (row-major 3x3) by `angle` about unit axis (ax, ay, az).
  art.spin = function (m, ax, ay, az, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const r = [
      t * ax * ax + c,      t * ax * ay - s * az, t * ax * az + s * ay,
      t * ax * ay + s * az, t * ay * ay + c,      t * ay * az - s * ax,
      t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
    ];
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
    }
    // Gram-Schmidt every call is cheap and stops drift.
    const n0 = Math.hypot(o[0], o[1], o[2]);
    o[0] /= n0; o[1] /= n0; o[2] /= n0;
    const d = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
    o[3] -= d * o[0]; o[4] -= d * o[1]; o[5] -= d * o[2];
    const n1 = Math.hypot(o[3], o[4], o[5]);
    o[3] /= n1; o[4] /= n1; o[5] /= n1;
    o[6] = o[1] * o[5] - o[2] * o[4];
    o[7] = o[2] * o[3] - o[0] * o[5];
    o[8] = o[0] * o[4] - o[1] * o[3];
    for (let i = 0; i < 9; i++) m[i] = o[i];
    return m;
  };

  const TILT = 0.95; // camera tilt used to view the ball's hemisphere
  art.drawBall = function (ctx, x, y, r, m) {
    const grd = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.7, '#e9edf2');
    grd.addColorStop(1, '#a9b3c0');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();

    const ct = Math.cos(TILT), st = Math.sin(TILT);
    ctx.fillStyle = '#16171d';
    for (const v of ICO) {
      const wx = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
      const wy = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
      const wz = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
      const depth = wy * st + wz * ct;
      if (depth < 0.05) continue;
      const sx = wx, sy = wy * ct - wz * st;
      const px = x + sx * r * 0.86, py = y + sy * r * 0.86;
      const ang = Math.atan2(sy, sx);
      const a = r * 0.34;
      ctx.beginPath();
      ctx.ellipse(px, py, Math.max(0.2, a * depth), a, ang, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(20,24,32,0.75)';
    ctx.lineWidth = Math.max(0.6, r * 0.12);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  };

  // ---------------------------------------------------------------- crests
  //
  // Drawn in the clubs' colours and layout (crown, ringed monogram and band;
  // quartered shield with lettered band and striped base) as stylised
  // stand-ins rather than traced logos.

  const RMA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 124">
  <defs>
    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbeaa0"/><stop offset=".5" stop-color="#d9b23c"/><stop offset="1" stop-color="#9c7716"/></linearGradient>
    <clipPath id="rc"><circle cx="50" cy="83" r="33"/></clipPath>
  </defs>
  <path d="M25 40 C25 18 75 18 75 40 Z" fill="#b8122f" stroke="#6b5310" stroke-width="1"/>
  <g fill="none" stroke="url(#rg)" stroke-width="2.6" stroke-linecap="round">
    <path d="M26 40 C27 24 44 16 50 15"/><path d="M74 40 C73 24 56 16 50 15"/>
    <path d="M37 40 C38 27 46 20 50 17"/><path d="M63 40 C62 27 54 20 50 17"/><path d="M50 15 L50 40"/>
  </g>
  <circle cx="50" cy="11" r="3.6" fill="url(#rg)" stroke="#6b5310" stroke-width=".8"/>
  <path d="M50 1.5 V8 M47 4.3 H53" stroke="url(#rg)" stroke-width="2.2" stroke-linecap="round"/>
  <rect x="21" y="38" width="58" height="10" rx="2.5" fill="url(#rg)" stroke="#6b5310" stroke-width="1"/>
  <circle cx="31" cy="43" r="2.1" fill="#c8102e"/><circle cx="40.5" cy="43" r="2.1" fill="#1f5fbf"/><circle cx="50" cy="43" r="2.4" fill="#1a8c4e"/><circle cx="59.5" cy="43" r="2.1" fill="#1f5fbf"/><circle cx="69" cy="43" r="2.1" fill="#c8102e"/>
  <circle cx="50" cy="83" r="35" fill="url(#rg)" stroke="#6b5310" stroke-width="1"/>
  <circle cx="50" cy="83" r="31.5" fill="#ffffff"/>
  <g clip-path="url(#rc)"><polygon points="16,54 28,47 88,110 76,119" fill="#3b2a7a"/></g>
  <circle cx="50" cy="83" r="31.5" fill="none" stroke="#6b5310" stroke-width=".8"/>
  <text x="50" y="94" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="29" letter-spacing="-4.5" fill="url(#rg)" stroke="#5c460c" stroke-width=".9">MCF</text>
</svg>`;

  const FCB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 124">
  <defs>
    <path id="fs" d="M10 8 Q30 22 50 10 Q70 22 90 8 C95 40 94 72 76 98 C67 110 58 116 50 120 C42 116 33 110 24 98 C6 72 5 40 10 8 Z"/>
    <clipPath id="fc"><use href="#fs"/></clipPath>
  </defs>
  <g clip-path="url(#fc)">
    <rect x="0" y="0" width="50" height="48" fill="#ffffff"/>
    <rect x="26" y="0" width="8" height="48" fill="#d81e2c"/><rect x="0" y="25" width="50" height="8" fill="#d81e2c"/>
    <rect x="50" y="0" width="50" height="48" fill="#fcd116"/>
    <rect x="54.4" y="0" width="4.45" height="48" fill="#d81e2c"/><rect x="63.3" y="0" width="4.45" height="48" fill="#d81e2c"/>
    <rect x="72.2" y="0" width="4.45" height="48" fill="#d81e2c"/><rect x="81.1" y="0" width="4.45" height="48" fill="#d81e2c"/>
    <rect x="0" y="60" width="100" height="64" fill="#004d98"/>
    <rect x="26" y="60" width="16" height="64" fill="#a50044"/><rect x="58" y="60" width="16" height="64" fill="#a50044"/>
    <rect x="0" y="47" width="100" height="13" fill="#ffffff" stroke="#d6a51a" stroke-width="2"/>
    <line x1="50" y1="0" x2="50" y2="48" stroke="#d6a51a" stroke-width="2"/>
  </g>
  <text x="50" y="58.2" text-anchor="middle" font-family="'Arial Black', 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="12" letter-spacing="1.5" fill="#141414">FCB</text>
  <circle cx="50" cy="88" r="9.5" fill="#fcd116" stroke="#7a5a00" stroke-width="1"/>
  <path d="M43 84 Q50 88 57 84 M44 93 Q50 89 56 93 M50 78.6 V97.4" stroke="#7a5a00" stroke-width=".9" fill="none"/>
  <use href="#fs" fill="none" stroke="#d6a51a" stroke-width="4"/>
  <use href="#fs" fill="none" stroke="#1a1a1a" stroke-width="1.2"/>
</svg>`;

  art.badgeSVG = (id) => (id === 'rma' ? RMA_SVG : FCB_SVG);
  const badgeCache = {};
  art.badgeImg = (id) => {
    if (!badgeCache[id]) {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art.badgeSVG(id));
      badgeCache[id] = img;
    }
    return badgeCache[id];
  };

  // Paints a kid as a card portrait: centered, feet on a soft spotlight.
  art.portrait = function (canvas, kid, kit, opts = {}) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || canvas.width, cssH = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const s = (cssH * 0.84) / 56;   // same scale for everyone, so heights compare
    const footY = cssH * 0.9;
    const glow = ctx.createRadialGradient(cssW / 2, footY, 2, cssW / 2, footY, cssW * 0.45);
    glow.addColorStop(0, 'rgba(255,255,255,0.28)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cssW / 2, footY, 13 * s * kid.build, 3.4 * s, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(cssW / 2, footY);
    ctx.scale(s, s);
    art.drawKid(ctx, kid, kit, { facing: opts.facing || 'down', pose: opts.pose || 'idle', number: opts.number });
    ctx.restore();
  };
})();
