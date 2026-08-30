// 甲子園2026 出身地マップ。data.js（選手）と map.js（都道府県の形）を読んで描く。
'use strict';

const $  = (s) => document.querySelector(s);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const P = DATA.players, S = DATA.schools, PREFS = DATA.prefs.map(p => p.name);

/* ── 経緯度 → 画面座標。map.js を作ったときと同じウェブメルカトル ───────── */
function xy(lat, lon) {
  const my = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
  return [(lon - MAP.proj.x0) * MAP.proj.scale, (MAP.proj.y1 - my) * MAP.proj.scale];
}

/* 選手の出発点。中学チームの所在地が分からない人は中学校の所在地で代える。 */
const start = (p) => (p.tlat != null ? [p.tlat, p.tlon] : (p.mlat != null ? [p.mlat, p.mlon] : null));
const goal  = (p) => [S[p.s].lat, S[p.s].lon];

const state = { metric: 'm', school: -1, pref: null, player: null, tab: 'map', k: 1 };
const RAMP = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7']
  .map(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
const EMPTY = getComputedStyle(document.documentElement).getPropertyValue('--s0').trim();

/* ── 集計 ─────────────────────────────────────────────── */
const shown = () => state.school < 0 ? P : P.filter(p => p.s === state.school);
const prefOf = (p) => state.metric === 'm' ? p.mpref : p.tpref;

function tally(list, key) {
  const m = new Map();
  for (const p of list) m.set(key(p), (m.get(key(p)) || 0) + 1);
  return m;
}

/** 1〜max を段に割る。対数だと上が潰れて大阪と北海道が同じ色になるので、
 *  平方根で刻む。下の段を細かく、上の段を粗くしつつ、最上段は潰さない。 */
function steps(max) {
  if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const v = Math.max(1, Math.round(max * Math.pow(i / 7, 2)));
    if (!out.includes(v)) out.push(v);
  }
  out[out.length - 1] = max;
  return out;
}

/* ── 地図 ─────────────────────────────────────────────── */
const svg = $('#svg');
const NS = 'http://www.w3.org/2000/svg';
let flowLayer, zoomG;
const schoolDots = [];   // 49校の下地。寄せると太るので倍率に合わせて縮める

/** 指定の範囲が画面いっぱいになるまで地図を寄せて、その倍率を返す。
 *  倍率は印の大きさを決めるのにも使う（寄せたぶんだけ印を小さく描く）。 */
function zoomTo(x1, y1, x2, y2, pad) {
  // 余白は道のりの長さに合わせる。固定値だと近い県どうしのときに寄りきらない。
  // 下限を大きく取ると、同じ市どうしの道のりのときに余白ばかりになって寄りきらない。
  if (pad == null) pad = Math.max(Math.hypot(x2 - x1, y2 - y1) * 0.55, 8);
  const bw = Math.abs(x2 - x1) + pad * 2, bh = Math.abs(y2 - y1) + pad * 2;
  // 印と弧の大きさは下で倍率で割るので、寄せても丸が肥大しない。
  // 浦添 → 那覇のように 10km も離れていない道のりでも見えるところまで寄せる。
  const k = Math.min(MAP.w / bw, MAP.h / bh, 20);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  zoomG.style.transform =
    `translate(${MAP.w / 2 - cx * k}px, ${MAP.h / 2 - cy * k}px) scale(${k})`;
  state.k = k;
  // ぼかしもユーザー座標で効く。倍率のぶん絞らないと拡大時に白い霞になる。
  const blur = svg.querySelector('#glow feGaussianBlur');
  if (blur) blur.setAttribute('stdDeviation', (3 / k).toFixed(3));
  for (const c of schoolDots) c.setAttribute('r', 2.2 / k);
  return k;
}
const zoomReset = () => {
  zoomG.style.transform = ''; state.k = 1;
  const blur = svg.querySelector('#glow feGaussianBlur');
  if (blur) blur.setAttribute('stdDeviation', 3);
  for (const c of schoolDots) c.setAttribute('r', 2.2);
};

