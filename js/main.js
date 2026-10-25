import { T } from './strings.de.js';
import * as store from './store.js';
import { MotionRecorder, requestWakeLock } from './sensors.js';
import { detectMarkers, solveHomography, rectify, toGray, MARKER_MM, VIEW_R, VIEW_SCALE } from './vision.js';
import { groupStats, clickCorrection, shotMetrics, rateShot, caliberMm, CLICK_OPTIONS } from './analysis.js';
import { targetSVG } from './target.js';

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
  prep: { distance: 100, mode: 'scharf', mic: false },
  prepError: '',
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

// ---------- Hilfen ----------

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function field(root, path, label, opt = {}) {
  const obj = root === 'draft' ? st.draft : st.prep;
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
      ${field('prep', 'mode', P.mode, { options: P.modes })}
      <label class="check"><input type="checkbox" id="f-mic" data-bind="prep:mic" data-bool${st.prep.mic ? ' checked' : ''}> ${P.mic}</label>
      ${st.prepError ? `<p class="error" role="alert">${st.prepError}</p>` : ''}
    </section>
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

function screenShoot() {
  const S = T.shoot;
  const g = currentGroup();
  const test = !st.session;
  const title = test ? S.testTitle : S.title(st.groupIdx + 1, g.shots.length + 1);
  const thr = st.rec?.threshold ?? 1;
  return `<header class="bar-top"><button class="btn ghost small" data-act="stopToHome">${T.nav.home}</button><span class="pill live" id="sensState">${S.sensor} · <span id="hz">–</span> Hz</span></header>
    <section class="card">
      <h2 id="shootTitle">${title}</h2>
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
    <details class="card raw"><summary>${S.raw}</summary>
      <div class="row-btns">
        <button class="btn" data-act="toggleRaw" id="rawBtn">${st.rec?.raw ? S.rawStop : S.rawStart}</button>
        <button class="btn ghost" data-act="exportShots">${S.exportShots}</button>
      </div>
    </details>
    ${test ? '' : `<div class="actions single"><button class="btn primary" data-act="toPhoto">${S.done}</button></div>`}`;
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
    body = `<p class="muted">${ph.oriented ? P.found : P.notOriented} ${P.holes}</p>
      <div class="canvas-wrap${ph.zoom > 1 ? ' zoomed' : ''}" id="rectWrap"><canvas id="rectCanvas" width="${2 * VIEW_R * VIEW_SCALE}" height="${2 * VIEW_R * VIEW_SCALE}"></canvas></div>
      <p class="num" id="holeCount">${P.count(g.holes.length)}</p>
      <div class="row-btns">
        <button class="btn ghost" data-act="toggleZoom">${P.zoom} ${ph.zoom > 1 ? '1×' : '2×'}</button>
        <button class="btn ghost" data-act="resetCorners">${P.redo}</button>
        <button class="btn ghost" data-act="newPhoto">${P.newPhoto}</button>
      </div>`;
  }
  return `<header class="bar-top"><button class="btn ghost small" data-act="backToShoot">${T.nav.back}</button></header>
    <section class="card">
      <h2>${P.title} · Gruppe ${st.groupIdx + 1}</h2>
      ${body}
    </section>
    ${ph.mode === 'holes' ? `<div class="actions single"><button class="btn primary" data-act="evaluate"${g.holes.length ? '' : ' disabled'}>${P.evaluate}</button></div>` : ''}`;
}

