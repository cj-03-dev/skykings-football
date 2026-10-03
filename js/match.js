/*
 * The match: ball physics, possession, the rules (goals, outs, kick-offs),
 * Ibrahim's ball-boy duty, and the AI for everyone the player doesn't control.
 *
 * World units: x runs goal line to goal line (0..PW), y touchline to
 * touchline (0..PH, larger y is nearer the camera), z is height. One update
 * is one 60fps tick.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const C = SK.C;
  const { clamp, dist, rand, gauss, pick } = SK.util;
  const PW = C.PW, PH = C.PH, MIDY = PH / 2;
  const GOAL_TOP = MIDY - C.GOAL_W / 2, GOAL_BOT = MIDY + C.GOAL_W / 2;

  const G = 0.32;                    // gravity, units per tick^2
  const FR_K = 0.017, FR_C = 0.035;  // rolling friction: proportional + constant
  const AIR = 0.997;
  const KO_FREEZE = 80;              // "KICK OFF" banner before anyone may move
  const GOAL_PAUSE = 210;            // celebration before the restart
  const CONTROL_R = C.PR + C.BALL_R + 3;
  const CHARGE_T = 54;               // ticks to fill the power bar

  // How far a ground ball rolls from a given speed, so passes can be weighted.
  const DIST_TABLE = [];
  for (let i = 0; i <= 300; i++) {
    let v = i * 0.1, s = 0;
    while (v > 0) { s += v; v = v * (1 - FR_K) - FR_C; }
    DIST_TABLE.push(s);
  }
  const speedFor = (d) => {
    for (let i = 0; i < DIST_TABLE.length; i++) if (DIST_TABLE[i] >= d) return i * 0.1;
    return 30;
  };

  // ---------------------------------------------------------- ball boy track
  //
  // Ibrahim lives on a rectangle just outside the pitch, parameterised by
  // distance s, clockwise from the far-left corner. Running along it means he
  // goes round the pitch, never across it.

  const TX0 = -C.GOAL_D - 26, TX1 = PW + C.GOAL_D + 26, TY0 = -C.TRACK, TY1 = PH + C.TRACK;
  const TW = TX1 - TX0, TH = TY1 - TY0, TL = 2 * (TW + TH);

  function trackPoint(s) {
    s = ((s % TL) + TL) % TL;
    if (s < TW) return { x: TX0 + s, y: TY0, nx: 0, ny: 1 };
    s -= TW;
    if (s < TH) return { x: TX1, y: TY0 + s, nx: -1, ny: 0 };
    s -= TH;
    if (s < TW) return { x: TX1 - s, y: TY1, nx: 0, ny: -1 };
    s -= TW;
    return { x: TX0, y: TY1 - s, nx: 1, ny: 0 };
  }

  function trackS(x, y) {
    const cx = clamp(x, TX0, TX1), cy = clamp(y, TY0, TY1);
    const dT = cy - TY0, dB = TY1 - cy, dL = cx - TX0, dR = TX1 - cx;
    const mn = Math.min(dT, dB, dL, dR);
    if (mn === dT) return cx - TX0;
    if (mn === dR) return TW + (cy - TY0);
    if (mn === dB) return TW + TH + (TX1 - cx);
    return 2 * TW + TH + (TY1 - cy);
  }

  // Where to fetch a ball from: never from directly behind a goal mouth,
  // because the throw would sail through the net.
  function fetchS(x, y) {
    let s = trackS(x, y);
    const p = trackPoint(s);
    if ((p.x === TX0 || p.x === TX1) && Math.abs(p.y - MIDY) < C.GOAL_W / 2 + 34) {
      const ny = MIDY + (p.y < MIDY ? -1 : 1) * (C.GOAL_W / 2 + 34);
      s = trackS(p.x, ny);
    }
    return s;
  }

  const sDelta = (a, b) => {
    let d = (((b - a) % TL) + TL) % TL;
    if (d > TL / 2) d -= TL;
    return d;
  };

  // ------------------------------------------------------------- formations
  // Fractions of the pitch in a frame where the team attacks to the right.

  const FORM = { GK: [0.03, 0.5], DEF: [0.22, 0.5], MID: [0.43, 0.36], FWD: [0.63, 0.62] };
  const KICKOFF = { GK: [0.025, 0.5], DEF: [0.2, 0.5], MID: [0.37, 0.33], FWD: [0.43, 0.66] };
  const ROLE_X = { GK: [0.01, 0.07], DEF: [0.1, 0.56], MID: [0.22, 0.78], FWD: [0.36, 0.9] };

  // =================================================================== match

  SK.createMatch = function (cfg) {
    const m = {
      cfg,
      t: 0,
      phase: 'kickoff',
      phaseT: 0,
      events: [],
      teams: [],
      players: [],
      pred: [],
      lastTouchT: 0,
      goals: [],
      winner: null,
      out: null,
      kickTeam: null,
      stats: { shots: 0, misses: 0, saves: 0, outs: 0, throws: 0, tackles: 0, posts: 0, stuck: 0 },
    };
    for (let k = 0; k <= 90; k++) m.pred.push({ x: 0, y: 0, z: 0 });

    const emit = (type, data) => m.events.push(Object.assign({ type, t: m.t }, data));
    m.emit = emit;

    // ---- teams and players

    const humanKid = cfg.humanKid;
    const bbHuman = humanKid === SK.BALL_BOY_ID;
    const leftId = cfg.humanTeam || (Math.random() < 0.5 ? 'rma' : 'fcb');
    for (const id of [leftId, SK.otherTeam(leftId)]) {
      const T = {
        id, def: SK.TEAMS[id], dir: id === leftId ? 1 : -1, score: 0, players: [],
        chaser: null, chaseInfo: null, presser: null, passRequest: null,
        human: !bbHuman && cfg.humanTeam === id,
      };
      T.diff = T.human ? SK.MATE : SK.DIFFICULTY[cfg.difficulty || 'normal'];
      m.teams.push(T);
    }
    m.teams[0].opp = m.teams[1];
    m.teams[1].opp = m.teams[0];

    for (const T of m.teams) {
      for (const role of SK.ROLES) {
        const kid = SK.kidById(cfg.lineup[T.id][role]);
        const st = SK.statsFor(kid);
        const p = {
          kind: 'player', id: T.id + '-' + role, kid, team: T, role, stats: st,
          human: !bbHuman && kid.id === humanKid,
          number: SK.POSITIONS.find((q) => q.id === role).number,
          x: 0, y: 0, z: 0, vx: 0, vy: 0, dvx: 0, dvy: 0, fx: T.dir, fy: 0,
          maxSpeed: 2.9 * (1 + (st.pace - 82) / 160),
          accel: 0.17 + (st.agility - 80) / 500,
          turn: 0.2 + (st.agility - 80) / 300,
          shotMul: 0.9 + (st.shot - 70) / 200,
          reachMul: 0.86 + (st.reach - 60) / 210,
          state: 'normal', stateT: 0, diveDir: 1,
          kickCd: 0, tackleCd: 0, touchCd: 0, stun: 0, kickT: 0, throwT: 0,
          charging: false, charge: 0, chargeT: 0,
          buffer: { shot: 0, pass: 0 },
          phase: Math.random() * 6, run: 0, pose: 'idle', facing: 'side', flip: T.dir < 0,
          ai: { decideT: 0, holdT: 0, seenShot: -1, dived: false, mark: null, rushT: 0 },
          celebrate: false,
        };
        p.speedMul = p.human ? 1 : T.diff.speed;
        T.players.push(p);
        m.players.push(p);
      }
    }
    m.human = m.players.find((p) => p.human) || null;

    const bbKid = SK.kidById(SK.BALL_BOY_ID);
    m.bb = {
      kind: 'ballboy', kid: bbKid, team: null, human: bbHuman,
      s: TW + TH + TW / 2, x: 0, y: 0, z: 0, vx: 0, vy: 0, fx: 0, fy: -1,
      state: 'idle', holdT: 0, throwT: 0, charging: false, charge: 0, chargeT: 0,
      phase: 0, run: 0, pose: 'idle', facing: 'up', flip: false,
    };
    placeBallBoy(m.bb.s);
    if (bbHuman) m.human = m.bb;

    m.ball = {
      x: PW / 2, y: MIDY, z: 0, vx: 0, vy: 0, vz: 0, px: PW / 2, py: MIDY,
      owner: null, hands: false, last: null, shot: null, passTo: null, passT: 0,
      inThrow: false, net: false, spin: SK.art.newSpin(),
    };

    const teamOf = (id) => m.teams.find((t) => t.id === id);
    m.teamOf = teamOf;
    const ownGoalX = (T) => (T.dir > 0 ? 0 : PW);
    const oppGoalX = (T) => (T.dir > 0 ? PW : 0);
    const frameX = (T, x) => (T.dir > 0 ? x : PW - x);   // own-frame <-> world, same both ways

    function inBox(T, x, y, pad = 0) {
      const d = frameX(T, x);
      return d >= -24 - pad && d <= C.BOX_D + pad && Math.abs(y - MIDY) <= C.BOX_W / 2 + pad;
    }
    m.inBox = inBox;

    // ---- restarts

    function placeBallBoy(s) {
      const bb = m.bb;
      bb.s = s;
      const p = trackPoint(s);
      bb.x = p.x; bb.y = p.y;
    }

    function placeKickoff(T) {
      m.kickTeam = T;
      for (const p of m.players) {
        const P = p.team;
        let [fx, fy] = KICKOFF[p.role];
        if (P === T && p.role === 'FWD') { fx = 0.5 - 16 / PW; fy = 0.5; }
        if (P === T && p.role === 'MID') { fx = 0.41; fy = 0.4; }
        p.x = frameX(P, fx * PW);
        p.y = fy * PH;
        p.vx = p.vy = p.dvx = p.dvy = 0;
        p.fx = P.dir; p.fy = 0;
        p.state = 'normal'; p.stateT = 0;
        p.kickCd = p.tackleCd = p.touchCd = p.stun = p.kickT = p.throwT = 0;
        p.charging = false; p.charge = 0;
        p.buffer.shot = p.buffer.pass = 0;
        p.celebrate = false;
        p.ai.holdT = 0; p.ai.seenShot = -1; p.ai.dived = false; p.ai.rushT = 0;
      }
      const b = m.ball;
      Object.assign(b, { x: PW / 2, y: MIDY, z: 0, vx: 0, vy: 0, vz: 0, px: PW / 2, py: MIDY,
        hands: false, shot: null, passTo: null, inThrow: false, net: false, last: null });
      b.owner = T.players.find((p) => p.role === 'FWD');
      T.passRequest = null;
      T.opp.passRequest = null;
      m.bb.state = 'idle';
      m.bb.charging = false;
      m.out = null;
      m.phase = 'kickoff';
      m.phaseT = 0;
      m.lastTouchT = m.t;
    }

    // ------------------------------------------------------------- actions

    function kick(p, vx, vy, vz) {
      const b = m.ball;
      if (b.hands) b.z = 22 * p.kid.height;
      b.owner = null;
      b.hands = false;
      b.vx = vx; b.vy = vy; b.vz = vz;
      b.last = p;
      b.shot = null;
      b.passTo = null;
      b.inThrow = false;
      p.kickCd = 16;
      p.kickT = 14;
      p.charging = false;
      p.ai.holdT = 0;
      if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
        const l = Math.hypot(vx, vy);
        p.fx = vx / l; p.fy = vy / l;
      }
      m.lastTouchT = m.t;
      if (m.phase === 'kickoff') { m.phase = 'play'; m.phaseT = 0; }
    }

    function shoot(p, power, aimY) {
      const b = m.ball, T = p.team;
      const gx = oppGoalX(T);
      const d = Math.abs(gx - b.x) + Math.abs(MIDY - b.y) * 0.3;
      if (aimY == null) aimY = rand(-0.4, 0.4);
      let ty = MIDY + clamp(aimY, -1, 1) * (C.GOAL_W / 2 - 9);
      const err = p.human
        ? 8 + d * 0.022 + (power > 0.86 ? 8 : 0)
        : T.diff.aimErr * (0.55 + d / 650);
      ty += gauss() * err;
      const dx = gx - b.x, dy = ty - b.y, l = Math.hypot(dx, dy) || 1;
      const spd = (12 + 10.5 * power) * p.shotMul;
      // Loft stays low until the red zone at the top of the power bar, where
      // it climbs fast: blasting from range sails over the bar.
      const vz = power <= 0.85 ? 0.6 + 3.2 * power * power : 2.9 + ((power - 0.85) / 0.15) * 3.5;
      kick(p, (dx / l) * spd, (dy / l) * spd, vz);
      b.shot = { by: p, team: T };
      m.stats.shots++;
      emit('shot', { by: p, power });
    }

    function passTo(p, r) {
      const b = m.ball;
      const fromHands = b.hands;
      const d0 = dist(b.x, b.y, r.x, r.y);
      const t0 = d0 / Math.max(4, speedFor(d0 + 40) * 0.75);
      const tx = clamp(r.x + r.vx * t0 * 0.75, 12, PW - 12);
      const ty = clamp(r.y + r.vy * t0 * 0.75, 12, PH - 12);
      const d = dist(b.x, b.y, tx, ty);
      const spd = clamp(speedFor(d + (fromHands ? 10 : 45)), 4.5, 15.5);
      const err = (p.human ? 0.025 : p.team.diff.passErr) * gauss();
      const a = Math.atan2(ty - b.y, tx - b.x) + err;
      kick(p, Math.cos(a) * spd, Math.sin(a) * spd, fromHands ? 1.6 : 0.3);
      b.passTo = r;
      b.passT = 100;
      if (p.team.passRequest && p.team.passRequest.by === r) p.team.passRequest = null;
      if (fromHands) p.throwT = 16;
      emit('pass', { by: p, to: r });
    }

    // A long kick upfield: keeper punts and panic clearances.
    function boot(p, aimX, aimY, power = 1) {
      const b = m.ball;
      const dx = aimX - b.x, dy = aimY - b.y, l = Math.hypot(dx, dy) || 1;
      const spd = (11 + 4 * power) * p.shotMul;
      kick(p, (dx / l) * spd, (dy / l) * spd, 3.2 + 2.6 * power);
      emit('clear', { by: p });
    }

    function take(p) {
      const b = m.ball;
      b.owner = p;
      b.hands = false;
      b.last = p;
      b.shot = null;
      b.passTo = null;
      b.inThrow = false;
      b.vz = 0;
      p.ai.holdT = 0;
      p.ai.decideT = 4 + Math.floor(Math.random() * 6);
      m.lastTouchT = m.t;
      emit('control', { by: p });
      if (p.human && p.buffer.shot > 0) { p.buffer.shot = 0; shoot(p, 0.62, humanAim()); }
      else if (p.human && p.buffer.pass > 0) {
        p.buffer.pass = 0;
        const r = pickPassTarget(p, m.input ? m.input.mx : 0, m.input ? m.input.my : 0);
        if (r) passTo(p, r);
      }
    }

    function humanAim() {
      const my = m.input ? m.input.my : 0;
      return Math.abs(my) > 0.3 ? Math.sign(my) * (0.5 + 0.36 * Math.min(1, Math.abs(my))) : null;
    }

    function startTackle(p) {
      const b = m.ball;
      if (p.tackleCd > 0 || p.state !== 'normal' || b.owner === p || p.stun > 0) return;
      let dx = p.fx, dy = p.fy;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < 90 && d > 0.1) { dx = (b.x - p.x) / d; dy = (b.y - p.y) / d; }
      p.state = 'tackle';
      p.stateT = 16;
      p.tackleCd = 44;
      p.tdx = dx; p.tdy = dy;
      p.vx = dx * 5.3; p.vy = dy * 5.3;
      p.fx = dx; p.fy = dy;
      p.tackleDone = false;
      emit('slide', { by: p });
    }

    function startDive(p, ty) {
      if (p.state !== 'normal') return;
      const dir = Math.sign(ty - p.y) || (Math.random() < 0.5 ? -1 : 1);
      const skill = p.human ? 1 : p.team.diff.gkSkill;
      p.state = 'dive';
      p.stateT = 26;
      p.diveDir = dir;
      p.vy = dir * 5.2 * p.reachMul * skill;
      p.vx = p.team.dir * 0.5;
      p.ai.dived = true;
      emit('dive', { by: p });
    }

    // ---------------------------------------------------------- ball boy

    function bbMove(bb, ds) {
      const before = trackPoint(bb.s);
      bb.s = (((bb.s + ds) % TL) + TL) % TL;
      const p = trackPoint(bb.s);
      bb.vx = p.x - before.x; bb.vy = p.y - before.y;
      if (Math.abs(bb.vx) > 6 || Math.abs(bb.vy) > 6) { bb.vx = 0; bb.vy = 0; }   // wrap seam
      bb.x = p.x; bb.y = p.y;
    }

    function bbRunToward(bb, targetS, speed) {
      const d = sDelta(bb.s, targetS);
      bbMove(bb, clamp(d, -speed, speed));
      return Math.abs(d);
    }

    // Human ball boy. While a ball is out, any push on the stick sprints him
    // the short way round to it: kids push toward the ball, and that should
    // just work. Otherwise the stick walks him along the track.
    function bbHumanMove(bb, mx, my, speed) {
      const mag = Math.hypot(mx, my);
      if (mag < 0.2) { bb.vx = bb.vy = 0; return; }
      const step = speed * Math.min(1, mag);
      if (m.phase === 'out' && bb.state !== 'hold') {
        const d = sDelta(bb.s, fetchS(m.ball.x, m.ball.y));
        bbMove(bb, clamp(d, -step, step));
        return;
      }
      const fwd = trackPoint(bb.s + 6), back = trackPoint(bb.s - 6);
      let tx = fwd.x - back.x, ty = fwd.y - back.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const along = (mx * tx + my * ty) / mag;
      if (Math.abs(along) > 0.3) bbMove(bb, Math.sign(along) * step);
      else { bb.vx = bb.vy = 0; }
    }

    function chooseReceiver() {
      const o = m.out, A = o.award, b = m.ball;
      const own = ownGoalX(A);
      // Ball out over the awarded team's own goal line: the keeper takes it.
      const overOwnLine = (own === 0 && o.exitX < 0) || (own === PW && o.exitX > PW);
      const gk = A.players.find((p) => p.role === 'GK');
      if (overOwnLine && gk) return gk;
      let best = null, bd = 1e9;
      for (const p of A.players) {
        if (p.role === 'GK') continue;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }

    function receiveSpot(r) {
      const bb = m.bb, tp = trackPoint(bb.s);
      if (r.role === 'GK') {
        const gx = ownGoalX(r.team);
        return { x: gx + r.team.dir * 40, y: clamp(bb.y, MIDY - 90, MIDY + 90) };
      }
      return {
        x: clamp(bb.x + tp.nx * 110, 50, PW - 50),
        y: clamp(bb.y + tp.ny * 110, 40, PH - 40),
      };
    }

    function throwIn(tx, ty) {
      const b = m.ball, bb = m.bb;
      const d = Math.max(30, dist(bb.x, bb.y, tx, ty));
      const T = clamp(d / 7.2, 14, 36);
      const z0 = 28 * bb.kid.height;
      b.owner = null;
      b.hands = false;
      b.x = bb.x; b.y = bb.y; b.z = z0; b.px = b.x; b.py = b.y;
      b.vx = ((tx - bb.x) / d) * (d / T);
      b.vy = ((ty - bb.y) / d) * (d / T);
      b.vz = (G * T * T / 2 - z0) / T;
      b.inThrow = true;
      b.last = bb;
      b.shot = null;
      b.passTo = m.out && m.out.receiver ? m.out.receiver : null;
      b.passT = 120;
      bb.state = 'idle';
      bb.throwT = 18;
      bb.charging = false;
      m.stats.throws++;
      m.phase = 'play';
      m.phaseT = 0;
      m.lastTouchT = m.t;
      emit('throw', {});
    }

    function updateBallBoy(inp) {
      const bb = m.bb, b = m.ball;
      if (bb.throwT > 0) bb.throwT--;
      const speed = m.phase === 'out' ? 5.6 : 3.4;   // sprints to fetch, strolls otherwise
      const x0 = bb.x, y0 = bb.y;

      if (m.phase === 'out' && bb.state !== 'hold') {
        bb.state = 'fetch';
        const target = fetchS(b.x, b.y);
        if (bb.human) bbHumanMove(bb, inp.mx, inp.my, speed);
        else bbRunToward(bb, target, speed);
        const slow = Math.hypot(b.vx, b.vy) < 2.6;
        if (slow && Math.abs(sDelta(bb.s, target)) < 14) {
          bb.state = 'hold';
          bb.holdT = 0;
          b.owner = bb;
          b.vx = b.vy = b.vz = 0;
          m.out.receiver = chooseReceiver();
          emit('pickup', {});
        }
      } else if (bb.state === 'hold') {
        bb.holdT++;
        // Ball travels into his hands, then sits overhead.
        const k = Math.min(1, bb.holdT / 10);
        b.x += (bb.x - b.x) * k; b.y += (bb.y - b.y) * k;
        b.z += (28 * bb.kid.height + 6 - b.z) * k;
        const r = m.out.receiver;
        if (bb.human) {
          bbHumanMove(bb, inp.mx, inp.my, speed * 0.6);
          if (inp.shootDown) { bb.charging = true; bb.chargeT = 0; bb.charge = 0; }
          if (bb.charging) {
            bb.chargeT++;
            bb.charge = Math.min(1, bb.chargeT / 40);
            if (inp.shootUp || bb.chargeT > 70) {
              const tp = trackPoint(bb.s);
              let ax = inp.mx, ay = inp.my;
              const mag = Math.hypot(ax, ay);
              if (mag < 0.3) { const sp = receiveSpot(r || chooseReceiver()); ax = sp.x - bb.x; ay = sp.y - bb.y; }
              const l = Math.hypot(ax, ay) || 1;
              ax /= l; ay /= l;
              // Throws must go into the pitch, never back into the stands.
              const inward = ax * tp.nx + ay * tp.ny;
              if (inward < 0.3) { ax += tp.nx * (0.3 - inward) * 2; ay += tp.ny * (0.3 - inward) * 2; const l2 = Math.hypot(ax, ay); ax /= l2; ay /= l2; }
              const reach = bb.chargeT < 7 ? 160 : 90 + bb.charge * 300;
              throwIn(bb.x + ax * reach, bb.y + ay * reach);
            }
          } else if (inp.pass) {
            const sp = receiveSpot(r || chooseReceiver());
            const rr = r || chooseReceiver();
            throwIn(rr ? rr.x : sp.x, rr ? rr.y : sp.y);
          }
        } else if (r) {
          const sp = receiveSpot(r);
          const ready = dist(r.x, r.y, sp.x, sp.y) < 36 || r.human;
          if ((bb.holdT > 50 && ready) || bb.holdT > 150) {
            // Lead toward where the receiver is standing (or heading).
            throwIn(r.human || r.role === 'GK' ? r.x : sp.x, r.human || r.role === 'GK' ? r.y : sp.y);
          }
        }
      } else if (bb.human) {
        bbHumanMove(bb, inp.mx, inp.my, speed);
      } else {
        // Off duty: drift along the near touchline, following play.
        const home = trackS(clamp(b.x, 120, PW - 120), TY1);
        if (Math.abs(sDelta(bb.s, home)) > 4) bbRunToward(bb, home, Math.abs(sDelta(bb.s, home)) > 300 ? 3.2 : 1.3);
        else bb.vx = bb.vy = 0;
      }
      if (bb.state === 'hold' && b.owner === bb && bb.holdT >= 10) {
        b.x = bb.x; b.y = bb.y; b.z = 28 * bb.kid.height + 6;
      }

      // Facing and animation.
      const mvx = bb.x - x0, mvy = bb.y - y0, sp = Math.hypot(mvx, mvy);
      if (sp > 0.2 && sp < 8) { bb.fx = mvx / sp; bb.fy = mvy / sp; }
      if (m.phase === 'out' || bb.state === 'hold') {
        // Face the pitch while holding.
        if (bb.state === 'hold') { const tp = trackPoint(bb.s); bb.fx = tp.nx; bb.fy = tp.ny; }
      }
      bb.run = Math.min(1, sp / 2.2);
      bb.phase += sp * 0.3;
      bb.pose = bb.throwT > 0 || bb.state === 'hold' ? 'throw' : sp > 0.3 ? 'run' : 'idle';
      setView(bb);
    }

    // ------------------------------------------------------------ prediction

    function stepFree(s) {
      s.x += s.vx; s.y += s.vy; s.z += s.vz;
      if (s.z > 0 || s.vz > 0) s.vz -= G;
      if (s.z <= 0) { s.z = 0; if (s.vz < 0) { s.vz = -s.vz * 0.42; if (s.vz < 0.9) s.vz = 0; } }
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > 0) {
        const ns = s.z < 0.5 ? Math.max(0, sp * (1 - FR_K) - FR_C) : sp * AIR;
        s.vx *= ns / sp; s.vy *= ns / sp;
      }
    }

    function predictBall() {
      const b = m.ball;
      const s = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz };
      const owned = b.owner && b.owner.kind === 'player' ? b.owner : null;
      for (let k = 0; k < m.pred.length; k++) {
        const q = m.pred[k];
        if (owned) { q.x = b.x + owned.vx * k * 0.6; q.y = b.y + owned.vy * k * 0.6; q.z = 0; }
        else { q.x = s.x; q.y = s.y; q.z = s.z; stepFree(s); }
      }
    }

    function intercept(p) {
      const sp = p.maxSpeed * p.speedMul;
      for (let k = 0; k < m.pred.length; k++) {
        const q = m.pred[k];
        if (q.z > 22) continue;
        if (dist(p.x, p.y, q.x, q.y) - 16 <= sp * k) return { k, x: q.x, y: q.y };
      }
      const q = m.pred[m.pred.length - 1];
      return { k: 999, x: q.x, y: q.y };
    }

    // ---------------------------------------------------------- team brain

    function assign(T) {
      const b = m.ball, O = T.opp;
      T.chaser = null; T.chaseInfo = null; T.presser = null;
      for (const p of T.players) p.ai.mark = null;
      if (T.passRequest && --T.passRequest.t <= 0) T.passRequest = null;
      if (m.phase !== 'play') return;

      const outfield = T.players.filter((p) => !p.human && p.role !== 'GK' && p.stun === 0 && p.state !== 'down');
      const owner = b.owner && b.owner.kind === 'player' ? b.owner : null;

      if (!owner) {
        if (b.passTo && b.passTo.team === T && !b.passTo.human && b.passT > 0) {
          T.chaser = b.passTo;
          T.chaseInfo = intercept(b.passTo);
          return;
        }
        let best = null, bi = null;
        for (const p of outfield) {
          const it = intercept(p);
          if (!bi || it.k < bi.k) { bi = it; best = p; }
        }
        const h = T.players.find((p) => p.human);
        if (h && best && intercept(h).k + 8 < bi.k) best = null;
        if (best) { T.chaser = best; T.chaseInfo = bi; }
      } else if (owner.team === O && !b.hands) {
        let best = null, bd = 1e9;
        for (const p of outfield) {
          const d = dist(p.x, p.y, owner.x, owner.y);
          if (d < bd) { bd = d; best = p; }
        }
        T.presser = best;
        // Goal-side marking for the rest, most dangerous attacker first.
        const og = ownGoalX(T);
        const threats = O.players
          .filter((o) => o !== owner && o.role !== 'GK')
          .sort((a, c) => Math.abs(a.x - og) - Math.abs(c.x - og));
        const markers = ['DEF', 'MID']
          .map((r) => T.players.find((p) => p.role === r))
          .filter((p) => p && !p.human && p !== best);
        markers.forEach((p, i) => { if (threats[i]) p.ai.mark = threats[i]; });
      }
    }

    function go(p, tx, ty, frac) {
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d < 3) { p.dvx = p.dvy = 0; return; }
      const spd = p.maxSpeed * p.speedMul * frac * Math.min(1, d / 26);
      p.dvx = (dx / d) * spd;
      p.dvy = (dy / d) * spd;
    }

    function formTarget(p, attacking) {
      const T = p.team, b = m.ball;
      const [bx0, by0] = FORM[p.role];
      const bxF = frameX(T, b.x);
      let fx = bx0 * PW + (bxF - PW / 2) * 0.36 + (attacking ? 0.11 * PW : -0.05 * PW);
      let fy = by0 * PH + (b.y - MIDY) * 0.38;
      const [lo, hi] = ROLE_X[p.role];
      fx = clamp(fx, lo * PW, hi * PW);
      fy = clamp(fy, 40, PH - 40);
      return { x: frameX(T, fx), y: fy };
    }

    function supportTarget(p) {
      const f = formTarget(p, true);
      const owner = m.ball.owner;
      // Drift out of an opponent's shadow and away from the carrier.
      for (const o of p.team.opp.players) {
        const d = dist(f.x, f.y, o.x, o.y);
        if (d < 70 && d > 0.1) { f.x += ((f.x - o.x) / d) * (70 - d) * 0.7; f.y += ((f.y - o.y) / d) * (70 - d) * 0.7; }
      }
      if (owner) {
        const d = dist(f.x, f.y, owner.x, owner.y);
        if (d < 100 && d > 0.1) { f.x += ((f.x - owner.x) / d) * (100 - d) * 0.6; f.y += ((f.y - owner.y) / d) * (100 - d) * 0.6; }
      }
      f.x = clamp(f.x, 30, PW - 30);
      f.y = clamp(f.y, 30, PH - 30);
      return f;
    }

    // Shortest distance from any of `players` to segment a->b.
    function laneClear(ax, ay, bx, by, players, skipGK) {
      let best = 1e9;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      for (const o of players) {
        if (skipGK && o.role === 'GK') continue;
        const t = clamp(((o.x - ax) * dx + (o.y - ay) * dy) / L2, 0, 1);
        const d = dist(o.x, o.y, ax + dx * t, ay + dy * t);
        if (d < best) best = d;
      }
      return best;
    }

    function bestPass(p) {
      const T = p.team, b = m.ball;
      let best = null, bs = -1e9;
      for (const q of T.players) {
        if (q === p || q.stun > 0 || q.state !== 'normal') continue;
        const d = dist(b.x, b.y, q.x, q.y);
        if (d < 50 || d > 560) continue;
        const lane = laneClear(b.x, b.y, q.x, q.y, T.opp.players, false);
        if (lane < 20) continue;
        let space = 1e9;
        for (const o of T.opp.players) space = Math.min(space, dist(o.x, o.y, q.x, q.y));
        const progress = (q.x - p.x) * T.dir;
        let s = progress * 0.55 + Math.min(space, 140) * 0.6 + Math.min(lane, 60) * 0.5 - d * 0.08;
        if (q.role === 'GK') s -= 140;
        if (q.human) s += 75;
        if (T.passRequest && T.passRequest.by === q) s += 250;
        s += rand(-12, 12);
        if (s > bs) { bs = s; best = q; }
      }
      return best ? { p: best, score: bs } : null;
    }

    function pickPassTarget(p, mx, my) {
      const T = p.team, b = m.ball;
      const mag = Math.hypot(mx, my);
      if (mag < 0.25) { const bp = bestPass(p); return bp ? bp.p : null; }
      const ux = mx / mag, uy = my / mag;
      let best = null, bs = -1e9;
      for (const q of T.players) {
        if (q === p) continue;
        const dx = q.x - b.x, dy = q.y - b.y, d = Math.hypot(dx, dy);
        if (d < 25) continue;
        const align = (dx * ux + dy * uy) / d;
        if (align < 0.35) continue;
        const s = align * 3 - d / 500 - (q.role === 'GK' ? 0.6 : 0);
        if (s > bs) { bs = s; best = q; }
      }
      if (!best) { const bp = bestPass(p); best = bp ? bp.p : null; }
      return best;
    }

    // ----------------------------------------------------------------- AI

    function aiCarrier(p) {
      const b = m.ball, T = p.team, D = T.diff;
      p.ai.holdT++;
      if (b.hands) return aiKeeperHold(p);

      const gx = oppGoalX(T);
      const dGoal = dist(p.x, p.y, gx, MIDY);
      let near = 1e9;
      for (const o of T.opp.players) near = Math.min(near, dist(p.x, p.y, o.x, o.y));

      if (m.phase === 'kickoff') {
        p.dvx = p.dvy = 0;
        if (m.phaseT > KO_FREEZE + 28) {
          const mate = T.players.find((q) => q.role === 'MID');
          passTo(p, mate);
        }
        return;
      }

      if (p.role === 'GK') {
        // Ball at the keeper's feet (outside the box): move it on quickly.
        p.dvx = p.dvy = 0;
        if (p.ai.holdT > 10) {
          const bp = bestPass(p);
          if (bp && bp.score > -60) passTo(p, bp.p);
          else boot(p, frameX(T, PW * 0.65), clamp(p.y + rand(-120, 120), 60, PH - 60), 0.9);
        }
        return;
      }

      if (--p.ai.decideT <= 0) {
        p.ai.decideT = D.decide + Math.floor(rand(0, 7));
        const range = p.role === 'FWD' ? 300 : p.role === 'MID' ? 270 : 190;
        const sideOk = Math.abs(p.y - MIDY) < Math.abs(gx - p.x) * 1.6 + 50;
        if (dGoal < range && sideOk && p.ai.holdT > 5) {
          const lane = laneClear(b.x, b.y, gx, MIDY, T.opp.players, true);
          if (dGoal < 150 || lane > 22 || Math.random() < 0.22) { aiShoot(p, dGoal); return; }
        }
        const req = T.passRequest && T.passRequest.by !== p ? T.passRequest.by : null;
        if (req && p.ai.holdT > 4 && laneClear(b.x, b.y, req.x, req.y, T.opp.players, false) > 16) {
          passTo(p, req);
          return;
        }
        const bp = bestPass(p);
        const pressured = near < 44;
        if (bp && ((pressured && bp.score > -60) || (p.ai.holdT > 26 && bp.score > 55) || (p.ai.holdT > 80 && bp.score > -10))) {
          passTo(p, bp.p);
          return;
        }
        if (pressured && Math.abs(p.x - ownGoalX(T)) < 260) {
          // Under the cosh near our own goal: get rid.
          boot(p, frameX(T, PW * 0.7), clamp(p.y + rand(-140, 140), 60, PH - 60), 0.8);
          return;
        }
      }

      // Dribble at goal, slipping round anyone in the way.
      let dx = gx - p.x, dy = (MIDY - p.y) * 0.7;
      let l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      let ax = dx, ay = dy;
      for (const o of T.opp.players) {
        const rx = o.x - p.x, ry = o.y - p.y, d = Math.hypot(rx, ry);
        if (d > 110 || d < 0.1) continue;
        const ahead = (rx * dx + ry * dy) / d;
        if (ahead < 0.15) continue;
        const side = Math.sign(dx * ry - dy * rx) || 1;
        const w = ((110 - d) / 110) * 1.5 * ahead;
        ax += dy * side * w;
        ay += -dx * side * w;
      }
      if (p.y < 60) ay += (60 - p.y) / 40;
      if (p.y > PH - 60) ay -= (p.y - (PH - 60)) / 40;
      l = Math.hypot(ax, ay) || 1;
      const spd = p.maxSpeed * p.speedMul * 0.9;
      p.dvx = (ax / l) * spd;
      p.dvy = (ay / l) * spd;
    }

    function aiShoot(p, dGoal) {
      const gk = p.team.opp.players.find((q) => q.role === 'GK');
      const side = gk ? (gk.y < MIDY ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
      const aim = side * rand(0.4, 0.95);
      const power = dGoal < 160 ? rand(0.35, 0.68) : rand(0.55, 0.9);
      shoot(p, power, aim);
    }

    function aiKeeperHold(p) {
      const T = p.team;
      p.dvx = p.dvy = 0;
      if (p.ai.holdT < 60 + (p.ai.holdWait || 0)) return;
      const bp = bestPass(p);
      if (bp && bp.score > -40 && Math.random() < 0.75) passTo(p, bp.p);
      else {
        const fwd = T.players.find((q) => q.role === 'FWD');
        boot(p, fwd ? fwd.x : frameX(T, PW * 0.65), fwd ? fwd.y : MIDY, 1);
      }
      p.ai.holdWait = Math.floor(rand(0, 40));
    }

    function aiKeeper(p) {
      const T = p.team, b = m.ball, D = T.diff;
      if (p.state !== 'normal') return;
      const gx = ownGoalX(T);
      const owner = b.owner && b.owner.kind === 'player' ? b.owner : null;

      // A shot or fast ball heading for goal.
      const toward = -T.dir * b.vx;
      if (!owner && toward > 2 && Math.hypot(b.vx, b.vy) > 6 && m.phase === 'play') {
        const tCross = (gx - b.x) / b.vx;
        if (tCross > 0 && tCross < 70) {
          const yCross = b.y + b.vy * tCross;
          if (Math.abs(yCross - MIDY) < C.GOAL_W / 2 + 30) {
            if (p.ai.seenShot < 0) {
              // Each shot gets its own reaction time, and sometimes the
              // keeper reads it wrong: that is what makes saves exciting.
              p.ai.seenShot = m.t;
              p.ai.react = D.gkReact + Math.floor(rand(0, 7));
              p.ai.wrongWay = Math.random() < D.gkGuess;
            }
            if (m.t - p.ai.seenShot >= p.ai.react) {
              let ty = clamp(yCross, GOAL_TOP - 6, GOAL_BOT + 6);
              if (p.ai.wrongWay) ty = p.y - (ty - p.y);
              if (!p.ai.dived && Math.abs(ty - p.y) > 15 * p.reachMul && tCross < 24) startDive(p, ty);
              else go(p, gx + T.dir * 10, ty, 1.1);
            } else p.dvx = p.dvy = 0;
            return;
          }
        }
      } else {
        p.ai.seenShot = -1;
        if (!b.shot) p.ai.dived = false;
      }

      // Claim loose balls in the box.
      if (!owner && m.phase === 'play' && inBox(T, b.x, b.y, -4) && b.z < 40) {
        const mine = intercept(p);
        const rival = T.chaseInfo ? T.chaseInfo.k : 999;
        if (mine.k <= rival + 6) return go(p, mine.x, mine.y, 1.05);
      }

      // Come out to smother a 1v1 inside the box.
      if (owner && owner.team !== T && inBox(T, owner.x, owner.y) && Math.abs(owner.x - gx) < 150) {
        go(p, owner.x, owner.y, 1.05);
        if (dist(p.x, p.y, b.x, b.y) < 26 && Math.random() < 0.08 * D.gkSkill) claimFromFeet(p, owner);
        return;
      }

      // Positioning: on the arc between ball and goal centre.
      const dx = b.x - gx, dy = b.y - MIDY, d = Math.hypot(dx, dy) || 1;
      const out = Math.min(48, 14 + d * 0.05);
      let tx = gx + (dx / d) * out;
      let ty = MIDY + (dy / d) * out * 1.4;
      ty = clamp(ty, GOAL_TOP + 10, GOAL_BOT - 10);
      if (T.dir > 0) tx = clamp(tx, 8, 64); else tx = clamp(tx, PW - 64, PW - 8);
      go(p, tx, ty, 0.85);
    }

    // Keeper dives at the feet: wins it unless the attacker is quick.
    function claimFromFeet(p, owner) {
      const b = m.ball;
      owner.stun = 24;
      b.owner = p;
      b.hands = true;
      b.last = p;
      b.shot = null;
      p.ai.holdT = 0;
      m.lastTouchT = m.t;
      m.stats.saves++;
      emit('save', { by: p, catch: true });
    }

    function aiOffBall(p) {
      const T = p.team, b = m.ball;
      if (p.role === 'GK') return aiKeeper(p);
      if (m.phase === 'kickoff') { p.dvx = p.dvy = 0; return; }
      if (m.phase === 'out') return aiOut(p);

      if (T.chaser === p) return go(p, T.chaseInfo.x, T.chaseInfo.y, 1);

      const owner = b.owner && b.owner.kind === 'player' ? b.owner : null;
      if (owner && owner.team !== T) {
        if (b.hands) {
          // Let the keeper distribute: drop off out of the box.
          const f = formTarget(p, false);
          if (inBox(T.opp, f.x, f.y, 20)) f.x = frameX(T.opp, C.BOX_D + 40);
          return go(p, f.x, f.y, 0.7);
        }
        if (T.presser === p) {
          // Close down from the goal side, then lunge once in range.
          const side = Math.sign(ownGoalX(T) - b.x) || 1;
          go(p, b.x + side * 6, b.y, 1);
          if (dist(p.x, p.y, b.x, b.y) < 36 && Math.random() < T.diff.press) startTackle(p);
          return;
        }
        if (p.ai.mark) {
          const o = p.ai.mark, og = ownGoalX(T);
          const dx = og - o.x, dy = MIDY - o.y, d = Math.hypot(dx, dy) || 1;
          return go(p, o.x + (dx / d) * 42, o.y + (dy / d) * 42, 0.95);
        }
        const f = formTarget(p, false);
        return go(p, f.x, f.y, 0.75);
      }
      if (owner && owner.team === T) {
        const f = supportTarget(p);
        return go(p, f.x, f.y, dist(p.x, p.y, f.x, f.y) > 120 ? 1 : 0.75);
      }
      const f = formTarget(p, false);
      go(p, f.x, f.y, 0.75);
    }

    function aiOut(p) {
      const o = m.out, T = p.team;
      if (o.receiver === p) {
        const sp = receiveSpot(p);
        return go(p, sp.x, sp.y, 1);
      }
      const f = formTarget(p, o.award === T);
      if (o.receiver && T !== o.award) {
        const sp = receiveSpot(o.receiver);
        const d = dist(f.x, f.y, sp.x, sp.y);
        if (d < 80 && d > 0.1) { f.x += ((f.x - sp.x) / d) * (80 - d); f.y += ((f.y - sp.y) / d) * (80 - d); }
      }
      go(p, f.x, f.y, 0.8);
    }

    function aiCelebrate(p) {
      const g = m.lastGoal;
      if (!g) { p.dvx = p.dvy = 0; return; }
      if (p.team.id === g.team) {
        const scorer = m.players.find((q) => q.kid.id === g.byId && q.team.id === g.team && !g.own);
        let tx, ty;
        if (!scorer || scorer === p) {
          tx = oppGoalX(p.team) - p.team.dir * 70;
          ty = p.y < MIDY ? 50 : PH - 50;
        } else { tx = scorer.x - p.team.dir * 24; ty = scorer.y + (p.role === 'GK' ? 0 : 20); }
        if (p.role === 'GK') { tx = ownGoalX(p.team) + p.team.dir * 70; ty = MIDY; }
        go(p, tx, ty, 0.9);
        p.celebrate = true;
      } else {
        const f = formTarget(p, false);
        go(p, f.x, f.y, 0.4);
      }
    }

    // --------------------------------------------------------------- human

    function humanControl(p, inp) {
      const b = m.ball;
      const hasBall = b.owner === p;

      if (p.state === 'normal') {
        let spd = p.maxSpeed * (hasBall ? 0.9 : 1);
        if (p.charging) spd *= 0.62;
        p.dvx = inp.mx * spd;
        p.dvy = inp.my * spd;
      }
      if (m.phase === 'kickoff') {
        if (m.phaseT < KO_FREEZE || !hasBall) { p.dvx = p.dvy = 0; return; }
        if (Math.hypot(inp.mx, inp.my) > 0.3) { m.phase = 'play'; m.phaseT = 0; }
        else if (m.phaseT > KO_FREEZE + 420) { passTo(p, p.team.players.find((q) => q.role === 'MID')); return; }
      }

      // Shoot: hold to charge, release to strike. A quick tap is a firm side-foot.
      if (inp.shootDown) {
        if (hasBall) { p.charging = true; p.chargeT = 0; p.charge = 0; }
        else p.buffer.shot = 14;
      }
      if (p.charging) {
        if (b.owner !== p) p.charging = false;
        else {
          p.chargeT++;
          p.charge = Math.min(1, p.chargeT / CHARGE_T);
          if (inp.shootUp || p.chargeT > CHARGE_T + 24) {
            const power = p.chargeT < 7 ? 0.55 : p.charge;
            if (b.hands) {
              const ax = Math.abs(inp.mx) > 0.2 || Math.abs(inp.my) > 0.2 ? p.x + inp.mx * 400 : frameX(p.team, PW * 0.66);
              const ay = Math.abs(inp.mx) > 0.2 || Math.abs(inp.my) > 0.2 ? p.y + inp.my * 400 : MIDY;
              boot(p, clamp(ax, 20, PW - 20), clamp(ay, 20, PH - 20), 0.4 + power * 0.6);
            } else shoot(p, power, humanAim());
            p.charging = false;
          }
        }
      }

      if (inp.pass) {
        if (hasBall) {
          const r = pickPassTarget(p, inp.mx, inp.my);
          if (r) passTo(p, r);
        } else if (b.owner && b.owner.kind === 'player' && b.owner.team === p.team) {
          p.team.passRequest = { by: p, t: 50 };
          emit('call', { by: p });
        } else p.buffer.pass = 14;
      }

      if (inp.tackle && !hasBall) {
        if (p.role === 'GK' && inBox(p.team, p.x, p.y, 10)) {
          let ty;
          if (Math.abs(inp.my) > 0.3) ty = p.y + Math.sign(inp.my) * 60;
          else {
            const t = b.vx !== 0 ? (ownGoalX(p.team) - b.x) / b.vx : -1;
            ty = t > 0 && t < 80 ? b.y + b.vy * t : b.y;
          }
          startDive(p, ty);
        } else startTackle(p);
      }

      // A keeper can't sit on the ball forever: after 8s it is thrown out.
      if (hasBall) p.ai.holdT++;
      if (b.hands && hasBall && p.ai.holdT > 480) {
        const bp = bestPass(p);
        if (bp) passTo(p, bp.p);
        else boot(p, frameX(p.team, PW * 0.65), MIDY, 0.8);
      }
    }

    // ------------------------------------------------------------ physics

    function setView(p) {
      const ax = Math.abs(p.fx), ay = Math.abs(p.fy);
      if (ax > ay * 0.9) { p.facing = 'side'; p.flip = p.fx < 0; }
      else p.facing = p.fy > 0 ? 'down' : 'up';
    }

    function movePlayer(p) {
      const b = m.ball;
      if (p.kickCd > 0) p.kickCd--;
      if (p.tackleCd > 0) p.tackleCd--;
      if (p.touchCd > 0) p.touchCd--;
      if (p.kickT > 0) p.kickT--;
      if (p.throwT > 0) p.throwT--;
      if (p.buffer.shot > 0) p.buffer.shot--;
      if (p.buffer.pass > 0) p.buffer.pass--;
      if (p.stun > 0) { p.stun--; p.dvx *= 0.3; p.dvy *= 0.3; }

      if (p.state === 'tackle') {
        p.vx *= 0.9; p.vy *= 0.9;
        if (!p.tackleDone) resolveTackle(p);
        if (--p.stateT <= 0) { p.state = 'normal'; if (!p.tackleDone) p.stun = 10; }
      } else if (p.state === 'dive') {
        p.vy *= 0.9; p.vx *= 0.85;
        p.z = Math.sin((1 - p.stateT / 26) * Math.PI) * 10;
        if (--p.stateT <= 0) { p.state = 'down'; p.stateT = 22; p.z = 0; }
      } else if (p.state === 'down') {
        p.vx *= 0.7; p.vy *= 0.7;
        if (--p.stateT <= 0) p.state = 'normal';
      } else {
        const a = p.accel;
        p.vx += (p.dvx - p.vx) * a;
        p.vy += (p.dvy - p.vy) * a;
      }
      p.x += p.vx;
      p.y += p.vy;

      // Keepers holding the ball stay in their box; everyone stays near the pitch.
      if (b.owner === p && b.hands) {
        if (p.team.dir > 0) p.x = clamp(p.x, 10, C.BOX_D - 4); else p.x = clamp(p.x, PW - C.BOX_D + 4, PW - 10);
        p.y = clamp(p.y, MIDY - C.BOX_W / 2 + 4, MIDY + C.BOX_W / 2 - 4);
      }
      p.x = clamp(p.x, -16, PW + 16);
      p.y = clamp(p.y, -18, PH + 18);

      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.35 && p.state === 'normal') {
        const tx = p.vx / sp, ty = p.vy / sp;
        const k = b.owner === p ? p.turn : 0.4;
        p.fx += (tx - p.fx) * k; p.fy += (ty - p.fy) * k;
        const l = Math.hypot(p.fx, p.fy) || 1;
        p.fx /= l; p.fy /= l;
      }
      p.run = Math.min(1, sp / 2.2);
      p.phase += sp * 0.32;

      if (p.state === 'tackle') p.pose = 'tackle';
      else if (p.state === 'dive') p.pose = 'dive';
      else if (p.state === 'down') p.pose = 'down';
      else if (p.kickT > 0) p.pose = 'kick';
      else if (p.throwT > 0) p.pose = 'throw';
      else if (p.stun > 0) p.pose = 'stun';
      else if (p.celebrate) p.pose = 'celebrate';
      else p.pose = sp > 0.3 ? 'run' : 'idle';
      p.poseT = p.kickT > 0 ? 1 - p.kickT / 14 : 0;
      setView(p);
    }

    function resolveTackle(p) {
      const b = m.ball;
      const tx = p.x + p.tdx * 10, ty = p.y + p.tdy * 10;
      if (dist(tx, ty, b.x, b.y) > 19 || b.z > 14) return;
      const c = b.owner;
      if (!c) {
        if (b.inThrow && b.z > 10) return;
        p.tackleDone = true;
        take(p);
        return;
      }
      if (c.kind !== 'player' || c.team === p.team || b.hands) return;
      p.tackleDone = true;
      m.stats.tackles++;
      const base = p.human ? 0.6 : p.team.diff.tackle;
      const prob = clamp(base + (p.stats.strength - c.stats.strength) / 160, 0.15, 0.9);
      if (Math.random() < prob) {
        c.stun = 26;
        c.charging = false;
        b.owner = null;
        b.last = p;
        if (Math.random() < 0.55) take(p);
        else {
          b.vx = p.tdx * 3.4 + rand(-1, 1);
          b.vy = p.tdy * 3.4 + rand(-1, 1);
          m.lastTouchT = m.t;
        }
        emit('tackle', { by: p, won: true });
      } else {
        p.stun = 22;
        emit('tackle', { by: p, won: false });
      }
    }

    function separate() {
      const P = m.players;
      for (let i = 0; i < P.length; i++) {
        for (let j = i + 1; j < P.length; j++) {
          const a = P[i], c = P[j];
          const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
          const min = C.PR * 1.7;
          if (d < min && d > 0.01) {
            const push = (min - d) / 2;
            a.x -= (dx / d) * push; a.y -= (dy / d) * push;
            c.x += (dx / d) * push; c.y += (dy / d) * push;
          }
        }
      }
    }

    function carryBall() {
      const b = m.ball, p = b.owner;
      if (!p || p.kind !== 'player') return;
      b.px = b.x; b.py = b.y;
      if (b.hands) {
        b.x = p.x + p.fx * 5;
        b.y = p.y + Math.max(0, p.fy) * 2 + 1;
        b.z = 21 * p.kid.height;
      } else {
        const sp = Math.hypot(p.vx, p.vy);
        const off = C.PR + 3 + Math.sin(p.phase * 1.5) * 1.6 * Math.min(1, sp / 2);
        b.x = p.x + p.fx * off;
        b.y = p.y + p.fy * off;
        b.z = 0;
      }
      b.vx = p.vx; b.vy = p.vy; b.vz = 0;
    }

    function ballPhysics() {
      const b = m.ball;
      b.px = b.x; b.py = b.y;
      const outside = m.phase === 'out';
      b.x += b.vx; b.y += b.vy; b.z += b.vz;
      if (b.z > 0 || b.vz > 0) b.vz -= G;
      if (b.z <= 0) {
        b.z = 0;
        if (b.vz < 0) {
          const hit = -b.vz;
          b.vz = hit * 0.42;
          if (b.vz < 0.9) b.vz = 0;
          if (hit > 2.5) emit('bounce', { v: hit });
        }
      }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        let ns = b.z < 0.5 ? Math.max(0, sp * (1 - FR_K) - FR_C) : sp * AIR;
        if (outside) ns *= 0.93;
        b.vx *= ns / sp; b.vy *= ns / sp;
      }
      if (outside) {
        // Advertising boards stop the ball at the track.
        if (b.x < TX0 + 4) { b.x = TX0 + 4; b.vx = Math.abs(b.vx) * 0.2; }
        if (b.x > TX1 - 4) { b.x = TX1 - 4; b.vx = -Math.abs(b.vx) * 0.2; }
        if (b.y < TY0 - 6) { b.y = TY0 - 6; b.vy = Math.abs(b.vy) * 0.2; }
        if (b.y > TY1 + 6) { b.y = TY1 + 6; b.vy = -Math.abs(b.vy) * 0.2; }
      }
      if (b.net) {
        // Inside the goal: the net soaks the ball up.
        const inLeft = b.x < PW / 2;
        const back = inLeft ? -C.GOAL_D + C.BALL_R : PW + C.GOAL_D - C.BALL_R;
        if (inLeft ? b.x < back : b.x > back) { b.x = back; b.vx *= -0.15; b.vy *= 0.5; b.vz *= 0.3; emit('net', {}); }
        if (b.y < GOAL_TOP + C.BALL_R) { b.y = GOAL_TOP + C.BALL_R; b.vy = Math.abs(b.vy) * 0.2; }
        if (b.y > GOAL_BOT - C.BALL_R) { b.y = GOAL_BOT - C.BALL_R; b.vy = -Math.abs(b.vy) * 0.2; }
        if (b.z > C.BAR - 6) { b.z = C.BAR - 6; b.vz = -Math.abs(b.vz) * 0.2; }
      }
    }

    function goalFrame() {
      const b = m.ball;
      if (b.net || b.owner) return;
      for (const gx of [0, PW]) {
        for (const py of [GOAL_TOP, GOAL_BOT]) {
          if (b.z > C.BAR + 2) continue;
          const dx = b.x - gx, dy = b.y - py, d = Math.hypot(dx, dy), rr = C.BALL_R + 3;
          if (d < rr && d > 0.01) {
            const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
              b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny;
              b.x = gx + nx * rr; b.y = py + ny * rr;
              m.stats.posts++;
              emit('post', {});
            }
          }
        }
        const crossed = (b.px - gx) * (b.x - gx) < 0;
        if (crossed && b.y > GOAL_TOP && b.y < GOAL_BOT && Math.abs(b.z - C.BAR) < 4) {
          b.x = b.px; b.vx = -b.vx * 0.5; b.vz = -Math.abs(b.vz) * 0.4 - 0.4;
          m.stats.posts++;
          emit('post', { bar: true });
        }
      }
    }

    function spinBall() {
      const b = m.ball;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0.05 && !b.hands && !(b.owner && b.owner.kind === 'ballboy')) {
        SK.art.spin(b.spin, -b.vy / sp, b.vx / sp, 0, sp / C.BALL_R);
      }
    }

    // ------------------------------------------------------------ contacts

    function keeperReach(p, b) {
      if (p.role !== 'GK' || !inBox(p.team, p.x, p.y, 12) || !inBox(p.team, b.x, b.y, 8)) return false;
      if (p.state === 'dive') {
        if (b.z > 40) return false;
        const L = 24 * p.reachMul;
        const ex = p.x, ey = p.y + p.diveDir * L;
        const t = clamp(((b.x - p.x) * (ex - p.x) + (b.y - p.y) * (ey - p.y)) / (L * L), 0, 1);
        return dist(b.x, b.y, p.x + (ex - p.x) * t, p.y + (ey - p.y) * t) < 13 * p.reachMul + C.BALL_R;
      }
      if (p.state !== 'normal' || p.stun > 0) return false;
      return b.z < 52 * p.kid.height && dist(b.x, b.y, p.x, p.y) < 18 * p.reachMul + C.BALL_R;
    }

    function contacts() {
      const b = m.ball;
      if (b.owner || m.phase === 'out' || m.phase === 'goal' || m.phase === 'fulltime') return;
      // Keepers first: hands win a race to the ball.
      for (const p of m.players) {
        if (p.role !== 'GK' || p.touchCd > 0 || p.kickCd > 0) continue;
        if (!keeperReach(p, b)) continue;
        const spd = Math.hypot(b.vx, b.vy, b.vz * 0.5);
        const skill = p.human ? 1 : p.team.diff.gkSkill;
        const wasShot = !!b.shot && b.shot.team !== p.team;
        if (spd < 12.5 * skill * p.reachMul + (p.state === 'dive' ? 0 : 2)) {
          b.owner = p; b.hands = true; b.last = p; b.shot = null; b.passTo = null; b.inThrow = false;
          b.vx = b.vy = b.vz = 0;
          p.ai.holdT = 0;
          m.lastTouchT = m.t;
          if (wasShot) { m.stats.saves++; emit('save', { by: p, catch: true }); }
          else emit('control', { by: p, hands: true });
        } else {
          // Parry: push it away from goal at a fraction of the pace.
          let nx = b.x - p.x, ny = b.y - p.y;
          const l = Math.hypot(nx, ny) || 1;
          nx = nx / l + p.team.dir * 0.9; ny = ny / l;
          const l2 = Math.hypot(nx, ny) || 1;
          const out = spd * 0.38;
          b.vx = (nx / l2) * out; b.vy = (ny / l2) * out; b.vz = 2.6;
          b.last = p; b.shot = null; b.passTo = null; b.inThrow = false;
          p.touchCd = 14;
          m.lastTouchT = m.t;
          if (wasShot) m.stats.saves++;
          emit('save', { by: p, catch: false });
        }
        return;
      }

      let best = null, bd = 1e9;
      for (const p of m.players) {
        if (p.stun > 0 || p.kickCd > 0 || p.touchCd > 0 || p.state === 'down' || p.state === 'dive') continue;
        if (b.z > 16) continue;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < CONTROL_R && d < bd) { bd = d; best = p; }
      }
      if (!best) return;
      const spd = Math.hypot(b.vx, b.vy);
      const ctrl = 8.6 + (best.stats.agility - 80) / 20 + (b.passTo === best ? 4.5 : 0) + (b.inThrow ? 6 : 0);
      if (spd <= ctrl) { take(best); return; }
      // Too hot to handle: it cannons off.
      const nx = (b.x - best.x) / (bd || 1), ny = (b.y - best.y) / (bd || 1);
      const vn = b.vx * nx + b.vy * ny;
      b.vx = (b.vx - 2 * vn * nx) * 0.45 + rand(-0.6, 0.6);
      b.vy = (b.vy - 2 * vn * ny) * 0.45 + rand(-0.6, 0.6);
      b.vz = Math.max(b.vz, 1.2);
      b.last = best; b.shot = null; b.passTo = null; b.inThrow = false;
      best.touchCd = 10;
      m.lastTouchT = m.t;
      emit('block', { by: best });
    }

    // --------------------------------------------------------------- rules

    function scoreGoal(T) {
      const b = m.ball;
      T.score++;
      const by = b.last && b.last.kind === 'player' ? b.last : null;
      const own = !!by && by.team !== T;
      const g = { team: T.id, byId: by ? by.kid.id : null, by: by ? by.kid.name : 'Unknown', own, human: !!(by && by.human), t: m.t };
      m.goals.push(g);
      m.lastGoal = g;
      b.shot = null; b.passTo = null; b.owner = null; b.hands = false; b.net = true; b.inThrow = false;
      m.phase = 'goal';
      m.phaseT = 0;
      for (const p of m.players) { p.charging = false; p.state = p.state === 'tackle' ? 'normal' : p.state; }
      emit('goal', { team: T, goal: g });
    }

    function goOut() {
      const b = m.ball;
      const exitX = b.x, exitY = b.y;
      if (b.owner && b.owner.kind === 'player') b.owner.charging = false;
      b.owner = null; b.hands = false;
      if (b.shot && b.last === b.shot.by) { m.stats.misses++; emit('miss', { by: b.shot.by }); }
      b.shot = null; b.passTo = null; b.inThrow = false;
      const last = b.last && b.last.kind === 'player' ? b.last : null;
      const award = last ? last.team.opp : (m.out && m.out.award) || pick(m.teams);
      m.out = { award, receiver: null, exitX, exitY };
      m.phase = 'out';
      m.phaseT = 0;
      m.stats.outs++;
      emit('out', { award });
    }

    function rules() {
      const b = m.ball, R = C.BALL_R;
      if (m.phase !== 'play' && m.phase !== 'kickoff') return;
      // Goals: the whole ball over the line between the posts and under the bar.
      if (b.px >= 0 && b.x < 0 && b.y > GOAL_TOP + 2 && b.y < GOAL_BOT - 2 && b.z < C.BAR - 1) {
        return scoreGoal(m.teams.find((T) => T.dir < 0));
      }
      if (b.px <= PW && b.x > PW && b.y > GOAL_TOP + 2 && b.y < GOAL_BOT - 2 && b.z < C.BAR - 1) {
        return scoreGoal(m.teams.find((T) => T.dir > 0));
      }
      if (b.inThrow) {
        const inside = b.x > 0 && b.x < PW && b.y > 0 && b.y < PH;
        if (inside || b.z <= 0) b.inThrow = false;
        else return;
      }
      if (b.x < -R || b.x > PW + R || b.y < -R || b.y > PH + R) goOut();
    }

    // ------------------------------------------------------------- update

    m.update = function (inp) {
      m.t++;
      m.phaseT++;
      m.input = inp;
      const b = m.ball;
      if (b.passT > 0 && --b.passT <= 0) b.passTo = null;

      if (m.phase === 'kickoff' && m.phaseT === KO_FREEZE) emit('whistle', { kind: 'kickoff' });

      predictBall();
      for (const T of m.teams) assign(T);

      for (const p of m.players) {
        if (m.phase === 'goal' || m.phase === 'fulltime') {
          if (p.human && m.phase === 'goal' && p.team.id !== (m.lastGoal && m.lastGoal.team)) { p.dvx = inp.mx * p.maxSpeed * 0.6; p.dvy = inp.my * p.maxSpeed * 0.6; }
          else if (m.phase === 'fulltime') { p.celebrate = m.winner === p.team; if (p.celebrate) aiCelebrate(p); else { const f = formTarget(p, false); go(p, f.x, f.y, 0.3); } }
          else aiCelebrate(p);
          continue;
        }
        if (p.human) humanControl(p, inp);
        else if (b.owner === p) aiCarrier(p);
        else aiOffBall(p);
      }

      for (const p of m.players) movePlayer(p);
      separate();
      updateBallBoy(inp);

      if (b.owner && b.owner.kind === 'player') carryBall();
      else if (!(b.owner && b.owner.kind === 'ballboy')) ballPhysics();
      if (m.phase === 'play' || m.phase === 'kickoff') goalFrame();
      spinBall();
      contacts();
      rules();

      if (b.shot && Math.hypot(b.vx, b.vy) < 2 && b.z < 1 && !b.owner) b.shot = null;

      if (m.phase === 'goal' && m.phaseT >= GOAL_PAUSE) {
        const T = m.teams.find((t) => t.id === m.lastGoal.team);
        if (T.score >= C.WIN_GOALS) {
          m.winner = T;
          m.phase = 'fulltime';
          m.phaseT = 0;
          for (const p of m.players) p.celebrate = false;
          emit('whistle', { kind: 'fulltime' });
          emit('fulltime', { winner: T });
        } else placeKickoff(T.opp);
      }

      // Safety net: if play somehow stalls for 20s, restart from the middle.
      if (m.phase === 'play' && m.t - m.lastTouchT > 60 * 20 && !b.owner) {
        m.stats.stuck++;
        emit('stuck', { x: b.x, y: b.y });
        placeKickoff(b.last && b.last.kind === 'player' ? b.last.team.opp : m.teams[0]);
      }
    };

    // ------------------------------------------------------- read helpers

    m.trackPoint = trackPoint;
    m.KO_FREEZE = KO_FREEZE;
    m.humanHasBall = () => !!m.human && m.ball.owner === m.human;

    placeKickoff(Math.random() < 0.5 ? m.teams[0] : m.teams[1]);
    return m;
  };
})();