function buildMap() {
  svg.setAttribute('viewBox', `0 0 ${MAP.w} ${MAP.h}`);
  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML =
    `<linearGradient id="g-flow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0">
       <stop offset="0"   stop-color="#199e70"/>
       <stop offset=".55" stop-color="#3987e5"/>
       <stop offset="1"   stop-color="#cde2fb"/>
     </linearGradient>
     <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
       <feGaussianBlur stdDeviation="3" result="b"/>
       <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
     </filter>`;
  svg.appendChild(defs);
  zoomG = document.createElementNS(NS, 'g');
  zoomG.setAttribute('id', 'zoomG');
  zoomG.style.transformOrigin = '0 0';
  zoomG.style.transition = 'transform .9s cubic-bezier(.22,.61,.36,1)';
  svg.appendChild(zoomG);
  for (const name of PREFS) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', MAP.path[name]);
    path.setAttribute('class', 'pref');
    path.dataset.pref = name;
    path.addEventListener('click', () => selectPref(name));
    path.addEventListener('pointerenter', (e) => showTip(e, name));
    path.addEventListener('pointermove', (e) => moveTip(e));
    path.addEventListener('pointerleave', hideTip);
    zoomG.appendChild(path);
  }
  // 49校の位置をうっすら置いておく。どこの高校が出ているかの下地になる。
  const marks = document.createElementNS(NS, 'g');
  marks.setAttribute('class', 'node');
  for (const s of S) {
    const [x, y] = xy(s.lat, s.lon);
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 2.2);
    c.setAttribute('fill', '#0d1117'); c.setAttribute('opacity', .55);
    marks.appendChild(c);
    schoolDots.push(c);
  }
  zoomG.appendChild(marks);
  flowLayer = document.createElementNS(NS, 'g');
  zoomG.appendChild(flowLayer);
}

let counts = new Map();
function paintMap() {
  counts = tally(shown(), prefOf);
  const max = Math.max(1, ...counts.values());
  const cuts = steps(max);
  for (const path of svg.querySelectorAll('.pref')) {
    const n = counts.get(path.dataset.pref) || 0;
    path.setAttribute('fill', n === 0 ? EMPTY : RAMP[Math.min(6, cuts.findIndex(c => n <= c))]);
    path.classList.toggle('on', path.dataset.pref === state.pref);
  }
  // 凡例
  const lg = $('#legend'); lg.innerHTML = '';
  const add = (color, label) => {
    const i = el('i'); i.style.background = color; lg.appendChild(i);
    const s = el('span'); s.textContent = label; lg.appendChild(s);
  };
  add(EMPTY, '0');
  let lo = 1;
  cuts.forEach((c, k) => { add(RAMP[Math.min(6, k)], lo === c ? `${c}` : `${lo}–${c}`); lo = c + 1; });
  const label = state.metric === 'm' ? '出身県' : '中学チームの県';
  $('#map-hint').textContent = `${label}ごとの人数（${state.school < 0 ? '全49校' : S[state.school].name}／${shown().length}人）`;
}

function clearFlows() {
  flowLayer.innerHTML = '';
  zoomReset();
  state.player = null;
  const card = $('#card'); if (card) card.remove();
  $('#flow-clear').hidden = true;
}

/* ── ふきだし ─────────────────────────────────────────── */
const tip = $('#tip');
function showTip(e, name) {
  const n = counts.get(name) || 0;
  tip.innerHTML = `<b>${name}</b> ${n}人`;
  tip.style.opacity = 1; moveTip(e);
}
function moveTip(e) {
  const box = tip.parentElement.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth - 6) + 'px';
  tip.style.top  = (e.clientY - box.top - tip.offsetHeight - 10) + 'px';
}
const hideTip = () => { tip.style.opacity = 0; };

/* ── 県を選ぶ ─────────────────────────────────────────── */
function selectPref(name) {
  state.pref = state.pref === name ? null : name;
  paintMap();
  if (!state.pref) { showRanking(); return; }
  $('#steps').hidden = true;
  const list = shown().filter(p => prefOf(p) === name);
  $('#side-title').textContent = name;
  $('#side-sub').textContent =
    `${state.metric === 'm' ? '出身' : '中学チームの所在地'}が${name}の選手 ${list.length}人`
    + (state.school < 0 ? '' : `（${S[state.school].name}）`);
  renderPlayers($('#side-list'), list, state.school < 0);
}

