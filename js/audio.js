/*
 * Match sound. The FAAH clip (assets/faah.mp3) plays on every shot that misses
 * the goal; everything else (whistle, kicks, crowd, goal roar) is synthesised
 * with the Web Audio API, so the game ships one audio file.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const A = (SK.audio = {});
  const FAAH_SRC = 'assets/faah.mp3';
  const MUTE_KEY = 'skykings.muted';

  let ctx = null, master = null, sfxBus = null, crowdBus = null, crowdGain = null;
  let noiseBuf = null, faahBuf = null, faahEl = null;
  let crowdLevel = 0.05, crowdTarget = 0.05;

  try { A.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { A.muted = false; }

  // ------------------------------------------------------------- set-up

  // Browsers only allow audio after a tap or key press, so the first menu
  // click calls this.
  A.unlock = function () {
    try {
      if (!ctx) build();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (_) { /* sound is a nicety, never a requirement */ }
  };

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = A.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    crowdBus = ctx.createGain();
    crowdBus.gain.value = 1;
    crowdBus.connect(master);

    // Two seconds of white noise, reused for crowd, kicks, net and whooshes.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    startCrowd();
    loadFaah();
  }

  function loadFaah() {
    // Decoded through Web Audio when we can fetch it (http, data:), so it can
    // duck the crowd; a plain <audio> element covers file:// pages.
    fetch(FAAH_SRC)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((buf) => new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)))
      .then((b) => { faahBuf = b; })
      .catch(() => { faahEl = new Audio(FAAH_SRC); faahEl.preload = 'auto'; });
  }

  A.setMuted = function (on) {
    A.muted = on;
    try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch (_) { /* private mode */ }
    if (master) master.gain.setTargetAtTime(on ? 0 : 0.9, ctx.currentTime, 0.05);
  };

  const ready = () => ctx && ctx.state === 'running' && !A.muted;
  A.state = () => ({ ctx: ctx ? ctx.state : 'none', faah: faahBuf ? 'decoded' : faahEl ? 'element' : 'loading' });

  // ----------------------------------------------------------- building blocks

  function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.005, freqEnd = null, bus = sfxBus } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  function tone(t, dur, { type = 'sine', freq = 440, freqEnd = null, gain = 0.2, attack = 0.005, bus = sfxBus } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  // -------------------------------------------------------------- the sounds

  // Referee's whistle: a pea whistle is a high tone with a fast warble.
  function whistle(t, dur) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 3150;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 34;
    const depth = ctx.createGain();
    depth.gain.value = 160;
    lfo.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    g.gain.setValueAtTime(0.4, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    noise(t, dur, { type: 'bandpass', freq: 3200, q: 6, gain: 0.04 });
  }

  const S = {
    whistle(kind) {
      const t = ctx.currentTime + 0.01;
      if (kind === 'fulltime') { whistle(t, 0.28); whistle(t + 0.4, 0.28); whistle(t + 0.8, 0.9); }
      else if (kind === 'goal') whistle(t, 0.7);
      else if (kind === 'out') whistle(t, 0.22);
      else { whistle(t, 0.18); whistle(t + 0.26, 0.5); }
    },
    kick(power = 0.5) {
      const t = ctx.currentTime;
      tone(t, 0.12, { freq: 150 + power * 40, freqEnd: 55, gain: 0.14 + power * 0.16 });
      noise(t, 0.06, { type: 'lowpass', freq: 2400, gain: 0.1 + power * 0.12, attack: 0.002 });
    },
    touch() {
      const t = ctx.currentTime;
      tone(t, 0.06, { freq: 120, freqEnd: 70, gain: 0.12 });
    },
    bounce(v) {
      const t = ctx.currentTime;
      tone(t, 0.07, { freq: 110, freqEnd: 60, gain: Math.min(0.2, 0.04 + v * 0.03) });
    },
    post() {
      // Metal ring: a few detuned partials decaying slowly.
      const t = ctx.currentTime;
      for (const [f, gn] of [[880, 0.12], [1330, 0.08], [2210, 0.05]]) tone(t, 0.9, { type: 'triangle', freq: f, gain: gn });
      S.kick(0.4);
    },
    net() { noise(ctx.currentTime, 0.45, { type: 'highpass', freq: 1800, gain: 0.18, attack: 0.02 }); },
    tackle(won) {
      const t = ctx.currentTime;
      noise(t, 0.22, { type: 'bandpass', freq: 500, freqEnd: 180, q: 0.8, gain: 0.3, attack: 0.01 });
      if (won) tone(t, 0.1, { freq: 140, freqEnd: 60, gain: 0.25 });
    },
    whoosh() { noise(ctx.currentTime, 0.35, { type: 'bandpass', freq: 600, freqEnd: 2400, q: 1.5, gain: 0.12, attack: 0.08 }); },
    save() {
      S.touch();
      crowdSwell(0.35, 1.2);   // "ooooh"
      oooh(1.1);
    },
    goal() {
      const t = ctx.currentTime;
      // Air-horn chord, then the roar.
      for (const f of [233, 294, 349]) tone(t, 1.6, { type: 'sawtooth', freq: f, gain: 0.07, attack: 0.03 });
      noise(t, 2.8, { type: 'bandpass', freq: 900, q: 0.5, gain: 0.5, attack: 0.15, bus: crowdBus });
      crowdSwell(0.5, 3.5);
    },
    click() { tone(ctx.currentTime, 0.05, { type: 'square', freq: 660, gain: 0.05 }); },
  };
  A.S = S;

  // ------------------------------------------------------------------ crowd

  // A bed of filtered noise that breathes, plus a level that rises when
  // play nears a goal and swells for chances, saves and goals.
  function startCrowd() {
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdGain.connect(crowdBus);
    for (const [freq, q, lvl] of [[420, 0.7, 1], [1100, 0.9, 0.6], [2600, 1.2, 0.25]]) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = lvl;
      // Slow random-ish swell so it never sounds like a hiss.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + Math.random() * 0.2;
      const lg = ctx.createGain();
      lg.gain.value = lvl * 0.35;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(crowdGain);
      src.start(0, Math.random() * 1.5);
      lfo.start();
    }
  }

  function crowdSwell(level, secs) {
    if (!crowdGain) return;
    const t = ctx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setTargetAtTime(Math.max(level, crowdLevel), t, 0.12);
    crowdGain.gain.setTargetAtTime(crowdLevel, t + secs, 0.6);
  }

  // A rising-falling vowel-ish band for the crowd's "ooooh".
  function oooh(dur) {
    const t = ctx.currentTime;
    noise(t, dur, { type: 'bandpass', freq: 380, freqEnd: 300, q: 4, gain: 0.35, attack: 0.25, bus: crowdBus });
    noise(t, dur, { type: 'bandpass', freq: 760, freqEnd: 600, q: 5, gain: 0.18, attack: 0.25, bus: crowdBus });
  }

  // Called every frame with the live match: the crowd follows the ball.
  A.frame = function (m) {
    if (!ctx || !crowdGain) return;
    let target = 0.05;
    if (m && SK.game.mode === 'match' && !SK.game.paused) {
      const b = m.ball;
      const nearGoal = Math.min(b.x, SK.C.PW - b.x);
      target = 0.06 + Math.max(0, (260 - nearGoal) / 260) * 0.1;
      if (m.phase === 'goal') target = 0.2;
      if (m.phase === 'fulltime') target = 0.12;
    } else if (SK.game.mode === 'match' && SK.game.paused) target = 0.02;
    if (Math.abs(target - crowdTarget) > 0.005) {
      crowdTarget = target;
      crowdLevel = target;
      crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.5);
    }
  };

  // ------------------------------------------------------------------- FAAH

  A.faah = function () {
    if (!ready()) return;
    // Hush the crowd under it so the meme lands.
    if (crowdGain) {
      const t = ctx.currentTime;
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setTargetAtTime(crowdLevel * 0.35, t, 0.05);
      crowdGain.gain.setTargetAtTime(crowdLevel, t + 2.2, 0.4);
    }
    if (faahBuf) {
      const src = ctx.createBufferSource();
      src.buffer = faahBuf;
      const g = ctx.createGain();
      g.gain.value = 1.5;
      src.connect(g).connect(master);
      src.start();
    } else if (faahEl) {
      try { faahEl.currentTime = 0; faahEl.play().catch(() => {}); } catch (_) { /* ignore */ }
    }
  };

  // ------------------------------------------------------------ match events

  A.onEvent = function (e) {
    if (!ready()) return;
    switch (e.type) {
      case 'whistle': S.whistle(e.kind); break;
      case 'shot': S.kick(0.5 + e.power * 0.5); crowdSwell(0.16, 0.8); break;
      case 'pass': S.kick(0.25); break;
      case 'clear': S.kick(0.75); break;
      case 'control': S.touch(); break;
      case 'block': S.kick(0.35); break;
      case 'bounce': S.bounce(e.v); break;
      case 'post': S.post(); crowdSwell(0.3, 1.2); oooh(1); break;
      case 'save': S.save(); break;
      case 'miss': A.faah(); break;
      case 'tackle': S.tackle(e.won); break;
      case 'slide': S.whoosh(); break;
      case 'goal': S.whistle('goal'); S.goal(); break;
      case 'net': break;
      case 'out': S.whistle('out'); break;
      case 'throw': S.whoosh(); break;
      case 'dive': S.whoosh(); break;
      default: break;
    }
  };

})();