function screenResult() {
  const R = T.result;
  const s = currentSetup();
  const g = currentGroup();
  const dist = st.session.distance;
  const stats = groupStats(g.holes);
  const cal = caliberMm(s?.waffe.kaliber);
  const older = st.session.groups.slice(0, st.groupIdx).flatMap((k) => k.holes || []);
  const corr = stats && s ? clickCorrection(stats.mpi, dist, s.optik.einheit, s.optik.klick) : null;
  const mrad = stats ? stats.es / dist : null;

  const counts = { ruhig: 0, unruhig: 0, verrissen: 0, unbekannt: 0 };
  g.shots.forEach((x) => counts[x.rating]++);
  const measured = g.shots.length - counts.unbekannt;
  const stab = measured
    ? `<div class="pills">${['ruhig', 'unruhig', 'verrissen'].map((k) => `<span class="pill ${k}">${counts[k]} × ${T.ratings[k]}</span>`).join('')}</div>
       ${counts.unruhig + counts.verrissen >= Math.max(1, Math.ceil(measured / 3)) ? `<p class="hint">${R.shooterHint(counts.ruhig, measured)}</p>` : ''}
       <ul class="shots">${shotItems(g.shots)}</ul>`
    : `<p class="muted">${R.stabilityNone}</p>`;

  const corrBlock = corr
    ? corr.up === 0 && corr.right === 0
      ? `<p class="ok">${R.zero}</p>`
      : `<div class="correction">
          <div><b>${Math.abs(corr.up)}</b><span>${corr.up === 0 ? R.heightOk : corr.up > 0 ? R.up : R.down}</span></div>
          <div><b>${Math.abs(corr.right)}</b><span>${corr.right === 0 ? R.sideOk : corr.right > 0 ? R.right : R.left}</span></div>
        </div>`
    : '';

  return `<header class="bar-top"><button class="btn ghost small" data-act="home">${T.nav.home}</button></header>
    <section class="card">
      <h2>${R.title(st.groupIdx + 1)}</h2>
      <div class="sheet">${targetSVG({ holes: g.holes, mpi: stats?.mpi, calDia: cal, older })}</div>
      <div class="tiles">
        <div class="tile"><small>${R.spread}</small><b class="num">${fmt(stats?.es)}</b><em>mm</em></div>
        <div class="tile"><small>${R.angle}</small><b class="num">${fmt(mrad, 2)}</b><em>mrad · ${fmt(mrad / 0.290888, 1)} MOA</em></div>
        <div class="tile"><small>${R.mpi}</small><b class="num">${stats ? `${signed(stats.mpi.x)} / ${signed(stats.mpi.y)}` : '–'}</b><em>mm rechts / hoch</em></div>
      </div>
      ${stats && stats.n < 3 ? `<p class="hint">${R.fewShots}</p>` : ''}
      <h3>${R.correction}</h3>
      ${corrBlock}
      <p class="muted small">${dist} m · ${s ? `${fmt(s.optik.klick, s.optik.klick < 0.1 ? 3 : 2)} ${esc(s.optik.einheit)} je Klick` : ''}</p>
    </section>
    <section class="card">
      <h3>${R.stability}</h3>
      ${stab}
    </section>
    <div class="actions${st.viewOnly ? ' single' : ''}">
      ${st.viewOnly ? '' : `<button class="btn" data-act="finishSession">${R.finish}</button><button class="btn primary" data-act="nextGroup">${R.next}</button>`}
    </div>
    <div class="row-btns center">
      <button class="btn ghost small" data-act="exportHoles">${R.exportHoles}</button>
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
          const stats = groupStats(g.holes || []);
          return `<li><button class="session-row" data-act="openGroup" data-i="${i}"${stats ? '' : ' disabled'}>
            <span><b>Gruppe ${i + 1}</b><small>${g.shots.length} Schuss gemessen · ${g.holes?.length || 0} Treffer</small></span>
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
  shoot: screenShoot,
  photo: screenPhoto,
  result: screenResult,
  session: screenSession,
  info: screenInfo,
};

function render() {
  const notice = st.notice ? `<p class="notice" role="alert">${st.notice}</p>` : '';
  app.innerHTML = notice + screens[st.screen]();
  st.notice = '';
  after[st.screen]?.();
}

// ---------- Nach dem Rendern ----------

const after = {
  shoot() {
    const cv = $('#live');
    const ctx = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const loop = () => {
      const rec = st.rec;
      if (!rec || st.screen !== 'shoot') return;
      $('#hz').textContent = rec.rate ? Math.round(rec.rate) : '–';
      const pct = Math.min(100, Math.max(0, thrToSlider(Math.max(rec.level, 0.05))));
      $('#meterFill').style.width = `${pct}%`;
      $('#meterFill').classList.toggle('hot', rec.level > rec.threshold);
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
  },
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
  let shots;
  if (st.session) {
    shots = currentGroup().shots;
    shots.push(shot);
    persist();
    const t = $('#shootTitle');
    if (t) t.textContent = T.shoot.title(st.groupIdx + 1, shots.length + 1);
  } else {
    st.testShots = st.testShots || [];
    st.testShots.push(shot);
    shots = st.testShots;
  }
  const list = $('#shotList');
  if (list) list.innerHTML = shotItems(shots);
  navigator.vibrate?.(60);
  flash(`Schuss erkannt: ${T.ratings[shot.rating]}`);
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
    if (st.pendingSetup) {
      st.session = {
        id: store.uid(),
        setupId: st.pendingSetup,
        date: new Date().toISOString(),
        distance: st.prep.distance,
        mode: st.prep.mode,
        groups: [{ shots: [], holes: [] }],
      };
      st.data.sessions.push(st.session);
      st.groupIdx = 0;
      persist();
    }
    st.rec = rec;
    attachRecorder(rec);
    st.wake = await requestWakeLock();
    go('shoot');
  },
  manualShot() {
    st.rec?.markShot();
  },
  undoShot() {
    const shots = st.session ? currentGroup().shots : st.testShots || [];
    shots.pop();
    if (st.session) persist();
    $('#shotList').innerHTML = shotItems(shots);
    const t = $('#shootTitle');
    if (t && st.session) t.textContent = T.shoot.title(st.groupIdx + 1, shots.length + 1);
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
    st.photo = { mode: 'pick' };
    go('photo');
  },
  async backToShoot() {
    if (st.viewOnly) return go('result');
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
    persist();
    go('result');
  },
  nextGroup() {
    st.session.groups.push({ shots: [], holes: [] });
    st.groupIdx = st.session.groups.length - 1;
    persist();
    actions.backToShoot();
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
    else g.holes.push({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) });
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
  const obj = root === 'draft' ? st.draft : st.prep;
  let v = el.value;
  if ('num' in el.dataset) v = parseFloat(v);
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