/** 県を選んでいないときは、多い順の県ランキングを出しておく。 */
function showRanking() {
  $('#steps').hidden = false;
  const label = state.metric === 'm' ? '出身県' : '中学チームの県';
  $('#side-title').textContent = `${label}の多い順`;
  $('#side-sub').textContent = state.school < 0
    ? '全49校・980人の内訳。県を押すとその選手が出ます。'
    : `${S[state.school].name} の20人の内訳。`;
  const rows = [...counts].sort((a, b) => b[1] - a[1] || PREFS.indexOf(a[0]) - PREFS.indexOf(b[0]));
  const max = rows.length ? rows[0][1] : 1;
  const box = $('#side-list'); box.innerHTML = '';
  rows.forEach(([name, n], i) => {
    const b = el('div', 'bar');
    b.style.gridTemplateColumns = '18px 88px 1fr 34px';
    b.innerHTML = `<div class="vl" style="text-align:left">${i + 1}</div>
                   <div class="lb">${name}</div>
                   <div class="tr"><div class="fl" style="width:${n / max * 100}%"></div></div>
                   <div class="vl">${n}</div>`;
    b.addEventListener('click', () => selectPref(name));
    box.appendChild(b);
  });
}

/** 選手の行を並べる。押すと地図に道のりが流れる。 */
function renderPlayers(box, list, withSchool) {
  box.innerHTML = '';
  list.sort((a, b) => a.s - b.s || a.no - b.no);
  for (const p of list) {
    const row = el('div', 'prow');
    row.innerHTML =
      `<span class="n">${p.no}</span>` +
      `<span>${p.name} <em>${p.pos}・${p.grade}年</em><br>` +
      `<span class="m">${withSchool ? S[p.s].name + '／' : ''}${p.team || '所属チーム不明'}</span></span>` +
      `<span class="m">${p.mcity || p.mpref}</span>`;
    row.addEventListener('click', () => { pickPlayer(p); highlight(box, row); });
    box.appendChild(row);
  }
}
function highlight(box, row) {
  box.querySelectorAll('.prow.on').forEach(r => r.classList.remove('on'));
  row.classList.add('on');
}

/* ── 中学チーム → 高校の道のり ─────────────────────────── */
function pickPlayer(p) {
  state.player = p;
  flowLayer.innerHTML = '';
  const s = start(p);
  if (s) {
    const [x1, y1] = xy(s[0], s[1]);
    const [x2, y2] = xy(...goal(p));
    zoomTo(x1, y1, x2, y2);   // 先に倍率を決める。印の大きさがこれで決まる
  } else {
    zoomReset();
  }
  drawFlow(p, 0, true);
  showCard(p);
}

