import { T } from './strings.de.js';
import * as store from './store.js';
import { MotionRecorder, requestWakeLock } from './sensors.js';
import { detectMarkers, solveHomography, rectify, toGray, MARKER_MM, VIEW_R, VIEW_SCALE } from './vision.js';
import { groupStats, clickCorrection, shotMetrics, rateShot, caliberMm, CLICK_OPTIONS, aimSeries, restTrace, findOutliers, controlCheck } from './analysis.js';
import { targetSVG } from './target.js';
import { aimChart } from './chart.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (v, d = 0) => (v > 0 ? '+' : '') + fmt(v, d);
const dateStr = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const app = $('#app');
const st = {
  screen: 'home',
  data: store.load(),
  draft: null,
  wizStep: 0,
  prep: { distance: 100, aim: 0, mode: 'scharf', mic: false, first: { clean: false, ammo: false, idle: false, scope: false } },
  prepError: '',
  adj: null,
  changeFor: null,
  afterShot: false,
  restState: 'idle',
  session: null,
  groupIdx: 0,
  viewOnly: false,
  rec: null,
  wake: null,
  photo: null,
  confirm: null,
  notice: '',
  raf: 0,
};

// ---------- Daten ----------

function persist() {
  if (!store.save(st.data)) st.notice = T.storageFull;
}

const setupById = (id) => st.data.setups.find((s) => s.id === id);
const currentSetup = () => setupById(st.session?.setupId);
const currentGroup = () => st.session?.groups[st.groupIdx];

function newSetup() {
  return {
    id: store.uid(),
    waffe: { name: '', typ: 'Repetierbüchse', kaliber: '.308 Win', lauf: '', drall: '', sd: 'ja' },
    optik: { modell: '', einheit: 'mrad', klick: 0.1, hoehe: '' },
    muni: { name: '', los: '', gewicht: '', v0: '' },
  };
}

const setupTitle = (s) => s.waffe.name || `${s.waffe.typ} ${s.waffe.kaliber}`;

const kindOf = (g) => g.kind || 'group';
const groupNo = (i) => st.session.groups.slice(0, i + 1).filter((g) => kindOf(g) === 'group').length;
const aimPoint = () => ({ x: 0, y: st.session?.zielY || 0 });
const included = (g) => g.holes.filter((h) => !h.out);
const shotOf = (g, h) => (h.shot != null ? g.shots[h.shot] : null);
const SHOTS_PER_GROUP = 5;

// Verstellung aus dem Formular: up > 0 hoch, right > 0 rechts
function adjSigned() {
  const a = st.adj;
  if (a.kind !== 'scope') return { up: 0, right: 0 };
  return { up: (Math.round(a.up) || 0) * (a.upDir === 'tief' ? -1 : 1), right: (Math.round(a.right) || 0) * (a.rightDir === 'links' ? -1 : 1) };
}

function adjFrom(corr, kind) {
  const c = corr || { up: 0, right: 0 };
  return {
    kind: kind || (c.up || c.right ? 'scope' : 'none'),
    up: Math.abs(c.up), upDir: c.up < 0 ? 'tief' : 'hoch',
    right: Math.abs(c.right), rightDir: c.right < 0 ? 'links' : 'rechts',
  };
}

function adjText(c) {
  if (!c || (!c.up && !c.right)) return 'nichts';
  const p = [];
  if (c.up) p.push(`${Math.abs(c.up)} ${c.up > 0 ? 'hoch' : 'tief'}`);
  if (c.right) p.push(`${Math.abs(c.right)} ${c.right > 0 ? 'rechts' : 'links'}`);
  return p.join(', ');
}

// Empfehlung für eine Gruppe: nur ausgewählte Treffer, bezogen auf den Zielpunkt (Fleck oder GEE)
function groupCorrection(g) {
  const s = currentSetup();
  const stats = groupStats(included(g));
  if (!stats || !s) return { stats, corr: null };
  const aim = aimPoint();
  const diff = { x: stats.mpi.x - aim.x, y: stats.mpi.y - aim.y };
  return { stats, diff, corr: clickCorrection(diff, st.session.distance, s.optik.einheit, s.optik.klick) };
}

function chartFor(groups) {
  const shots = [];
  groups.forEach((g) =>
    g.shots.forEach((s, i) => {
      const series = s.trace ? aimSeries(s.trace) : [];
      if (!series.length) return;
      const hole = g.holes.find((h) => h.shot === i);
      shots.push({ series, rating: s.rating, label: kindOf(g) === 'control' ? 'K' : String(i + 1), out: hole?.out });
    })
  );
  const rest = st.session?.rest?.series || null;
  if (!shots.length && !rest) return '';
  return `<figure class="chart"><figcaption class="label">${T.shoot.chart}</figcaption>
    ${aimChart({ shots, rest, distanceM: st.session?.distance || 100 })}
    <p class="hint">${T.shoot.chartHint}</p></figure>`;
}

const median = (arr) => {
  if (!arr.length) return null;
  const v = [...arr].sort((a, b) => a - b);
  return v[v.length >> 1];
};

// ---------- Hilfen ----------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

const bindRoot = (root) => ({ draft: st.draft, prep: st.prep, adj: st.adj })[root];

function check(root, path, label) {
  const on = getPath(bindRoot(root), path);
  return `<label class="check"><input type="checkbox" data-bind="${root}:${path}" data-bool${on ? ' checked' : ''}> ${label}</label>`;
}

