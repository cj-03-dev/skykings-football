/*
 * The game loop and the glue between menus, match, renderer and input.
 * Simulation runs on a fixed 60Hz step; rendering runs at display rate.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const $ = (id) => document.getElementById(id);
  const NO_INPUT = { mx: 0, my: 0, shootHeld: false, shootDown: false, shootUp: false, pass: false, tackle: false };

  const game = (SK.game = { mode: 'menu', match: null, demo: null, paused: false, cfg: null, touch: SK.ui.isTouch });

  SK.render.init($('pitch'));
  // Real 3D when WebGL is available; the 2.5D canvas renderer otherwise.
  game.use3d = !!(SK.render3d && SK.render3d.init && SK.render3d.init($('pitch3d')));
  if (game.use3d) SK.render.setProjector(SK.render3d.project);
  else $('pitch3d').hidden = true;

  // Sound needs a user gesture before it may start: the first tap or key does it.
  game.unlockAudio = () => SK.audio.unlock();
  const firstGesture = () => { game.unlockAudio(); window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture); };
  window.addEventListener('pointerdown', firstGesture);
  window.addEventListener('keydown', firstGesture);

  function syncMute() {
    const b = $('btnMute');
    b.textContent = SK.audio.muted ? '🔇' : '🔊';
    b.setAttribute('aria-pressed', String(SK.audio.muted));
    b.setAttribute('aria-label', SK.audio.muted ? 'Unmute sound' : 'Mute sound');
  }
  game.toggleMute = () => { SK.audio.setMuted(!SK.audio.muted); syncMute(); };
  $('btnMute').addEventListener('click', () => game.toggleMute());
  syncMute();
  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; SK.render.resize(); if (game.use3d) SK.render3d.resize(); checkRotate(); });
  });
  // Fonts arrive after first paint; redraw the static layer once they do.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => SK.render.resize());

  // An all-AI match plays behind the menus.
  function newDemo() {
    game.demo = SK.createMatch({ lineup: SK.makeLineup(SK.BALL_BOY_ID, null, null), humanKid: null, difficulty: 'normal', demo: true });
  }
  newDemo();

  // ------------------------------------------------------------ overlays

  game.showOverlay = function (name) {
    $('screen-pause').classList.toggle('active', name === 'pause');
    $('screen-full').classList.toggle('active', name === 'full');
    SK.input.enabled = !name && game.mode === 'match';
    if (name) SK.input.reset();
  };

  function setMatchChrome(on) {
    $('matchUi').hidden = !on;
    $('touch').hidden = !(on && game.touch);
    if (on) SK.ui.resetLabels();
    checkRotate();
  }

  function checkRotate() {
    const show = game.mode === 'match' && game.touch && window.innerHeight > window.innerWidth && !SK.ui.rotateDismissed;
    $('rotate').hidden = !show;
  }

  // ------------------------------------------------------------- control

  game.startMatch = function () {
    const s = SK.ui.sel;
    const bb = s.kid === SK.BALL_BOY_ID;
    if (!s.lineup) s.lineup = SK.makeLineup(s.kid, bb ? null : s.team, bb ? null : s.role);
    game.cfg = {
      lineup: s.lineup,
      humanKid: s.kid,
      humanTeam: bb ? null : s.team,
      humanRole: bb ? null : s.role,
      difficulty: s.difficulty,
    };
    game.match = SK.createMatch(game.cfg);
    game.mode = 'match';
    game.paused = false;
    SK.render.fx.banner = null;
    SK.render.fx.toasts = [];
    document.querySelectorAll('.screen').forEach((x) => x.classList.remove('active'));
    game.showOverlay(null);
    SK.input.reset();
    SK.input.enabled = true;
    setMatchChrome(true);
    acc = 0;
  };

  game.pause = function (on) {
    if (game.mode !== 'match') return;
    if (game.match && game.match.phase === 'fulltime' && on) return;
    game.paused = on;
    game.showOverlay(on ? 'pause' : null);
    acc = 0;
  };

  game.toMenu = function (screen) {
    game.mode = 'menu';
    game.match = null;
    game.paused = false;
    game.showOverlay(null);
    SK.input.enabled = false;
    setMatchChrome(false);
    SK.ui.show(screen || 'title');
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') game.toggleMute();
    if (game.mode !== 'match') return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (game.match.phase === 'fulltime') return;
      game.pause(!game.paused);
    }
  });

  function autoPause() {
    if (game.mode === 'match' && !game.paused && game.match && game.match.phase !== 'fulltime') game.pause(true);
  }
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); last = 0; });

  // ---------------------------------------------------------------- loop

  let last = 0, acc = 0;
  function frame(ts) {
    const dt = last ? Math.min(100, ts - last) : SK.C.TICK;
    last = ts;
    const inMatch = game.mode === 'match';
    const m = inMatch ? game.match : game.demo;

    if (m && !(inMatch && game.paused)) {
      const speed = SK.debug ? SK.debug.speed : 1;
      acc += dt * speed;
      let n = 0;
      while (acc >= SK.C.TICK && n < 6 * speed) {
        m.update(inMatch ? SK.input.poll() : NO_INPUT);
        acc -= SK.C.TICK;
        n++;
      }
      if (n >= 6 * speed) acc = 0;
      const events = m.events.splice(0);
      if (inMatch) {
        for (const e of events) {
          SK.render.onEvent(e, m);
          SK.ui.onEvent(e, m);
          if (SK.audio) SK.audio.onEvent(e, m);
        }
      }
      if (!inMatch && m.phase === 'fulltime' && m.phaseT > 240) newDemo();
    } else acc = 0;

    if (game.use3d) {
      SK.render3d.draw(m);
      SK.render.drawOverlay(m, { hud: inMatch, touch: game.touch });
    } else SK.render.draw(m, { hud: inMatch, touch: game.touch });
    SK.audio.frame(inMatch ? m : null);
    if (inMatch && m) SK.ui.frame(m);
    requestAnimationFrame(frame);
  }

  SK.ui.init();
  SK.intro.start();
  requestAnimationFrame(frame);

  // For poking at from the console, and for the automated soak tests.
  SK.debug = {
    game,
    speed: 1,
    run(m, ticks, input) {
      for (let i = 0; i < ticks; i++) {
        m.update(input || NO_INPUT);
        m.events.length = 0;
        if (m.phase === 'fulltime') return i;
      }
      return ticks;
    },
  };
})();