/** 弧を1本ひく。i は同時に何本も描くときの時間差。 */
function drawFlow(p, i, focus) {
  const s = start(p);
  if (!s) return;
  const [x1, y1] = xy(s[0], s[1]);
  const g = goal(p);
  const [x2, y2] = xy(g[0], g[1]);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // 中点から法線方向へふくらませる。同じ県内でも弧になるよう下限を置く。
  // 弧のふくらみ。近すぎて直線になってしまうときの下限は、寄せたぶんだけ小さくする。
  const bow = Math.max(len * 0.3, 34 / state.k);
  const cx = (x1 + x2) / 2 - dy / len * bow;
  const cy = (y1 + y2) / 2 + dx / len * bow;
  const d = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;

  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', d);
  line.setAttribute('class', 'flow');
  if (focus) {
    // グラデーションは userSpaceOnUse なので、この線の両端に合わせて置き直す。
    const g = $('#g-flow');
    g.setAttribute('x1', x1); g.setAttribute('y1', y1);
    g.setAttribute('x2', x2); g.setAttribute('y2', y2);
  }
  line.setAttribute('stroke', focus ? 'url(#g-flow)' : '#3987e5');
  line.setAttribute('stroke-width', focus ? 3 : 1.6);
  line.setAttribute('opacity', focus ? 1 : .62);
  if (focus && state.k <= 4) line.setAttribute('filter', 'url(#glow)');
  flowLayer.appendChild(line);
  const L = line.getTotalLength();
  line.style.strokeDasharray = L;
  line.style.strokeDashoffset = 0;   // 実体は描き終わった状態。アニメはその上に重ねるだけ
  line.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
    { duration: 900, delay: i * 55, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'backwards' });

  const dot = (cxx, cyy, r, fill, stroke) => {
    const c = document.createElementNS(NS, 'circle');
    // 半径は画面で見た大きさが一定になるよう倍率で割る（線幅は non-scaling-stroke 任せ）。
    c.setAttribute('cx', cxx); c.setAttribute('cy', cyy); c.setAttribute('r', r / state.k);
    c.setAttribute('fill', fill); c.setAttribute('class', 'node');
    if (stroke) {
      c.setAttribute('stroke', stroke); c.setAttribute('stroke-width', 1.5);
      c.setAttribute('vector-effect', 'non-scaling-stroke');
    }
    flowLayer.appendChild(c);
    c.animate([{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 320, delay: i * 55, easing: 'ease-out', fill: 'backwards' });
    return c;
  };
  dot(x1, y1, focus ? 7 : 3, '#199e70', focus ? '#0d1117' : null);          // 中学チーム
  const end = dot(x2, y2, focus ? 8 : 3.4, '#cde2fb', '#0d1117');           // 高校
  if (focus) {
    // 高校側で光が脈打つ
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('cx', x2); halo.setAttribute('cy', y2); halo.setAttribute('r', 6 / state.k);
    halo.setAttribute('fill', 'none'); halo.setAttribute('stroke', '#cde2fb');
    halo.setAttribute('vector-effect', 'non-scaling-stroke');
    halo.setAttribute('class', 'node');
    flowLayer.appendChild(halo);
    halo.animate([{ r: 8 / state.k, opacity: .8 }, { r: 20 / state.k, opacity: 0 }],
      { duration: 1600, delay: 700, iterations: Infinity, easing: 'ease-out' });
    // 光の粒が中学チームから高校へ流れつづける
    const spark = document.createElementNS(NS, 'circle');
    spark.setAttribute('r', 3.2 / state.k); spark.setAttribute('fill', '#fff');
    if (state.k <= 4) spark.setAttribute('filter', 'url(#glow)');
    spark.setAttribute('class', 'node');
    const mo = document.createElementNS(NS, 'animateMotion');
    mo.setAttribute('dur', '1.9s'); mo.setAttribute('repeatCount', 'indefinite');
    mo.setAttribute('path', d); mo.setAttribute('begin', '0.5s');
    mo.setAttribute('keyPoints', '0;1'); mo.setAttribute('keyTimes', '0;1');
    mo.setAttribute('calcMode', 'spline'); mo.setAttribute('keySplines', '.4 0 .2 1');
    spark.appendChild(mo);
    flowLayer.appendChild(spark);
    end.parentNode.appendChild(end);
  }
}

/** 1校ぶんの道のりをまとめて流す。どこから集めた代表かが一目で分かる。 */
function drawSchoolFlows(si) {
  flowLayer.innerHTML = '';
  state.player = null;
  const list = P.filter(p => p.s === si);
  const s = S[si];
  const [gx, gy] = xy(s.lat, s.lon);
  const pts0 = [[gx, gy]];
  for (const p of list) { const f = start(p); if (f) pts0.push(xy(f[0], f[1])); }
  zoomTo(Math.min(...pts0.map(q => q[0])), Math.min(...pts0.map(q => q[1])),
         Math.max(...pts0.map(q => q[0])), Math.max(...pts0.map(q => q[1])), 40);
  list.forEach((p, i) => drawFlow(p, i, false));
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', gx); c.setAttribute('cy', gy); c.setAttribute('r', 6 / state.k);
  c.setAttribute('fill', '#cde2fb'); c.setAttribute('stroke', '#0d1117');
  c.setAttribute('stroke-width', 1.6); c.setAttribute('vector-effect', 'non-scaling-stroke');
  c.setAttribute('class', 'node');
  if (state.k <= 4) c.setAttribute('filter', 'url(#glow)');
  flowLayer.appendChild(c);
  const card = ensureCard();
  const far = list.filter(p => p.mpref !== s.pref).length;
  card.innerHTML =
    `<div class="who"><b>${s.name}</b><span class="pill">${s.rep}</span>
       <span style="color:var(--ink-2)">${s.pref}${s.city}</span></div>
     <p style="margin:10px 0 0;color:var(--ink-2);font-size:14px">
       ベンチ入り20人が中学の所属チームから ${s.name} へ集まってくる道のり。
       うち <b style="color:var(--ink)">${far}人</b> が ${s.pref} の外の中学校から来ている。</p>`;
}