function field(root, path, label, opt = {}) {
  const obj = bindRoot(root);
  const v = getPath(obj, path);
  const id = `f-${root}-${path.replace(/\./g, '-')}`;
  const bind = `data-bind="${root}:${path}"${opt.num ? ' data-num' : ''}`;
  if (opt.options) {
    const options = opt.options
      .map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`;
      })
      .join('');
    return `<div class="field"><label for="${id}">${label}</label><select id="${id}" ${bind}>${options}</select></div>`;
  }
  const extra = `${opt.inputmode ? ` inputmode="${opt.inputmode}"` : ''}${opt.list ? ` list="${opt.list}"` : ''}`;
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" ${bind} value="${esc(v)}" placeholder="${esc(opt.ph || '')}" autocomplete="off"${extra}></div>`;
}

function download(name, text, type = 'text/csv') {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

function go(screen) {
  cancelAnimationFrame(st.raf);
  st.screen = screen;
  st.confirm = null;
  render();
  window.scrollTo(0, 0);
}

// ---------- Bildschirme ----------

function safetyCard() {
  return `<section class="card safety">
    <h2>${T.safety.title}</h2>
    <ul>${T.safety.items.map((i) => `<li>${i}</li>`).join('')}</ul>
    <button class="btn primary" data-act="ackSafety">${T.safety.ack}</button>
  </section>`;
}

function screenHome() {
  const { setups, sessions } = st.data;
  const locked = !st.data.ackSafety;
  const setupCards = setups.length
    ? setups
        .map((s) => {
          const confirmDel = st.confirm === `setup:${s.id}`;
          return `<article class="card setup">
          <div class="setup-head"><h3>${esc(setupTitle(s))}</h3><span class="tag">${esc(s.waffe.kaliber)}</span></div>
          <dl class="kv">
            <dt>Optik</dt><dd>${s.optik.modell ? `${esc(s.optik.modell)} · ` : ''}${fmt(s.optik.klick, s.optik.klick < 0.1 ? 3 : 2)} ${esc(s.optik.einheit)}</dd>
            <dt>Munition</dt><dd>${esc(s.muni.name || '–')}${s.muni.los ? ` · Los ${esc(s.muni.los)}` : ''}</dd>
          </dl>
          <div class="row-btns">
            <button class="btn primary" data-act="startSession" data-id="${s.id}"${locked ? ' disabled' : ''}>${T.home.start}</button>
            <button class="btn" data-act="editSetup" data-id="${s.id}">${T.home.edit}</button>
            <button class="btn ghost${confirmDel ? ' danger' : ''}" data-act="delSetup" data-id="${s.id}">${confirmDel ? T.home.delConfirm : T.home.del}</button>
          </div>
        </article>`;
        })
        .join('')
    : `<div class="card empty"><h3>${T.home.emptyTitle}</h3><p>${T.home.emptyText}</p></div>`;

  const recent = sessions.slice(-6).reverse();
  const sessionRows = recent.length
    ? `<ul class="sessions">${recent
        .map((x) => {
          const s = setupById(x.setupId);
          const g = [...x.groups].reverse().find((k) => k.holes?.length);
          const stats = g ? groupStats(g.holes) : null;
          return `<li><button class="session-row" data-act="openSession" data-id="${x.id}">
            <span><b>${esc(s ? setupTitle(s) : 'Gelöschtes Setup')}</b><small>${dateStr(x.date)} · ${x.distance} m · ${T.home.groups(x.groups.filter((k) => k.holes?.length).length)}</small></span>
            <span class="num">${stats ? `${fmt(stats.es)} mm` : '–'}</span>
          </button></li>`;
        })
        .join('')}</ul>`
    : `<p class="muted">${T.home.noSessions}</p>`;

  return `<header class="top"><h1 class="brand">Null<span>punkt</span></h1><p class="muted">${T.app.tagline}</p></header>
    ${locked ? safetyCard() : ''}
    <section class="stack">
      <div class="sec-head"><h2>${T.home.setups}</h2><button class="btn small" data-act="newSetup">+ ${T.home.newSetup}</button></div>
      ${setupCards}
    </section>
    <section class="stack">
      <h2>${T.home.sessions}</h2>
      ${sessionRows}
    </section>
    <nav class="links">
      <a href="assets/zielscheibe-a4.pdf" target="_blank" rel="noopener">${T.links.target}</a>
      <button class="link" data-act="sensorTest"${locked ? ' disabled' : ''}>${T.links.sensorTest}</button>
      <button class="link" data-act="info">${T.links.info}</button>
      <a href="impressum.html">${T.links.imprint}</a>
      <a href="datenschutz.html">${T.links.privacy}</a>
    </nav>`;
}

function stepper(steps, cur) {
  return `<ol class="steps">${steps.map((s, i) => `<li class="${i === cur ? 'on' : i < cur ? 'done' : ''}"><i></i>${s}</li>`).join('')}</ol>`;
}

function screenWizard() {
  const W = T.wizard;
  const d = st.draft;
  const pages = [
    () => `<h2>${W.waffe.title}</h2>
      ${field('draft', 'waffe.name', W.waffe.name, { ph: W.waffe.namePh })}
      ${field('draft', 'waffe.typ', W.waffe.typ, { options: W.typen })}
      <div class="grid2">${field('draft', 'waffe.kaliber', W.waffe.kaliber, { list: 'kaliber' })}${field('draft', 'waffe.lauf', W.waffe.lauf, { inputmode: 'decimal' })}</div>
      <div class="grid2">${field('draft', 'waffe.drall', W.waffe.drall, { ph: '1:11"' })}${field('draft', 'waffe.sd', W.waffe.sd, { options: ['ja', 'nein'] })}</div>
      <datalist id="kaliber">${['.222 Rem', '.223 Rem', '.243 Win', '6.5 Creedmoor', '6.5x55 SE', '.270 Win', '7x64', '.308 Win', '.30-06 Spr', '8x57 IS', '.300 Win Mag', '9,3x62', '.22 lr', '.17 HMR'].map((k) => `<option value="${k}">`).join('')}</datalist>`,
    () => `<h2>${W.optik.title}</h2><p class="muted">${W.optik.lead}</p>
      ${field('draft', 'optik.modell', W.optik.modell, { ph: W.optik.modellPh })}
      <div class="grid2">${field('draft', 'optik.einheit', W.optik.einheit, { options: ['mrad', 'MOA'] })}${field('draft', 'optik.hoehe', W.optik.hoehe, { inputmode: 'decimal' })}</div>
      ${field('draft', 'optik.klick', W.optik.klick, { options: CLICK_OPTIONS[d.optik.einheit], num: true })}`,
    () => `<h2>${W.muni.title}</h2><p class="muted">${W.muni.lead}</p>
      ${field('draft', 'muni.name', W.muni.name, { ph: W.muni.namePh })}
      <div class="grid2">${field('draft', 'muni.los', W.muni.los)}${field('draft', 'muni.gewicht', W.muni.gewicht, { inputmode: 'decimal' })}</div>
      ${field('draft', 'muni.v0', W.muni.v0, { inputmode: 'numeric' })}`,
  ];
  const last = st.wizStep === pages.length - 1;
  return `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.cancel}</button></header>
    ${stepper(W.steps, st.wizStep)}
    <section class="card form">${pages[st.wizStep]()}</section>
    <div class="actions">
      <button class="btn" data-act="wizBack"${st.wizStep === 0 ? ' disabled' : ''}>${T.nav.back}</button>
      <button class="btn primary" data-act="${last ? 'wizSave' : 'wizNext'}">${last ? T.nav.save : T.nav.next}</button>
    </div>`;
}

function screenPrep() {
  const P = T.prep;
  const s = setupById(st.pendingSetup);
  return `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.home}</button></header>
    <section class="card form">
      <h2>${P.title}${s ? ` · ${esc(setupTitle(s))}` : ''}</h2>
      <p class="muted">${P.lead}</p>
      <a class="btn" href="assets/zielscheibe-a4.pdf" target="_blank" rel="noopener">${P.target}</a>
      <p class="hint">${P.targetHint}</p>
      ${st.sensorTestOnly ? '' : field('prep', 'distance', P.distance, { options: [25, 50, 100, 150, 200, 300], num: true })}
      ${st.sensorTestOnly ? '' : field('prep', 'aim', P.aim, { options: P.aims, num: true })}
      ${field('prep', 'mode', P.mode, { options: P.modes })}
      ${check('prep', 'mic', P.mic)}
    </section>
    ${st.sensorTestOnly ? '' : `<section class="card form">
      <h3>${P.firstTitle}</h3>
      ${Object.entries(P.first).map(([k, label]) => check('prep', `first.${k}`, label)).join('')}
    </section>`}
    ${st.prepError ? `<p class="error" role="alert">${st.prepError}</p>` : ''}
    <div class="actions single"><button class="btn primary" data-act="startShooting">${P.start}</button></div>`;
}

function shotItems(shots) {
  if (!shots.length) return `<li class="muted">${T.shoot.none}</li>`;
  return shots
    .map((s, i) => {
      const m = s.metrics;
      return `<li><span class="num">#${i + 1}</span><span class="num small">${m ? `Wanderung ${fmt(m.wander, 2)} mrad · Ruck ${fmt(m.jerk, 1)}` : ''}${s.manual ? ' · manuell' : ''}</span><span class="pill ${s.rating}">${T.ratings[s.rating]}</span></li>`;
    })
    .join('');
}

function thrToSlider(thr) {
  return Math.round((Math.log10(thr / 0.05) / 3) * 100);
}
function sliderToThr(v) {
  return 0.05 * 10 ** ((v / 100) * 3);
}

const sensorPill = () => `<span class="pill live">${T.shoot.sensor} · <span id="hz">–</span> Hz</span>`;

function screenRest() {
  const R = T.rest;
  const rest = st.session.rest;
  let status = '';
  if (st.restState === 'rec') status = `<p class="step-hint" id="restCount" aria-live="polite">${R.recording(3)}</p>`;
  else if (st.restState === 'done') {
    status = !rest
      ? `<p class="error">${R.none}</p>`
      : rest.metrics.wander < 0.3
        ? `<p class="ok">${R.good(rest.metrics.wander)}</p>`
        : `<p class="hint">${R.shaky(rest.metrics.wander)}</p>`;
  }
  const busy = st.restState === 'rec';
  const done = st.restState === 'done' && rest;
  return `<header class="bar-top"><button class="btn ghost small" data-act="stopToHome">${T.nav.home}</button>${sensorPill()}</header>
    <section class="card">
      <h2>${R.title}</h2>
      <p>${R.lead}</p>
      <p class="muted">${R.why}</p>
      <canvas id="live" width="900" height="260" aria-label="${T.shoot.live}"></canvas>
      ${status}
      ${done ? chartFor([]) : ''}
      <div class="row-btns">
        <button class="btn${done ? '' : ' primary'}" data-act="restRecord"${busy ? ' disabled' : ''}>${st.restState === 'idle' ? R.start : R.again}</button>
        ${done ? '' : `<button class="btn ghost" data-act="restDone"${busy ? ' disabled' : ''}>${R.skip}</button>`}
      </div>
    </section>
    ${done ? `<div class="actions single"><button class="btn primary" data-act="restDone">${R.go}</button></div>` : ''}`;
}

function shootTitle() {
  const S = T.shoot;
  const g = currentGroup();
  if (kindOf(g) === 'control') return S.control(g.shots.length + 1);
  const n = g.shots.length + 1;
  return n <= SHOTS_PER_GROUP ? S.title(groupNo(st.groupIdx), n, SHOTS_PER_GROUP) : S.titleMore(groupNo(st.groupIdx), n);
}

function shootHint() {
  const S = T.shoot;
  const g = currentGroup();
  if (kindOf(g) === 'control') return S.controlHint;
  const risks = st.session.firstRisk || [];
  const firstOfSession = st.session.groups.indexOf(g) === 0 && g.shots.length === 0;
  if (firstOfSession && risks.length) return `${S.firstHint(risks.map((k) => T.prep.first[k]).join(', '))}`;
  return g.shots.length === 0 ? S.groupHint : '';
}

function afterShotPanel() {
  const S = T.shoot;
  const g = currentGroup();
  const last = g.shots[g.shots.length - 1];
  if (!st.afterShot || !last) return '';
  const full = kindOf(g) === 'group' && g.shots.length >= SHOTS_PER_GROUP;
  return `<div class="after-shot">
      <p><b>${S.after(g.shots.length, T.ratings[last.rating])}</b></p>
      ${full ? `<p class="muted">${S.afterFull}</p>` : ''}
      <div class="row-btns">
        <button class="btn primary" data-act="photoShot">${S.photoShot}</button>
        ${full ? '' : `<button class="btn" data-act="continueShoot">${S.noPhoto}</button>`}
      </div>
    </div>`;
}

function screenShoot() {
  const S = T.shoot;
  const g = currentGroup();
  const test = !st.session;
  const thr = st.rec?.threshold ?? 1;
  const hint = test ? '' : shootHint();
  const control = !test && kindOf(g) === 'control';
  const cal = caliberMm(currentSetup()?.waffe.kaliber);
  return `<header class="bar-top"><button class="btn ghost small" data-act="stopToHome">${T.nav.home}</button>${sensorPill()}</header>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    <section class="card">
      <h2 id="shootTitle">${test ? S.testTitle : shootTitle()}</h2>
      <div id="afterShot">${test ? '' : afterShotPanel()}</div>
      <p class="label">${S.live}</p>
      <canvas id="live" width="900" height="260" aria-label="${S.live}"></canvas>
      <div class="field"><label for="thr">${S.trigger}: <span id="thrVal" class="num">${fmt(thr, 2)}</span> m/s²</label>
        <input type="range" id="thr" min="0" max="100" value="${thrToSlider(thr)}">
        <div class="meter"><i id="meterFill"></i><b id="meterThr" style="left:${thrToSlider(thr)}%"></b></div>
        <p class="hint">${S.triggerHint}</p>
      </div>
      <p id="flash" class="flash" aria-live="polite"></p>
      <ul class="shots" id="shotList">${test ? shotItems(st.testShots || []) : shotItems(g.shots)}</ul>
      <div class="row-btns">
        <button class="btn" data-act="manualShot">${S.manual}</button>
        <button class="btn ghost" data-act="undoShot">${S.undo}</button>
      </div>
    </section>
    ${test ? '' : `<section class="card" id="shootChart"${g.shots.length || st.session.rest ? '' : ' hidden'}>${chartFor([g])}</section>`}
    ${!test && g.holes.length ? `<section class="card"><div class="sheet">${targetSVG({ holes: g.holes, calDia: cal, aim: aimPoint() })}</div></section>` : ''}
    <details class="card raw"><summary>${S.raw}</summary>
      <div class="row-btns">
        <button class="btn" data-act="toggleRaw" id="rawBtn">${st.rec?.raw ? S.rawStop : S.rawStart}</button>
        <button class="btn ghost" data-act="exportShots">${S.exportShots}</button>
      </div>
    </details>
    ${test ? '' : `<div class="actions single"><button class="btn primary" data-act="finishGroup"${g.shots.length || g.holes.length ? '' : ' disabled'}>${control ? S.doneControl : S.done}</button></div>`}`;
}

function screenChange() {
  const C = T.change;
  const a = st.adj;
  const forShot = st.changeFor === 'shot';
  const g = currentGroup();
  const title = forShot ? C.shotTitle(g.shots.length) : st.changeFor === 'control' ? C.controlTitle : C.groupTitle;
  const kinds = forShot ? ['none', 'scope', 'other'] : ['scope', 'none'];
  const lead = forShot ? C.shotLead : st.adj.recommended ? C.recommended(adjText(st.adj.recommended)) : '';
  return `<header class="bar-top"><button class="btn ghost small" data-act="changeBack">${T.nav.back}</button></header>
    <section class="card form">
      <h2>${title}</h2>
      ${lead ? `<p class="muted">${lead}</p>` : ''}
      <div class="choices" role="radiogroup">
        ${kinds.map((k) => `<button class="choice" role="radio" aria-checked="${a.kind === k}" data-act="adjKind" data-kind="${k}">${C.kinds[k]}</button>`).join('')}
      </div>
      ${a.kind === 'scope' ? `
        <div class="grid2">${field('adj', 'up', C.height, { inputmode: 'numeric', num: true })}${field('adj', 'upDir', '&nbsp;', { options: C.dirsUp })}</div>
        <div class="grid2">${field('adj', 'right', C.side, { inputmode: 'numeric', num: true })}${field('adj', 'rightDir', '&nbsp;', { options: C.dirsSide })}</div>` : ''}
    </section>
    <div class="actions single"><button class="btn primary" data-act="changeApply">${C.apply}</button></div>`;
}

function screenPhoto() {
  const P = T.photo;
  const ph = st.photo || { mode: 'pick' };
  const g = currentGroup();
  let body = '';
  if (ph.mode === 'pick') {
    body = `<p class="muted">${P.hint}</p>
      <label class="btn primary file">${P.take}<input type="file" accept="image/*" capture="environment" id="photoCam"></label>
      <label class="btn file">${P.pick}<input type="file" accept="image/*" id="photoLib"></label>`;
  } else if (ph.mode === 'busy') {
    body = `<p class="muted">${P.detecting}</p>`;
  } else if (ph.mode === 'corners') {
    body = `<p>${P.manual}</p><p class="step-hint"><b>${ph.corners.length + 1}/4</b> ${P.cornerNames[ph.corners.length]}</p>
      <div class="canvas-wrap"><canvas id="cornerCanvas"></canvas></div>
      <div class="row-btns"><button class="btn ghost" data-act="resetCorners">${P.redo}</button><button class="btn ghost" data-act="newPhoto">${P.newPhoto}</button></div>`;
  } else {
    body = `<p class="muted">${ph.oriented ? P.found : P.notOriented} ${ph.before ? P.holesMore : P.holes}</p>
      <div class="canvas-wrap${ph.zoom > 1 ? ' zoomed' : ''}" id="rectWrap"><canvas id="rectCanvas" width="${2 * VIEW_R * VIEW_SCALE}" height="${2 * VIEW_R * VIEW_SCALE}"></canvas></div>
      <p class="num" id="holeCount">${P.count(g.holes.length)}</p>
      <div class="row-btns">
        <button class="btn ghost" data-act="toggleZoom">${P.zoom} ${ph.zoom > 1 ? '1×' : '2×'}</button>
        <button class="btn ghost" data-act="resetCorners">${P.redo}</button>
        <button class="btn ghost" data-act="newPhoto">${P.newPhoto}</button>
      </div>`;
  }
  const control = kindOf(g) === 'control';
  const actionsBar = control
    ? `<div class="actions single"><button class="btn primary" data-act="evaluate"${g.holes.length ? '' : ' disabled'}>${P.evaluateControl}</button></div>`
    : `<div class="actions"><button class="btn" data-act="backToShoot">${P.more}</button><button class="btn primary" data-act="evaluate"${g.holes.length ? '' : ' disabled'}>${P.evaluate}</button></div>`;
  return `<header class="bar-top"><button class="btn ghost small" data-act="backToShoot">${T.nav.back}</button></header>
    <section class="card">
      <h2>${P.title} · ${control ? T.control.title : `Gruppe ${groupNo(st.groupIdx)}`}</h2>
      ${body}
    </section>
    ${ph.mode === 'holes' ? actionsBar : ''}`;
}

function corrBlock(corr, diff) {
  const R = T.result;
  if (!corr) return '';
  if (corr.up === 0 && corr.right === 0) return `<p class="ok">${R.zero}</p>`;
  return `<div class="correction">
      <div><b>${Math.abs(corr.up)}</b><span>${corr.up === 0 ? R.heightOk : corr.up > 0 ? R.up : R.down}</span>${diff ? `<em>${R.cm(diff.y / 10)}</em>` : ''}</div>
      <div><b>${Math.abs(corr.right)}</b><span>${corr.right === 0 ? R.sideOk : corr.right > 0 ? R.right : R.left}</span>${diff ? `<em>${R.cm(diff.x / 10)}</em>` : ''}</div>
    </div>`;
}

function stabilityBlock(g) {
  const R = T.result;
  const counts = { ruhig: 0, unruhig: 0, verrissen: 0, unbekannt: 0 };
  g.shots.forEach((x) => counts[x.rating]++);
  const measured = g.shots.length - counts.unbekannt;
  const rest = st.session.rest;
  if (!measured) return `<p class="muted">${R.stabilityNone}</p>`;
  return `<div class="pills">${['ruhig', 'unruhig', 'verrissen'].map((k) => `<span class="pill ${k}">${counts[k]} × ${T.ratings[k]}</span>`).join('')}</div>
    ${rest ? `<p class="muted small">${R.restRef(rest.metrics.wander)}</p>` : ''}
    ${counts.unruhig + counts.verrissen >= Math.max(1, Math.ceil(measured / 3)) ? `<p class="hint">${R.shooterHint(counts.ruhig, measured)}</p>` : ''}
    <ul class="shots">${shotItems(g.shots)}</ul>`;
}

// Aussage zu Ausreißern: Abstand zu den übrigen + wahrscheinliche Ursache
function outlierStatement(g) {
  const R = T.result;
  if (g.holes.length < 3) return `<p class="muted">${R.outFew}</p>`;
  const lines = [];
  const risks = st.session.firstRisk || [];
  const firstGroup = st.session.groups.indexOf(g) === 0;
  (g.flagged || []).forEach((i) => {
    const h = g.holes[i];
    const others = g.holes.filter((_, j) => j !== i);
    const s = groupStats(others);
    const shot = shotOf(g, h);
    const why = [];
    if (firstGroup && (h.shot === 0 || (h.shot == null && i === 0)) && risks.length) why.push(R.why.first(risks.map((k) => T.prep.first[k]).join(', ')));
    if (shot && (shot.rating === 'verrissen' || shot.rating === 'unruhig')) why.push(R.why.sensor(T.ratings[shot.rating]));
    if (shot?.change === 'other') why.push(R.why.change);
    if (!why.length) why.push(R.why.unknown);
    lines.push(`<li><b>${R.outLine(i + 1, Math.hypot(h.x - s.mpi.x, h.y - s.mpi.y) / 10)}</b> ${why.join(' ')}</li>`);
  });
  g.holes.forEach((h, i) => {
    const shot = shotOf(g, h);
    if (!(g.flagged || []).includes(i) && shot?.rating === 'verrissen') lines.push(`<li>${R.sensorInGroup(i + 1, T.ratings.verrissen)}</li>`);
  });
  if (!(g.flagged || []).length) lines.unshift(`<li class="ok">${R.outNone}</li>`);
  return `<ul class="statement">${lines.join('')}</ul>`;
}

function holeSelector(g) {
  const R = T.result;
  return `<div class="sel">${g.holes
    .map((h, i) => {
      const shot = shotOf(g, h);
      const info = shot ? `<span class="pill ${shot.rating}">${T.ratings[shot.rating]}</span>` : `<small class="muted">${R.noSensor}</small>`;
      return `<button class="sel-row" aria-pressed="${!h.out}" data-act="toggleHole" data-i="${i}">
        <span class="sel-box" aria-hidden="true"></span><b>Treffer ${i + 1}</b>${info}<span class="sel-state">${h.out ? R.outGroup : R.inGroup}</span></button>`;
    })
    .join('')}</div>`;
}

function screenResult() {
  return kindOf(currentGroup()) === 'control' ? screenControl() : screenGroup();
}

function screenGroup() {
  const R = T.result;
  const s = currentSetup();
  const g = currentGroup();
  const dist = st.session.distance;
  const cal = caliberMm(s?.waffe.kaliber);
  const aim = aimPoint();
  const { stats, diff, corr } = groupCorrection(g);
  const mrad = stats ? stats.es / dist : null;
  const holes = g.holes.map((h, i) => ({ ...h, label: i + 1 }));

  return `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.home}</button></header>
    <section class="card">
      <h2>${R.title(groupNo(st.groupIdx))}</h2>
      <div class="sheet">${targetSVG({ holes, mpi: stats?.mpi, calDia: cal, aim })}</div>
      <div class="tiles">
        <div class="tile"><small>${R.spread}</small><b class="num">${fmt(stats?.es)}</b><em>mm</em></div>
        <div class="tile"><small>${R.angle}</small><b class="num">${fmt(mrad, 2)}</b><em>mrad · ${fmt(mrad / 0.290888, 1)} MOA</em></div>
        <div class="tile"><small>${R.mpi}</small><b class="num">${stats ? `${signed(stats.mpi.x)} / ${signed(stats.mpi.y)}` : '–'}</b><em>mm rechts / hoch</em></div>
      </div>
    </section>
    <section class="card">
      <h3>${R.outTitle}</h3>
      ${outlierStatement(g)}
      <h3>${R.selTitle}</h3>
      <p class="muted small">${R.selHint}</p>
      ${holeSelector(g)}
    </section>
    <section class="card">
      <h3>${R.correction}</h3>
      <p class="muted small">${aim.y ? R.aimHigh(aim.y / 10) : R.aimFleck} · ${dist} m · ${s ? `${fmt(s.optik.klick, s.optik.klick < 0.1 ? 3 : 2)} ${esc(s.optik.einheit)} je Klick` : ''}</p>
      ${corrBlock(corr, diff)}
      ${stats && stats.n < 3 ? `<p class="hint">${R.fewShots}</p>` : ''}
    </section>
    <section class="card">
      <h3>${R.stability}</h3>
      ${chartFor([g])}
      ${stabilityBlock(g)}
    </section>
    <div class="actions${st.viewOnly ? ' single' : ''}">
      ${st.viewOnly ? '' : `<button class="btn" data-act="newGroup">${R.newGroup}</button><button class="btn primary" data-act="controlShot"${stats ? '' : ' disabled'}>${R.control}</button>`}
    </div>
    <div class="row-btns center">
      ${st.viewOnly ? '' : `<button class="btn ghost small" data-act="finishSession">${R.finish}</button>`}
      <button class="btn ghost small" data-act="exportHoles">${R.exportHoles}</button>
      <button class="btn ghost small" data-act="exportShots">${T.shoot.exportShots}</button>
    </div>`;
}

function screenControl() {
  const C = T.control;
  const R = T.result;
  const s = currentSetup();
  const g = currentGroup();
  const ref = st.session.groups[g.ref];
  const refHoles = ref ? included(ref) : [];
  const refStats = groupStats(refHoles);
  const hit = groupStats(g.holes);
  const header = `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.home}</button></header>`;
  if (!refStats || !hit || !s) return `${header}<section class="card"><h2>${C.title}</h2><p class="muted">${C.noRef}</p></section>`;

  const dist = st.session.distance;
  const shot = g.shots[g.shots.length - 1];
  const refWander = median(ref.shots.filter((x, i) => x.metrics && !ref.holes.find((h) => h.shot === i)?.out).map((x) => x.metrics.wander));
  const calm = shot?.metrics ? shot.rating === 'ruhig' || (refWander != null && shot.metrics.wander <= refWander * 1.5) : null;
  const aim = aimPoint();
  const res = controlCheck({ hole: hit.mpi, ref: refStats, adjust: g.adjustTotal || { up: 0, right: 0 }, aim, distanceM: dist, einheit: s.optik.einheit, klick: s.optik.klick, calm });
  const cls = res.verdict === 'ok' ? 'ok' : res.verdict === 'rest' ? 'hint' : 'error';
  const holes = g.holes.map((h) => ({ ...h, label: 'K' }));
  const restDiff = { x: hit.mpi.x - aim.x, y: hit.mpi.y - aim.y };

  return `${header}
    <section class="card">
      <h2>${C.title}</h2>
      <p class="muted small">${C.refLine(groupNo(g.ref), adjText(g.adjustTotal))}</p>
      <div class="sheet">${targetSVG({ holes, older: refHoles, calDia: caliberMm(s.waffe.kaliber), aim, expect: { ...res.expect, r: res.r } })}</div>
      <p class="${cls}">${C.verdicts[res.verdict]}</p>
      <p class="muted small">${C.dist(res.dExpect / 10, res.dAim / 10, res.r / 10)}</p>
      ${shot?.metrics ? `<p class="muted small">${C.calm(shot.metrics.wander, refWander, st.session.rest?.metrics.wander)}</p>` : ''}
    </section>
    ${res.verdict === 'ok' ? '' : `<section class="card"><h3>${C.restTitle}</h3>${corrBlock(res.rest, restDiff)}</section>`}
    <section class="card">
      <h3>${R.stability}</h3>
      ${chartFor([ref, g])}
    </section>
    <div class="actions${st.viewOnly ? ' single' : ''}">
      ${st.viewOnly ? '' : `<button class="btn" data-act="controlAgain">${C.again}</button><button class="btn primary" data-act="finishSession">${C.done}</button>`}
    </div>
    <div class="row-btns center">
      ${st.viewOnly ? '' : `<button class="btn ghost small" data-act="newGroup">${R.newGroup}</button>`}
      <button class="btn ghost small" data-act="exportShots">${T.shoot.exportShots}</button>
    </div>`;
}

function screenSession() {
  const x = st.session;
  const s = currentSetup();
  const confirmDel = st.confirm === `session:${x.id}`;
  return `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.home}</button></header>
    <section class="card">
      <h2>${esc(s ? setupTitle(s) : 'Gelöschtes Setup')}</h2>
      <p class="muted">${dateStr(x.date)} · ${x.distance} m · ${x.mode === 'trocken' ? 'Trockentraining' : 'scharf'}</p>
      <ul class="sessions">${x.groups
        .map((g, i) => {
          const stats = groupStats(included(g));
          const label = kindOf(g) === 'control' ? T.control.title : `Gruppe ${groupNo(i)}`;
          return `<li><button class="session-row" data-act="openGroup" data-i="${i}"${stats ? '' : ' disabled'}>
            <span><b>${label}</b><small>${g.shots.length} Schuss gemessen · ${g.holes?.length || 0} Treffer</small></span>
            <span class="num">${stats ? `${fmt(stats.es)} mm` : '–'}</span></button></li>`;
        })
        .join('')}</ul>
      <div class="row-btns">
        <button class="btn ghost" data-act="exportShots">${T.shoot.exportShots}</button>
        <button class="btn ghost${confirmDel ? ' danger' : ''}" data-act="delSession" data-id="${x.id}">${confirmDel ? T.home.delConfirm : T.home.del}</button>
      </div>
    </section>`;
}

function screenInfo() {
  const I = T.info;
  const confirmWipe = st.confirm === 'wipe';
  return `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.home}</button></header>
    <section class="card prose">
      <h2>${I.howTitle}</h2>
      ${I.how.map((p) => `<p>${p}</p>`).join('')}
      <h2>${I.measureTitle}</h2>
      ${I.measure.map((p) => `<p>${p}</p>`).join('')}
      <h2>${I.installTitle}</h2>
      <p>${I.install}</p>
      <h2>${T.safety.title}</h2>
      <ul>${T.safety.items.map((i) => `<li>${i}</li>`).join('')}</ul>
    </section>
    <section class="card">
      <h2>${I.dataTitle}</h2>
      <p class="muted">${I.data}</p>
      <div class="stack-btns">
        <button class="btn" data-act="backup">${I.backup}</button>
        <label class="btn file">${I.restore}<input type="file" accept="application/json,.json" id="restoreFile"></label>
        <button class="btn ghost${confirmWipe ? ' danger' : ''}" data-act="wipe">${confirmWipe ? I.wipeConfirm : I.wipe}</button>
      </div>
    </section>`;
}

const screens = {
  home: screenHome,
  wizard: screenWizard,
  prep: screenPrep,
  rest: screenRest,
  shoot: screenShoot,
  change: screenChange,
  photo: screenPhoto,
  result: screenResult,
  session: screenSession,
  info: screenInfo,
};

function render() {
  cancelAnimationFrame(st.raf);
  document.body.dataset.screen = st.screen;
  const notice = st.notice ? `<p class="notice" role="alert">${st.notice}</p>` : '';
  app.innerHTML = notice + screens[st.screen]();
  st.notice = '';
  after[st.screen]?.();
}

// ---------- Nach dem Rendern ----------

function liveLoop() {
  const cv = $('#live');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  const screen = st.screen;
  const loop = () => {
    const rec = st.rec;
    if (!rec || st.screen !== screen || !cv.isConnected) return;
    $('#hz').textContent = rec.rate ? Math.round(rec.rate) : '–';
    const fill = $('#meterFill');
    if (fill) {
      fill.style.width = `${Math.min(100, Math.max(0, thrToSlider(Math.max(rec.level, 0.05))))}%`;
      fill.classList.toggle('hot', rec.level > rec.threshold);
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    const now = rec.buf.length ? rec.buf[rec.buf.length - 1].t : 0;
    const pts = rec.buf.filter((s) => s.t > now - 3000);
    const vals = pts.map((s) => Math.hypot(s.gx, s.gy, s.gz) * 1000);
    const max = Math.max(20, ...vals);
    ctx.strokeStyle = col('--line');
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo((i * cv.width) / 3, 0);
      ctx.lineTo((i * cv.width) / 3, cv.height);
      ctx.stroke();
    }
    ctx.fillStyle = col('--muted');
    ctx.font = '22px ui-monospace, monospace';
    ctx.fillText(`${Math.round(max)} mrad/s`, 8, 24);
    ctx.strokeStyle = col('--trace');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach((s, i) => {
      const x = ((s.t - (now - 3000)) / 3000) * cv.width;
      const y = cv.height - (vals[i] / max) * (cv.height - 30);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    st.raf = requestAnimationFrame(loop);
  };
  st.raf = requestAnimationFrame(loop);
}

const after = {
  shoot: liveLoop,
  rest: liveLoop,
  photo() {
    const ph = st.photo;
    if (!ph) return;
    if (ph.mode === 'corners') drawCorners();
    if (ph.mode === 'holes') {
      drawRect();
      if (ph.zoom > 1) {
        const w = $('#rectWrap');
        w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2;
        w.scrollTop = (w.scrollHeight - w.clientHeight) / 2;
      }
    }
  },
};

// ---------- Sensorik ----------

function attachRecorder(rec) {
  const mode = st.session?.mode || st.prep.mode;
  rec.threshold = mode === 'trocken' ? st.data.settings.thrTrocken : st.data.settings.thrScharf;
  rec.requireMic = st.prep.mic;
  rec.on('shot', onShot);
  rec.on('rejected', () => flash(T.shoot.rejected));
}

function onShot({ trace, manual }) {
  const metrics = shotMetrics(trace);
  const shot = {
    at: new Date().toISOString(),
    manual,
    metrics,
    rating: rateShot(metrics),
    trace: trace.map((s) => ({
      t: s.t,
      gx: +s.gx.toFixed(5), gy: +s.gy.toFixed(5), gz: +s.gz.toFixed(5),
      ax: +s.ax.toFixed(4), ay: +s.ay.toFixed(4), az: +s.az.toFixed(4),
    })),
  };
  navigator.vibrate?.(60);
  if (!st.session) {
    st.testShots = st.testShots || [];
    st.testShots.push(shot);
    const list = $('#shotList');
    if (list) list.innerHTML = shotItems(st.testShots);
    flash(`Schuss erkannt: ${T.ratings[shot.rating]}`);
    return;
  }
  currentGroup().shots.push(shot);
  persist();
  // Bis zur Entscheidung (Foto oder weiter) keine weiteren Stöße werten, z. B. beim Aufstehen
  if (st.rec) st.rec.armed = false;
  st.afterShot = true;
  if (st.screen === 'shoot') render();
}

function flash(text) {
  const el = $('#flash');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function stopRecorder() {
  st.rec?.stop();
  st.rec = null;
  st.wake?.release?.().catch(() => {});
  st.wake = null;
}

// ---------- Foto ----------

async function loadPhoto(file) {
  st.photo = { mode: 'busy', zoom: 1, corners: [] };
  render();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    st.photo = { mode: 'pick' };
    render();
    return;
  }
  const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const src = document.createElement('canvas');
  src.width = Math.round(img.naturalWidth * scale);
  src.height = Math.round(img.naturalHeight * scale);
  src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
  URL.revokeObjectURL(url);
  st.photo.src = src;
  st.photo.srcData = src.getContext('2d').getImageData(0, 0, src.width, src.height);

  const ds = Math.min(1, 900 / Math.max(src.width, src.height));
  const small = document.createElement('canvas');
  small.width = Math.round(src.width * ds);
  small.height = Math.round(src.height * ds);
  const sctx = small.getContext('2d');
  sctx.drawImage(src, 0, 0, small.width, small.height);
  const det = detectMarkers(toGray(sctx.getImageData(0, 0, small.width, small.height)), small.width, small.height);
  if (det) {
    finishCorners(det.corners.map(([x, y]) => [x / ds, y / ds]), det.oriented);
  } else {
    st.photo.mode = 'corners';
    render();
  }
}

function finishCorners(corners, oriented) {
  const ph = st.photo;
  ph.corners = corners;
  ph.oriented = oriented;
  const H = solveHomography(MARKER_MM, corners);
  const r = rectify(ph.srcData, H);
  ph.rect = new ImageData(r.data, r.width, r.height);
  ph.before = currentGroup().holes.length > 0;
  ph.mode = 'holes';
  render();
}

function drawCorners() {
  const ph = st.photo;
  const cv = $('#cornerCanvas');
  cv.width = ph.src.width;
  cv.height = ph.src.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(ph.src, 0, 0);
  const rad = Math.max(10, cv.width / 60);
  ctx.lineWidth = rad / 3;
  ctx.strokeStyle = '#ffb000';
  ctx.fillStyle = '#ffb000';
  ctx.font = `${rad * 1.6}px system-ui, sans-serif`;
  ph.corners.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(String(i + 1), x + rad * 1.3, y - rad);
  });
}

function drawRect() {
  const ph = st.photo;
  const g = currentGroup();
  const cv = $('#rectCanvas');
  const ctx = cv.getContext('2d');
  ctx.putImageData(ph.rect, 0, 0);
  const s = VIEW_SCALE;
  const toPx = (x, y) => [(x + VIEW_R) * s, (VIEW_R - y) * s];
  ctx.strokeStyle = 'rgba(214,140,30,.45)';
  ctx.lineWidth = 1;
  for (let v = -70; v <= 70; v += 10) {
    const [x1, y1] = toPx(v, -70);
    const [x2, y2] = toPx(v, 70);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const [x3, y3] = toPx(-70, v);
    const [x4, y4] = toPx(70, v);
    ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x4, y4); ctx.stroke();
  }
  const r = (caliberMm(currentSetup()?.waffe.kaliber) / 2) * s;
  ctx.lineWidth = 3;
  ctx.font = 'bold 26px system-ui, sans-serif';
  g.holes.forEach((p, i) => {
    const [x, y] = toPx(p.x, p.y);
    ctx.strokeStyle = '#ff3b1f';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff3b1f';
    ctx.fillText(String(i + 1), x + r + 4, y - r);
  });
}

function canvasPoint(cv, e) {
  const b = cv.getBoundingClientRect();
  return [((e.clientX - b.left) / b.width) * cv.width, ((e.clientY - b.top) / b.height) * cv.height];
}

// ---------- Export ----------

function shotsCsv() {
  const rows = ['gruppe,schuss,t_ms,gx_rad_s,gy_rad_s,gz_rad_s,ax_m_s2,ay_m_s2,az_m_s2,wanderung_mrad,ruck,bewertung'];
  const groups = st.session ? st.session.groups : [{ shots: st.testShots || [] }];
  groups.forEach((g, gi) =>
    g.shots.forEach((s, si) => {
      const m = s.metrics || {};
      s.trace.forEach((p) =>
        rows.push([gi + 1, si + 1, p.t, p.gx, p.gy, p.gz, p.ax, p.ay, p.az, m.wander?.toFixed(3) ?? '', m.jerk?.toFixed(2) ?? '', s.rating].join(','))
      );
    })
  );
  return rows.join('\n');
}

function rawCsv(raw) {
  const t0 = raw.find((s) => !s.shot)?.t ?? 0;
  const rows = ['t_ms,gx_rad_s,gy_rad_s,gz_rad_s,ax_m_s2,ay_m_s2,az_m_s2,schuss'];
  const shots = new Set(raw.filter((s) => s.shot).map((s) => s.t));
  raw.forEach((s) => {
    if (s.shot) return;
    rows.push([(s.t - t0).toFixed(1), s.gx.toFixed(5), s.gy.toFixed(5), s.gz.toFixed(5), s.ax.toFixed(4), s.ay.toFixed(4), s.az.toFixed(4), shots.has(s.t) ? 1 : 0].join(','));
  });
  return rows.join('\n');
}

// ---------- Aktionen ----------

const actions = {
  home() {
    stopRecorder();
    st.session = null;
    st.viewOnly = false;
    go('home');
  },
  stopToHome() {
    actions.home();
  },
  ackSafety() {
    st.data.ackSafety = true;
    persist();
    render();
  },
  info() {
    go('info');
  },
  newSetup() {
    st.draft = newSetup();
    st.wizStep = 0;
    go('wizard');
  },
  editSetup({ id }) {
    st.draft = structuredClone(setupById(id));
    st.wizStep = 0;
    go('wizard');
  },
  delSetup({ id }) {
    if (st.confirm !== `setup:${id}`) {
      st.confirm = `setup:${id}`;
      return render();
    }
    st.data.setups = st.data.setups.filter((s) => s.id !== id);
    persist();
    go('home');
  },
  wizBack() {
    st.wizStep = Math.max(0, st.wizStep - 1);
    render();
  },
  wizNext() {
    st.wizStep++;
    render();
  },
  wizSave() {
    const i = st.data.setups.findIndex((s) => s.id === st.draft.id);
    if (i >= 0) st.data.setups[i] = st.draft;
    else st.data.setups.push(st.draft);
    store.requestPersistence();
    persist();
    st.draft = null;
    go('home');
  },
  startSession({ id }) {
    st.session = null;
    st.pendingSetup = id;
    st.sensorTestOnly = false;
    st.prepError = '';
    go('prep');
  },
  sensorTest() {
    st.session = null;
    st.pendingSetup = null;
    st.sensorTestOnly = true;
    st.testShots = [];
    st.prepError = '';
    go('prep');
  },
  async startShooting() {
    const rec = new MotionRecorder();
    try {
      await rec.start({ mic: st.prep.mic });
    } catch (e) {
      st.prepError = T.prep.errors[e.message] || e.message;
      return render();
    }
    st.rec = rec;
    attachRecorder(rec);
    st.wake = await requestWakeLock();
    st.afterShot = false;
    if (!st.pendingSetup) return go('shoot');
    st.session = {
      id: store.uid(),
      setupId: st.pendingSetup,
      date: new Date().toISOString(),
      distance: st.prep.distance,
      zielY: st.prep.aim || 0,
      mode: st.prep.mode,
      firstRisk: Object.keys(st.prep.first).filter((k) => st.prep.first[k]),
      rest: null,
      groups: [{ kind: 'group', shots: [], holes: [] }],
    };
    st.data.sessions.push(st.session);
    st.groupIdx = 0;
    persist();
    rec.armed = false;
    st.restState = 'idle';
    go('rest');
  },
  restRecord() {
    if (!st.rec) return;
    st.restState = 'rec';
    render();
    const t0 = performance.now();
    const tick = setInterval(() => {
      const el = $('#restCount');
      const left = Math.max(1, Math.ceil(3 - (performance.now() - t0) / 1000));
      if (el) el.textContent = T.rest.recording(left);
    }, 200);
    setTimeout(() => {
      clearInterval(tick);
      if (!st.rec || st.screen !== 'rest') return;
      const tr = restTrace(st.rec.buf);
      const metrics = shotMetrics(tr);
      st.session.rest = metrics ? { metrics, series: aimSeries(tr) } : null;
      st.restState = 'done';
      persist();
      render();
    }, 3000);
  },
  restDone() {
    if (st.rec) st.rec.armed = true;
    go('shoot');
  },
  manualShot() {
    st.rec?.markShot();
  },
  undoShot() {
    if (!st.session) {
      (st.testShots || []).pop();
      $('#shotList').innerHTML = shotItems(st.testShots || []);
      return;
    }
    const g = currentGroup();
    const i = g.shots.length - 1;
    if (i < 0) return;
    g.shots.pop();
    g.holes.forEach((h) => {
      if (h.shot === i) h.shot = null;
    });
    persist();
    st.afterShot = false;
    if (st.rec) st.rec.armed = true;
    render();
  },
  continueShoot() {
    st.afterShot = false;
    if (st.rec) st.rec.armed = true;
    render();
  },
  photoShot() {
    const g = currentGroup();
    if (kindOf(g) === 'group' && g.shots.length >= 2) {
      st.changeFor = 'shot';
      st.adj = adjFrom(null, 'none');
      return go('change');
    }
    actions.toPhoto();
  },
  finishGroup() {
    const g = currentGroup();
    const assigned = new Set(g.holes.map((h) => h.shot));
    if (g.holes.length && g.shots.every((_, i) => assigned.has(i))) {
      stopRecorder();
      return actions.evaluate();
    }
    actions.toPhoto();
  },
  adjKind({ kind }) {
    st.adj.kind = kind;
    render();
  },
  changeBack() {
    go(st.changeFor === 'shot' ? 'shoot' : 'result');
  },
  async changeApply() {
    const adjust = adjSigned();
    const kind = st.adj.kind;
    const cur = currentGroup();
    if (st.changeFor === 'shot') {
      const shot = cur.shots[cur.shots.length - 1];
      if (kind === 'other') shot.change = 'other';
      if (kind === 'scope') {
        cur.shots.pop();
        st.session.groups.push({ kind: 'group', shots: [shot], holes: [], adjust });
        st.groupIdx = st.session.groups.length - 1;
        st.notice = T.change.split(groupNo(st.groupIdx));
      }
      persist();
      return actions.toPhoto();
    }
    let g;
    if (st.changeFor === 'control') {
      const again = kindOf(cur) === 'control';
      const prev = again ? cur.adjustTotal || { up: 0, right: 0 } : { up: 0, right: 0 };
      g = {
        kind: 'control', shots: [], holes: [], adjust,
        ref: again ? cur.ref : st.groupIdx,
        adjustTotal: { up: prev.up + adjust.up, right: prev.right + adjust.right },
      };
    } else {
      g = { kind: 'group', shots: [], holes: [], adjust };
    }
    st.session.groups.push(g);
    st.groupIdx = st.session.groups.length - 1;
    persist();
    await actions.backToShoot();
  },
  newGroup() {
    const g = currentGroup();
    const corr = kindOf(g) === 'group' ? groupCorrection(g).corr : null;
    st.adj = { ...adjFrom(corr), recommended: corr };
    st.changeFor = 'group';
    go('change');
  },
  controlShot() {
    const { corr } = groupCorrection(currentGroup());
    st.adj = { ...adjFrom(corr, 'scope'), recommended: corr };
    st.changeFor = 'control';
    go('change');
  },
  controlAgain() {
    st.adj = adjFrom(null, 'none');
    st.changeFor = 'control';
    go('change');
  },
  toggleHole({ i }) {
    const h = currentGroup().holes[+i];
    h.out = !h.out;
    persist();
    render();
  },
  toggleRaw() {
    const rec = st.rec;
    if (!rec) return;
    if (rec.raw) {
      download(`nullpunkt-rohdaten-${stamp()}.csv`, rawCsv(rec.stopRaw()));
      $('#rawBtn').textContent = T.shoot.rawStart;
    } else {
      rec.startRaw();
      $('#rawBtn').textContent = T.shoot.rawStop;
    }
  },
  exportShots() {
    download(`nullpunkt-schuesse-${stamp()}.csv`, shotsCsv());
  },
  toPhoto() {
    stopRecorder();
    st.afterShot = false;
    st.photo = { mode: 'pick' };
    go('photo');
  },
  async backToShoot() {
    if (st.viewOnly) return go('result');
    st.afterShot = false;
    if (st.rec) {
      st.rec.armed = true;
      return go('shoot');
    }
    const rec = new MotionRecorder();
    try {
      await rec.start({ mic: st.prep.mic });
    } catch (e) {
      st.notice = T.prep.errors[e.message] || e.message;
      return go('photo');
    }
    st.rec = rec;
    attachRecorder(rec);
    st.wake = await requestWakeLock();
    go('shoot');
  },
  newPhoto() {
    st.photo = { mode: 'pick' };
    render();
  },
  resetCorners() {
    if (!st.photo?.src) return;
    st.photo.mode = 'corners';
    st.photo.corners = [];
    render();
  },
  toggleZoom() {
    st.photo.zoom = st.photo.zoom > 1 ? 1 : 2;
    render();
  },
  evaluate() {
    const g = currentGroup();
    // Ausreißer nur neu vorschlagen, wenn sich die Treffer geändert haben; sonst bleibt die Auswahl des Nutzers
    if (kindOf(g) === 'group' && g.reviewedN !== g.holes.length) {
      g.flagged = [...findOutliers(g.holes)];
      g.holes.forEach((h, i) => (h.out = g.flagged.includes(i)));
      g.reviewedN = g.holes.length;
    }
    persist();
    go('result');
  },
  finishSession() {
    actions.home();
  },
  openSession({ id }) {
    st.session = st.data.sessions.find((x) => x.id === id);
    st.viewOnly = true;
    go('session');
  },
  openGroup({ i }) {
    st.groupIdx = +i;
    go('result');
  },
  delSession({ id }) {
    if (st.confirm !== `session:${id}`) {
      st.confirm = `session:${id}`;
      return render();
    }
    st.data.sessions = st.data.sessions.filter((x) => x.id !== id);
    persist();
    actions.home();
  },
  exportHoles() {
    const g = currentGroup();
    const rows = ['treffer,x_mm,y_mm'];
    g.holes.forEach((p, i) => rows.push(`${i + 1},${p.x.toFixed(1)},${p.y.toFixed(1)}`));
    download(`nullpunkt-treffer-${stamp()}.csv`, rows.join('\n'));
  },
  backup() {
    download(`nullpunkt-sicherung-${stamp()}.json`, JSON.stringify(st.data), 'application/json');
  },
  wipe() {
    if (st.confirm !== 'wipe') {
      st.confirm = 'wipe';
      return render();
    }
    localStorage.removeItem('nullpunkt.v1');
    st.data = store.load();
    go('home');
  },
};

// ---------- Ereignisse ----------

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) {
    actions[el.dataset.act]?.(el.dataset, el);
    return;
  }
  const ph = st.photo;
  if (e.target.id === 'cornerCanvas' && ph?.mode === 'corners') {
    ph.corners.push(canvasPoint(e.target, e));
    if (ph.corners.length === 4) finishCorners(ph.corners, true);
    else render();
  }
  if (e.target.id === 'rectCanvas' && ph?.mode === 'holes') {
    const [px, py] = canvasPoint(e.target, e);
    const p = { x: px / VIEW_SCALE - VIEW_R, y: VIEW_R - py / VIEW_SCALE };
    const g = currentGroup();
    const cal = caliberMm(currentSetup()?.waffe.kaliber);
    const hit = g.holes.findIndex((h) => Math.hypot(h.x - p.x, h.y - p.y) < cal * 0.8);
    if (hit >= 0) g.holes.splice(hit, 1);
    else {
      // Neues Loch dem ersten Schuss ohne Treffer zuordnen (Reihenfolge der Schüsse)
      const taken = new Set(g.holes.map((h) => h.shot));
      const shot = g.shots.findIndex((_, i) => !taken.has(i));
      g.holes.push({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), shot: shot >= 0 ? shot : null });
    }
    drawRect();
    $('#holeCount').textContent = T.photo.count(g.holes.length);
    $('[data-act="evaluate"]').disabled = !g.holes.length;
  }
});

