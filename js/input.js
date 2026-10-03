/*
 * Keyboard and touch input, boiled down to one stick and three buttons.
 *
 *   Move    WASD / arrows        left-thumb joystick
 *   Shoot   Space (hold = power)  SHOOT (THROW for the ball boy)
 *   Pass    E                    PASS
 *   Tackle  Q (SAVE for keepers)  TACKLE / SAVE
 *
 * Presses are queued as edges so a tap between two ticks is never lost.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const I = (SK.input = {});

  const keys = new Set();
  const edges = { shootDown: false, shootUp: false, pass: false, tackle: false };
  const stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
  let shootHeld = false;
  I.enabled = false;

  const MOVE = {
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
  };

  function shootPress() { if (!shootHeld) { shootHeld = true; edges.shootDown = true; } }
  function shootRelease() { if (shootHeld) { shootHeld = false; edges.shootUp = true; } }

  window.addEventListener('keydown', (e) => {
    if (!I.enabled) return;
    if (MOVE[e.code] || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') shootPress();
    if (e.code === 'KeyE') edges.pass = true;
    if (e.code === 'KeyQ') edges.tackle = true;
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') shootRelease();
  });

  I.poll = function () {
    let mx = 0, my = 0;
    for (const k of keys) if (MOVE[k]) { mx += MOVE[k][0]; my += MOVE[k][1]; }
    const kl = Math.hypot(mx, my);
    if (kl > 0) { mx /= kl; my /= kl; }
    if (stick.id !== null) { mx = stick.x; my = stick.y; }
    const out = { mx, my, shootHeld, ...edges };
    edges.shootDown = edges.shootUp = edges.pass = edges.tackle = false;
    return out;
  };

  I.reset = function () {
    keys.clear();
    shootHeld = false;
    edges.shootDown = edges.shootUp = edges.pass = edges.tackle = false;
    stick.id = null; stick.x = stick.y = 0;
    const knob = document.getElementById('stickKnob');
    const base = document.getElementById('stickBase');
    if (knob) knob.style.transform = '';
    if (base) base.classList.remove('active');
  };

  // Losing focus must not leave a key stuck down.
  window.addEventListener('blur', () => { keys.clear(); shootRelease(); });

  // ---------------------------------------------------------------- touch

  I.bindTouch = function () {
    const zone = document.getElementById('stickZone');
    const base = document.getElementById('stickBase');
    const knob = document.getElementById('stickKnob');
    const R = 52;

    zone.addEventListener('pointerdown', (e) => {
      if (stick.id !== null) return;
      e.preventDefault();
      zone.setPointerCapture?.(e.pointerId);
      stick.id = e.pointerId;
      stick.ox = e.clientX;
      stick.oy = e.clientY;
      const r = zone.getBoundingClientRect();
      base.style.left = e.clientX - r.left + 'px';
      base.style.top = e.clientY - r.top + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stick.id) return;
      let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      // Small dead zone, then full speed quickly: kids push the stick hard.
      const mag = Math.min(1, l / R);
      const k = mag < 0.15 ? 0 : Math.min(1, (mag - 0.15) / 0.6);
      const dl = Math.hypot(dx, dy) || 1;
      stick.x = (dx / dl) * k;
      stick.y = (dy / dl) * k;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e) => {
      if (e.pointerId !== stick.id) return;
      stick.id = null;
      stick.x = stick.y = 0;
      base.classList.remove('active');
      knob.style.transform = 'translate(-50%, -50%)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const bind = (id, down, up) => {
      const b = document.getElementById(id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('down'); down(); });
      const rel = (e) => { e.preventDefault(); b.classList.remove('down'); up && up(); };
      b.addEventListener('pointerup', rel);
      b.addEventListener('pointercancel', rel);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bind('btnShoot', shootPress, shootRelease);
    bind('btnPass', () => { edges.pass = true; });
    bind('btnTackle', () => { edges.tackle = true; });
  };
})();