function ensureCard() {
  let card = $('#card');
  if (!card) {
    card = el('div', 'card'); card.id = 'card';
    $('#tab-map').insertBefore(card, $('#tab-map').querySelector('.mapgrid'));
  }
  $('#flow-clear').hidden = false;
  return card;
}

/** 選んだ選手の説明を地図の上に出す。 */
function showCard(p) {
  const card = ensureCard();
  const from = p.tlat != null ? `${p.tpref}${p.tcity ? '・' + p.tcity : ''}`
             : p.mlat != null ? `${p.mpref}${p.mcity ? '・' + p.mcity : ''}`
             : (p.mcity || p.mpref);
  card.innerHTML =
    `<div class="who"><b>${p.name}</b>
       <span class="pill">背番号 ${p.no}</span>
       <span class="pill">${p.pos}</span>
       <span class="pill">${p.grade}年</span>
       <span class="pill">${p.bt}</span>
       <span style="color:var(--ink-2)">${S[p.s].name}（${S[p.s].rep}）</span></div>
     <dl class="leg">
       <dt>出身中学校</dt><dd>${p.ms}<span style="color:var(--ink-3)">（${p.mpref}${p.mcity ? '・' + p.mcity : ''}）</span></dd>
       <dt>中学の所属</dt><dd>${p.team || '不明'}${p.kind && p.kind !== '不明' ? `<span style="color:var(--ink-3)">（${p.kind}）</span>` : ''}</dd>
       <dt>地図の道のり</dt><dd>${from} <span style="color:var(--ink-3)">→</span> ${S[p.s].pref}・${S[p.s].city}（${S[p.s].name}）</dd>
     </dl>` +
    (p.note ? `<p class="note">※ ${p.note}</p>` : '') +
    (p.tlat == null && p.mlat != null
      ? `<p class="note">※ 所属チームの所在地が分からないため、出発点は出身中学校に置いています。</p>` : '') +
    (p.mlat == null
      ? `<p class="note">※ 国外の中学校から来た選手なので、地図に道のりを引けません。</p>` : '');
}

/* ── 中学チームのタブ ─────────────────────────────────── */
function renderTeams() {
  const mode = $('#team-mode').querySelector('[aria-pressed="true"]').dataset.v;
  const q = $('#team-q').value.trim();
  const key = { team: p => p.team || '（不明）', kind: p => p.kind, pref: p => p.tpref }[mode];
  let rows = [...tally(P.filter(p => p.team && p.kind !== '中学軟式野球部'), key)];
  if (mode !== 'team') rows = [...tally(P, key)];
  if (q) rows = rows.filter(([k]) => k.includes(q));
  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const max = rows.length ? rows[0][1] : 1;
  const box = $('#team-bars'); box.innerHTML = '';
  let first = null;
  for (const [name, n] of rows.slice(0, 120)) {
    const b = el('div', 'bar');
    const sub = mode === 'team' ? (P.find(p => (p.team || '（不明）') === name) || {}).tpref || '' : '';
    b.innerHTML = `<div class="lb">${name}${sub ? `<small>${sub}</small>` : ''}</div>
                   <div class="tr"><div class="fl" style="width:${n / max * 100}%"></div></div>
                   <div class="vl">${n}</div>`;
    const open = () => {
      const list = P.filter(p => String(key(p)) === name);
      $('#team-title').textContent = name;
      $('#team-sub').textContent = mode === 'team'
        ? `${list.length}人　${list[0].tpref}${list[0].tcity ? '・' + list[0].tcity : ''}`
        : `${list.length}人`;
      renderPlayers($('#team-list'), list, true);
      for (const x of box.querySelectorAll('.bar.on')) x.classList.remove('on');
      b.classList.add('on');
    };
    b.addEventListener('click', open);
    if (!box.children.length) first = open;
    box.appendChild(b);
  }
  if (rows.length > 120) {
    const more = el('div', 'hint'); more.style.marginTop = '8px';
    more.textContent = `ほか ${rows.length - 120} 件（検索で絞れます）`;
    box.appendChild(more);
  }
  if (first) first();
}