function onBind(e) {
  const el = e.target;
  if (el.id === 'thr' && st.rec) {
    const thr = sliderToThr(+el.value);
    st.rec.threshold = thr;
    const key = (st.session?.mode || st.prep.mode) === 'trocken' ? 'thrTrocken' : 'thrScharf';
    st.data.settings[key] = +thr.toFixed(3);
    $('#thrVal').textContent = fmt(thr, 2);
    $('#meterThr').style.left = `${el.value}%`;
    if (e.type === 'change') persist();
    return;
  }
  if (!el.dataset.bind) return;
  const [root, path] = el.dataset.bind.split(':');
  const obj = bindRoot(root);
  let v = el.value;
  if ('num' in el.dataset) v = parseFloat(String(v).replace(',', '.'));
  if ('bool' in el.dataset) v = el.checked;
  setPath(obj, path, v);
  if (root === 'draft' && path === 'optik.einheit' && e.type === 'change') {
    st.draft.optik.klick = CLICK_OPTIONS[v][0][0];
    render();
  }
}
app.addEventListener('input', onBind);
app.addEventListener('change', (e) => {
  const el = e.target;
  if ((el.id === 'photoCam' || el.id === 'photoLib') && el.files[0]) return loadPhoto(el.files[0]);
  if (el.id === 'restoreFile' && el.files[0]) {
    el.files[0].text().then((txt) => {
      try {
        st.data = store.importJson(txt);
        persist();
        st.notice = T.info.restored;
      } catch {
        st.notice = T.info.restoreError;
      }
      render();
    });
    return;
  }
  onBind(e);
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && st.rec && !st.wake) st.wake = await requestWakeLock();
  if (document.visibilityState === 'hidden') st.wake = null;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

render();
