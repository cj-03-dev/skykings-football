/*
 * Menus: pick a kid, a club, a position, then kick off. Picking Ibrahim skips
 * club and position: he is always the ball boy and the 4v4 is all AI.
 */
(() => {
  'use strict';
  const SK = window.SK;
  const UI = (SK.ui = {});
  const $ = (id) => document.getElementById(id);
  const sel = (UI.sel = { kid: null, team: null, role: null, difficulty: 'normal', lineup: null });

  UI.isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches || 'ontouchstart' in window;

  // -------------------------------------------------------------- screens

  UI.show = function (name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    UI.current = name;
    if (SK.intro) SK.intro.setActive(name === 'title');
    requestAnimationFrame(() => paintScreen(name));
  };

  function paintScreen(name) {
    if (name === 'pick') paintKids();
    if (name === 'team') buildClubs();
    if (name === 'pos') buildPositions();
    if (name === 'setup') buildSetup();
  }

  // ---------------------------------------------------------- kid picker

  function statRow(label, v) {
    return `<span>${label}</span><i><b style="width:${v}%"></b></i><span>${v}</span>`;
  }

  function buildKids() {
    const grid = $('kidGrid');
    grid.innerHTML = '';
    for (const kid of SK.KIDS) {
      const st = SK.statsFor(kid);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.dataset.kid = kid.id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `
        <canvas aria-hidden="true"></canvas>
        <div class="name">${kid.name}</div>
        <div class="note">${kid.note}</div>
        ${kid.ballBoy
          ? '<span class="tag">BALL BOY</span><div class="note">Always the ball boy: fetch it, throw it back in.</div>'
          : `<div class="stats">${statRow('PAC', st.pace)}${statRow('SHO', st.shot)}${statRow('STR', st.strength)}${statRow('GK', st.reach)}</div>`}`;
      b.addEventListener('click', () => {
        sel.kid = kid.id;
        grid.querySelectorAll('.card').forEach((c) => { const on = c.dataset.kid === kid.id; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
        $('kidNote').innerHTML = kid.ballBoy ? `<b>${kid.name}</b>, the ball boy` : `<b>${kid.name}</b> selected`;
        $('pickNext').disabled = false;
      });
      grid.appendChild(b);
    }
  }

  function paintKids() {
    document.querySelectorAll('#kidGrid .card').forEach((card) => {
      const kid = SK.kidById(card.dataset.kid);
      SK.art.portrait(card.querySelector('canvas'), kid, kid.ballBoy ? SK.BALLBOY_KIT : SK.SKY_KIT);
    });
  }

  // ---------------------------------------------------------- club picker

  function crestImg(id, cls = 'crest') {
    return `<img class="${cls}" alt="${SK.TEAMS[id].name} crest" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(SK.art.badgeSVG(id))}">`;
  }

  function buildClubs() {
    const grid = $('clubGrid');
    grid.innerHTML = '';
    const kid = SK.kidById(sel.kid);
    for (const id of ['rma', 'fcb']) {
      const T = SK.TEAMS[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `card club ${id}` + (sel.team === id ? ' on' : '');
      b.dataset.team = id;
      b.innerHTML = `<div class="row">${crestImg(id)}<canvas aria-hidden="true"></canvas></div><div class="name">${T.name}</div>`;
      b.addEventListener('click', () => {
        sel.team = id;
        grid.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c.dataset.team === id));
        $('teamNote').innerHTML = `<b>${kid.name}</b> joins <b>${T.name}</b>`;
        $('teamNext').disabled = false;
      });
      grid.appendChild(b);
      SK.art.portrait(b.querySelector('canvas'), kid, T.kit);
    }
    $('teamNext').disabled = !sel.team;
    if (!sel.team) $('teamNote').textContent = 'Tap a club';
  }

  // ------------------------------------------------------ position picker

  const FORM = { GK: [0.05, 0.5], DEF: [0.25, 0.5], MID: [0.47, 0.36], FWD: [0.68, 0.62] };

  function miniPitch(role) {
    const dots = Object.entries(FORM).map(([r, [x, y]]) =>
      `<circle cx="${8 + x * 144}" cy="${6 + y * 78}" r="${r === role ? 7 : 4.5}" fill="${r === role ? '#ffd640' : 'rgba(255,255,255,0.45)'}"/>`).join('');
    return `<svg viewBox="0 0 160 90" aria-hidden="true">
      <rect x="0" y="0" width="160" height="90" fill="#2f8c3b"/>
      <g fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.2">
        <rect x="8" y="6" width="144" height="78"/><line x1="80" y1="6" x2="80" y2="84"/><circle cx="80" cy="45" r="11"/>
        <rect x="8" y="24" width="21" height="42"/><rect x="131" y="24" width="21" height="42"/>
      </g>${dots}
      <path d="M100 45 h28 m-6 -5 l6 5 l-6 5" stroke="rgba(255,255,255,.6)" stroke-width="1.5" fill="none"/>
    </svg>`;
  }

  function buildPositions() {
    const grid = $('posGrid');
    grid.innerHTML = '';
    const kid = SK.kidById(sel.kid);
    const T = SK.TEAMS[sel.team];
    for (const pos of SK.POSITIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card pos' + (sel.role === pos.id ? ' on' : '');
      b.dataset.role = pos.id;
      b.innerHTML = `<div class="name">${pos.name}</div>${miniPitch(pos.id)}<div class="note">${pos.blurb}</div>`;
      b.addEventListener('click', () => {
        sel.role = pos.id;
        grid.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c.dataset.role === pos.id));
        $('posNote').innerHTML = `<b>${kid.name}</b>, ${pos.name.toLowerCase()} for <b>${T.name}</b>`;
        $('posNext').disabled = false;
      });
      grid.appendChild(b);
    }
    $('posNext').disabled = !sel.role;
    if (!sel.role) $('posNote').textContent = 'Tap a position';
  }

  // ---------------------------------------------------------------- setup

  function buildSetup() {
    const bb = sel.kid === SK.BALL_BOY_ID;
    if (!sel.lineup) sel.lineup = SK.makeLineup(sel.kid, bb ? null : sel.team, bb ? null : sel.role);
    $('ballboyNote').hidden = !bb;
    $('setupStep').textContent = bb ? 'Step 2 of 2' : 'Step 4 of 4';
    $('btnShuffle').textContent = bb ? 'Shuffle line-ups' : 'Shuffle the others';
    document.querySelectorAll('#diffSeg button').forEach((x) => {
      const on = x.dataset.diff === sel.difficulty;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });

    const wrap = $('lineups');
    wrap.innerHTML = '';
    const order = bb ? ['rma', 'fcb'] : [sel.team, SK.otherTeam(sel.team)];
    for (const id of order) {
      const T = SK.TEAMS[id];
      const box = document.createElement('div');
      box.className = 'lineup';
      const mine = !bb && id === sel.team;
      box.innerHTML = `<h3>${crestImg(id, '')}${T.name}<em>${mine ? 'YOUR TEAM' : bb ? '' : 'OPPONENTS'}</em></h3><ul></ul>`;
      const ul = box.querySelector('ul');
      for (const pos of SK.POSITIONS) {
        const kid = SK.kidById(sel.lineup[id][pos.id]);
        const you = !bb && kid.id === sel.kid;
        const li = document.createElement('li');
        if (you) li.className = 'you';
        li.innerHTML = `<canvas aria-hidden="true"></canvas><b>${you ? 'YOU' : kid.name}</b><small>${pos.id}</small>`;
        ul.appendChild(li);
        li._paint = () => SK.art.portrait(li.querySelector('canvas'), kid, pos.id === 'GK' ? T.gk : T.kit, { number: pos.number });
      }
      wrap.appendChild(box);
    }
    requestAnimationFrame(() => wrap.querySelectorAll('li').forEach((li) => li._paint()));
  }

  // ---------------------------------------------------------- full time

  UI.onEvent = function (e, m) {
    if (e.type === 'fulltime') {
      setTimeout(() => {
        if (SK.game.match !== m) return;
        showFullTime(m);
      }, 2600);
    }
  };

  function showFullTime(m) {
    const W = m.winner, L = m.teams[0], Rt = m.teams[1];
    const h = m.human;
    let title;
    if (h && h.kind === 'player') title = W === h.team ? 'You win!' : 'You lose!';
    else title = `${W.def.name} win!`;
    $('fullHead').textContent = title;
    $('result').innerHTML = `${crestImg(L.id, '')}<span>${L.score} – ${Rt.score}</span>${crestImg(Rt.id, '')}`;
    // Scorers listed under their own side, with a ball per goal.
    const col = (T) => {
      const tally = new Map();
      for (const g of m.goals.filter((x) => x.team === T.id)) {
        const name = g.own ? `${g.by} (own goal)` : g.human ? 'You' : g.by;
        tally.set(name, (tally.get(name) || 0) + 1);
      }
      return `<div>${[...tally].map(([n, c]) => `<span><b>${n}</b> ${'⚽'.repeat(c)}</span>`).join('') || '<span>—</span>'}</div>`;
    };
    $('scorers').innerHTML = col(L) + col(Rt);
    SK.game.showOverlay('full');
  }

  // ----------------------------------------------------- in-match chrome

  let lastLabels = '';
  UI.frame = function (m) {
    if (!UI.isTouch) return;
    const h = m.human;
    let shoot = 'Shoot', pass = 'Pass', tackle = 'Tackle';
    if (h && h.kind === 'ballboy') { shoot = 'Throw'; pass = 'Quick'; tackle = ''; }
    else if (h) {
      const b = m.ball;
      if (b.owner === h && b.hands) { shoot = 'Kick'; pass = 'Throw'; }
      else if (b.owner && b.owner.kind === 'player' && b.owner.team === h.team && b.owner !== h) pass = 'Call';
      if (h.role === 'GK' && m.inBox(h.team, h.x, h.y, 10)) tackle = 'Save';
    }
    const key = shoot + pass + tackle;
    if (key === lastLabels) return;
    lastLabels = key;
    $('btnShoot').textContent = shoot;
    $('btnPass').textContent = pass;
    $('btnTackle').textContent = tackle;
    $('btnTackle').style.visibility = tackle ? 'visible' : 'hidden';
  };
  UI.resetLabels = () => { lastLabels = ''; };

  // ---------------------------------------------------------------- wiring

  UI.init = function () {
    buildKids();

    $('btnPlay').addEventListener('click', () => {
      SK.game.unlockAudio && SK.game.unlockAudio();
      if (SK.audio) SK.audio.uiKick();
      UI.show('pick');
    });
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => UI.show(b.dataset.back)));

    $('pickNext').addEventListener('click', () => {
      if (!sel.kid) return;
      sel.lineup = null;
      if (sel.kid === SK.BALL_BOY_ID) { sel.team = null; sel.role = null; UI.show('setup'); }
      else UI.show('team');
    });
    $('teamNext').addEventListener('click', () => { if (sel.team) { sel.lineup = null; UI.show('pos'); } });
    $('posNext').addEventListener('click', () => { if (sel.role) { sel.lineup = null; UI.show('setup'); } });
    $('setupBack').addEventListener('click', () => UI.show(sel.kid === SK.BALL_BOY_ID ? 'pick' : 'pos'));

    document.querySelectorAll('#diffSeg button').forEach((b) => b.addEventListener('click', () => {
      sel.difficulty = b.dataset.diff;
      document.querySelectorAll('#diffSeg button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', String(on));
      });
    }));
    $('btnShuffle').addEventListener('click', () => { sel.lineup = null; buildSetup(); });
    $('btnKickoff').addEventListener('click', () => SK.game.startMatch());

    $('btnPause').addEventListener('click', () => SK.game.pause(true));
    $('btnResume').addEventListener('click', () => SK.game.pause(false));
    $('btnRestart').addEventListener('click', () => SK.game.startMatch());
    $('btnQuit').addEventListener('click', () => SK.game.toMenu());
    $('btnRematch').addEventListener('click', () => SK.game.startMatch());
    $('btnNewTeams').addEventListener('click', () => { SK.game.toMenu('setup'); sel.lineup = null; UI.show('setup'); });
    $('btnMenu').addEventListener('click', () => SK.game.toMenu());
    $('rotateOk').addEventListener('click', () => { UI.rotateDismissed = true; $('rotate').hidden = true; });

    if (UI.isTouch) SK.input.bindTouch();
  };
})();