/* ── 高校ごとのタブ ───────────────────────────────────── */
function renderSchool() {
  const si = +$('#school-pick').value;
  const mode = $('#school-mode').querySelector('[aria-pressed="true"]').dataset.v;
  const list = P.filter(p => p.s === si);
  const rows = [...tally(list, p => mode === 'm' ? p.mpref : p.tpref)]
    .sort((a, b) => b[1] - a[1] || PREFS.indexOf(a[0]) - PREFS.indexOf(b[0]));
  const max = rows.length ? rows[0][1] : 1;
  const s = S[si];
  $('#school-title').textContent = `${s.name}（${s.rep}）`;
  $('#school-sub').textContent = `${s.pref}${s.city}　ベンチ入り${list.length}人`;
  const box = $('#school-bars'); box.innerHTML = '';
  for (const [name, n] of rows) {
    const b = el('div', 'bar');
    const own = name === s.pref;
    b.innerHTML = `<div class="lb">${name}${own ? '<small>地元</small>' : ''}</div>
                   <div class="tr"><div class="fl" style="width:${n / max * 100}%;
                     background:${own ? 'var(--accent-2)' : 'var(--accent)'}"></div></div>
                   <div class="vl">${n}</div>`;
    b.addEventListener('click', () => {
      const sub = list.filter(p => (mode === 'm' ? p.mpref : p.tpref) === name);
      renderPlayers($('#school-list'), sub, false);
    });
    box.appendChild(b);
  }
  renderPlayers($('#school-list'), list, false);
}

/* ── 一覧のタブ ───────────────────────────────────────── */
let sortKey = 'school', sortAsc = true;
function renderList() {
  const q = $('#q').value.trim();
  const fs = $('#f-school').value, fp = $('#f-pref').value;
  const fo = $('#f-pos').value, fg = $('#f-grade').value;
  let rows = P.filter(p =>
    (!fs || String(p.s) === fs) && (!fp || p.mpref === fp) &&
    (!fo || p.pos === fo) && (!fg || String(p.grade) === fg) &&
    (!q || p.name.includes(q) || p.ms.includes(q) || (p.team || '').includes(q) ||
      S[p.s].name.includes(q)));
  const val = (p) => ({
    school: S[p.s].name, no: p.no, name: p.name, pos: p.pos, grade: p.grade,
    mpref: PREFS.indexOf(p.mpref), ms: p.ms, team: p.team, tpref: PREFS.indexOf(p.tpref),
  })[sortKey];
  rows = rows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ja');
    return (sortAsc ? c : -c) || a.s - b.s || a.no - b.no;
  });
  $('#list-count').textContent = `${rows.length}人`;
  const tb = $('#tbody'); tb.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const p of rows) {
    const tr = el('tr');
    tr.innerHTML =
      `<td>${S[p.s].name}</td><td class="num">${p.no}</td><td>${p.name}</td>` +
      `<td>${p.pos}</td><td class="num">${p.grade}</td><td>${p.mpref}</td>` +
      `<td>${p.ms}</td><td>${p.team || '—'}</td><td>${p.tpref}</td>`;
    tr.addEventListener('click', () => { openTab('map'); pickPlayer(p); });
    frag.appendChild(tr);
  }
  tb.appendChild(frag);
}

/* ── タブ切り替え ─────────────────────────────────────── */
function openTab(name) {
  state.tab = name;
  for (const b of document.querySelectorAll('nav.tabs button'))
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const id of ['map', 'team', 'school', 'list'])
    $('#tab-' + id).hidden = id !== name;
  location.hash = name;
}

