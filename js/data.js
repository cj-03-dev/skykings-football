/*
 * SkyKings Elite Juniors: the squad, the clubs, and the numbers that tune play.
 *
 * Every script attaches to one global, window.SK, so the game runs straight
 * from index.html (file:// included) without modules or a build step.
 */
(() => {
  'use strict';
  const SK = (window.SK = window.SK || {});

  // ------------------------------------------------------------------ pitch

  SK.C = {
    PW: 1040,          // pitch length (x), goal line to goal line
    PH: 560,           // pitch width (y), touchline to touchline
    GOAL_W: 150,       // goal mouth, post to post
    GOAL_D: 34,        // net depth behind the line
    BAR: 44,           // crossbar height (ball z)
    BOX_D: 150,        // penalty area depth: the keeper's hands zone
    BOX_W: 330,
    SIX_D: 50,
    SIX_W: 210,
    CIRCLE_R: 72,
    PR: 13,            // player body radius
    BALL_R: 6,
    TRACK: 30,         // the ball boy's track sits this far outside the lines
    WIN_GOALS: 3,      // first to three wins
    TICK: 1000 / 60,
  };

  // ------------------------------------------------------------------ squad
  //
  // Heights and skin tones come straight from the brief; skin hex codes are all
  // swatches from the Genesis Rose palette, and hair uses its darkest browns.
  // `height` scales the body (1 = average); `build` widens torso and arms.

  SK.KIDS = [
    { id: 'adhrith',  name: 'Adhrith',  skin: '#c68642', height: 1.07, build: 1.0,  hair: 'crop',   hairColor: '#3c2e28', note: 'Taller than average' },
    { id: 'arhaann',  name: 'Arhaann',  skin: '#e9b78a', height: 1.10, build: 1.24, hair: 'fade',   hairColor: '#3c2e28', note: 'Tall and muscular' },
    { id: 'divyansh', name: 'Divyansh', skin: '#c5845c', height: 1.00, build: 1.0,  hair: 'spiky',  hairColor: '#4b3932', note: 'Normal height' },
    { id: 'ibrahim',  name: 'Ibrahim',  skin: '#f1c27d', height: 0.86, build: 1.0,  hair: 'swoosh', hairColor: '#3c2e28', note: 'Short, shades on', sunglasses: true, ballBoy: true },
    { id: 'niteesh',  name: 'Niteesh',  skin: '#e0ac69', height: 1.10, build: 1.0,  hair: 'side',   hairColor: '#3c2e28', note: 'Taller' },
    { id: 'reyansh',  name: 'Reyansh',  skin: '#f1c27d', height: 0.88, build: 1.0,  hair: 'curly',  hairColor: '#593b2b', note: 'Short' },
    { id: 'shaurya',  name: 'Shaurya',  skin: '#ffdbac', height: 1.12, build: 1.0,  hair: 'crop',   hairColor: '#4b3932', note: 'Tall, wears the golden crown', crown: true },
    { id: 'shreyas',  name: 'Shreyas',  skin: '#785c50', height: 1.00, build: 1.0,  hair: 'curly',  hairColor: '#3c2e28', note: 'Average height' },
    { id: 'advaith',  name: 'Advaith',  skin: '#d2a18c', height: 1.05, build: 1.0,  hair: 'swoosh', hairColor: '#593b2b', note: 'Above average height' },
  ];

  SK.kidById = (id) => SK.KIDS.find((k) => k.id === id);
  SK.BALL_BOY_ID = 'ibrahim';

  // Card stats follow from build: short kids are nippier, tall kids hit
  // harder and reach further in goal. Kept within a narrow band so every
  // pick is viable in every position.
  SK.statsFor = (kid) => {
    const h = kid.height, m = kid.build - 1;
    const r = (v) => Math.round(Math.max(40, Math.min(99, v)));
    return {
      pace: r(80 + (1.12 - h) * 25 - m * 8),
      agility: r(70 + (1.12 - h) * 90 - m * 10),
      shot: r(70 + (h - 0.86) * 45 + m * 36),
      strength: r(64 + (h - 0.86) * 70 + m * 40),
      reach: r(60 + (h - 0.86) * 110),
    };
  };

  // ------------------------------------------------------------------ clubs

  SK.TEAMS = {
    rma: {
      id: 'rma', name: 'Real Madrid', short: 'RMA',
      color: '#f4f4f6', accent: '#d4af37', ink: '#2b2a6b',
      kit: { shirt: '#f7f7f9', stripe: null, trim: '#d4af37', shorts: '#f7f7f9', socks: '#f7f7f9', number: '#c9a227', sleeve: '#2b2a6b' },
      gk: { shirt: '#23232b', stripe: null, trim: '#d4af37', shorts: '#23232b', socks: '#23232b', number: '#d4af37', sleeve: '#d4af37' },
    },
    fcb: {
      id: 'fcb', name: 'FC Barcelona', short: 'FCB',
      color: '#a50044', accent: '#edbb00', ink: '#004d98',
      kit: { shirt: '#a50044', stripe: '#004d98', trim: '#edbb00', shorts: '#004d98', socks: '#a50044', number: '#edbb00', sleeve: '#004d98' },
      gk: { shirt: '#e9f23a', stripe: null, trim: '#1d1d1d', shorts: '#e9f23a', socks: '#e9f23a', number: '#1d1d1d', sleeve: '#1d1d1d' },
    },
  };
  SK.otherTeam = (id) => (id === 'rma' ? 'fcb' : 'rma');

  // Training kit for the character picker, before a club is chosen.
  SK.SKY_KIT = { shirt: '#3aa7e8', stripe: null, trim: '#ffd23f', shorts: '#14213d', socks: '#3aa7e8', number: '#ffd23f', sleeve: '#ffd23f' };
  // Ibrahim's ball boy tracksuit and bib.
  SK.BALLBOY_KIT = { shirt: '#ff6b1a', stripe: null, trim: '#1c2541', shorts: '#1c2541', socks: '#1c2541', number: '#1c2541', sleeve: '#1c2541', bib: true };

  // -------------------------------------------------------------- positions

  SK.POSITIONS = [
    { id: 'GK',  name: 'Goalkeeper', number: '1', blurb: 'Hands in your own box. Save, then throw it long.' },
    { id: 'DEF', name: 'Defender',   number: '5', blurb: 'Stay goal-side, time your tackles.' },
    { id: 'MID', name: 'Midfielder', number: '8', blurb: 'Link play, pick passes, shoot from range.' },
    { id: 'FWD', name: 'Forward',    number: '9', blurb: 'Lead the line and finish chances.' },
  ];
  SK.ROLES = SK.POSITIONS.map((p) => p.id);

  // ------------------------------------------------------------ difficulty
  //
  // Applies to the opposition (both sides when you are the ball boy). Your own
  // AI teammates always play at the "mate" level.

  SK.DIFFICULTY = {
    easy:   { id: 'easy',   label: 'Easy',   speed: 0.88, decide: 18, aimErr: 44, tackle: 0.34, press: 0.025, gkReact: 11, gkGuess: 0.3, gkSkill: 0.82, passErr: 0.16 },
    normal: { id: 'normal', label: 'Normal', speed: 0.96, decide: 12, aimErr: 30, tackle: 0.5,  press: 0.04,  gkReact: 6, gkGuess: 0.14, gkSkill: 0.93, passErr: 0.10 },
    hard:   { id: 'hard',   label: 'Hard',   speed: 1.03, decide: 7,  aimErr: 24, tackle: 0.64, press: 0.06,  gkReact: 4, gkGuess: 0.06, gkSkill: 1.0,  passErr: 0.06 },
  };
  SK.MATE = { id: 'mate', label: 'Mate', speed: 0.97, decide: 11, aimErr: 30, tackle: 0.52, press: 0.04, gkReact: 6, gkGuess: 0.14, gkSkill: 0.94, passErr: 0.09 };

  // -------------------------------------------------------------- helpers

  SK.util = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    rand: (a, b) => a + Math.random() * (b - a),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    gauss() {
      let u = 0, v = 0;
      while (!u) u = Math.random();
      while (!v) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };

  // Builds both line-ups. The chosen kid takes the chosen club and position;
  // the other seven outfield kids fill the remaining seven slots at random.
  // Picking Ibrahim (always the ball boy) randomises all eight.
  SK.makeLineup = (humanKid, humanTeam, humanRole) => {
    const pool = SK.KIDS.filter((k) => !k.ballBoy && k.id !== humanKid).map((k) => k.id);
    const kids = SK.util.shuffle(pool);
    const lineup = { rma: {}, fcb: {} };
    for (const team of ['rma', 'fcb']) {
      for (const role of SK.ROLES) {
        if (team === humanTeam && role === humanRole) lineup[team][role] = humanKid;
        else lineup[team][role] = kids.pop();
      }
    }
    return lineup;
  };
})();