/* ── 組み立て ─────────────────────────────────────────── */
/** 選手を名前で直に選べるようにする。県 → 選手とたどらないと道のりが出せないと
 *  分かりにくいので、入り口をもう1つ置く。同姓同名がいるので高校名を添える。 */
const byLabel = new Map();
function fillPlayerBox() {
  const dl = $('#players-dl');
  const frag = document.createDocumentFragment();
  for (const p of P) {
    const label = `${p.name}（${S[p.s].name}・${p.no}）`;
    byLabel.set(label, p);
    const o = el('option'); o.value = label; frag.appendChild(o);
  }
  dl.appendChild(frag);
  $('#player-q').addEventListener('input', (e) => {
    const p = byLabel.get(e.target.value);
    if (p) { pickPlayer(p); e.target.blur(); }
  });
  $('#flow-any').addEventListener('click', () => {
    const list = shown().filter(p => start(p));
    const p = list[Math.floor(Math.random() * list.length)];
    $('#player-q').value = `${p.name}（${S[p.s].name}・${p.no}）`;
    pickPlayer(p);
  });
}

function fillSelects() {
  const opts = S.map((s, i) => `<option value="${i}">${s.name}（${s.rep}）</option>`).join('');
  $('#school-filter').insertAdjacentHTML('beforeend', opts);
  $('#school-pick').innerHTML = opts;
  $('#f-school').insertAdjacentHTML('beforeend', opts);
  $('#f-pref').insertAdjacentHTML('beforeend',
    [...new Set(P.map(p => p.mpref))].sort((a, b) => PREFS.indexOf(a) - PREFS.indexOf(b))
      .map(p => `<option>${p}</option>`).join(''));
  $('#f-pos').insertAdjacentHTML('beforeend',
    ['投手', '捕手', '内野手', '外野手'].map(p => `<option>${p}</option>`).join(''));
  $('#f-grade').insertAdjacentHTML('beforeend',
    [3, 2, 1].map(g => `<option value="${g}">${g}年</option>`).join(''));
}

function seg(id, fn) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $(id).querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    fn(b.dataset.v);
  });
}

function init() {
  $('#c-player').textContent = P.length;
  $('#c-school').textContent = S.length;
  $('#c-team').textContent = new Set(P.filter(p => p.kind !== '中学軟式野球部' && p.team).map(p => p.team)).size;
  $('#c-nan').textContent = P.filter(p => p.kind === '中学軟式野球部').length + '人';
  $('#fetched').textContent = DATA.fetched;

  fillSelects();
  fillPlayerBox();
  buildMap();
  paintMap();
  showRanking();

  seg('#metric', (v) => { state.metric = v; state.pref = null; paintMap(); selectPref(null); });
  $('#flow-all').addEventListener('click', () => drawSchoolFlows(state.school));
  $('#flow-clear').addEventListener('click', clearFlows);
  $('#school-filter').addEventListener('change', (e) => {
    state.school = +e.target.value; state.pref = null; paintMap(); showRanking();
    $('#flow-all').hidden = state.school < 0;
    clearFlows();
  });
  seg('#team-mode', renderTeams);
  $('#team-q').addEventListener('input', renderTeams);
  seg('#school-mode', renderSchool);
  $('#school-pick').addEventListener('change', renderSchool);
  for (const id of ['#q', '#f-school', '#f-pref', '#f-pos', '#f-grade'])
    $(id).addEventListener('input', renderList);
  for (const th of document.querySelectorAll('#table th'))
    th.addEventListener('click', () => {
      sortAsc = sortKey === th.dataset.k ? !sortAsc : true;
      sortKey = th.dataset.k; renderList();
    });
  for (const b of document.querySelectorAll('nav.tabs button'))
    b.addEventListener('click', () => openTab(b.dataset.tab));

  renderTeams(); renderSchool(); renderList();
  const h = location.hash.slice(1);
  openTab(['map', 'team', 'school', 'list'].includes(h) ? h : 'map');
}

init();
