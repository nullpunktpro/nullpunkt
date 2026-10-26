import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveHomography, applyH, detectMarkers, rectify, MARKER_MM } from '../js/vision.js';
import { groupStats, clickCorrection, caliberMm, shotMetrics, rateShot, findOutliers, aimSeries, controlCheck } from '../js/analysis.js';

// Scheibenmotiv in mm: Marken, Raster, Fadenkreuz, zwei Einschusslöcher
function targetLum(x, y) {
  for (const [mx, my] of MARKER_MM) {
    if (Math.abs(x - mx) <= 10 && Math.abs(y - my) <= 10) {
      const tl = mx < 0 && my > 0;
      return tl && Math.abs(x - mx) <= 4 && Math.abs(y - my) <= 4 ? 235 : 25;
    }
  }
  if (Math.hypot(x - 12, y + 20) < 3.9 || Math.hypot(x + 5, y - 8) < 3.9) return 30;
  const r = Math.hypot(x, y);
  if (r > 8 && r < 30 && (Math.abs(x) < 1 || Math.abs(y) < 1)) return 20;
  if (Math.abs(x) <= 70 && Math.abs(y) <= 70 && (Math.abs(x % 10) < 0.2 || Math.abs(y % 10) < 0.2)) return 185;
  if (Math.abs(x) > 105 || y > 130 || y < -150) return 60; // Tisch neben dem Papier
  return 235;
}

function synthPhoto(w, h, cornersPx) {
  const Hpx2mm = solveHomography(cornersPx, MARKER_MM);
  const g = new Uint8Array(w * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 12;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [mx, my] = applyH(Hpx2mm, [x, y]);
      const shade = 1 - 0.25 * (x / w); // Lichtverlauf
      g[y * w + x] = Math.max(0, Math.min(255, targetLum(mx, my) * shade + rnd()));
    }
  return g;
}

test('Homographie bildet die vier Punkte exakt ab', () => {
  const dst = [[100, 80], [520, 110], [500, 560], [90, 520]];
  const H = solveHomography(MARKER_MM, dst);
  MARKER_MM.forEach((p, i) => {
    const q = applyH(H, p);
    assert.ok(Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]) < 1e-6);
  });
});

test('Eckmarken werden in einem schräg fotografierten Bild gefunden', () => {
  const w = 700, h = 900;
  const corners = [[150, 210], [560, 250], [540, 700], [130, 650]];
  const g = synthPhoto(w, h, corners);
  const det = detectMarkers(g, w, h);
  assert.ok(det, 'keine Marken gefunden');
  assert.equal(det.oriented, true);
  det.corners.forEach((p, i) => {
    const err = Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]);
    assert.ok(err < 3, `Marke ${i} weicht ${err.toFixed(1)} px ab`);
  });
});

test('Gedrehtes Foto: Marke oben links wird über den weißen Kern erkannt', () => {
  const w = 700, h = 900;
  // Scheibe um 180° gedreht im Bild
  const corners = [[560, 700], [150, 680], [160, 230], [550, 240]];
  const g = synthPhoto(w, h, corners);
  const det = detectMarkers(g, w, h);
  assert.ok(det);
  assert.equal(det.oriented, true);
  assert.ok(Math.hypot(det.corners[0][0] - 560, det.corners[0][1] - 700) < 3);
});

test('Einschusslöcher landen nach der Entzerrung an der richtigen Stelle (mm)', () => {
  const w = 700, h = 900;
  const corners = [[150, 210], [560, 250], [540, 700], [130, 650]];
  const g = synthPhoto(w, h, corners);
  const det = detectMarkers(g, w, h);
  const H = solveHomography(MARKER_MM, det.corners);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g[i];
  const rect = rectify({ data: rgba, width: w, height: h }, H);
  // Loch bei (12, -20) mm -> Pixel im entzerrten Bild
  const u = Math.round((12 + 100) * 4), v = Math.round((100 + 20) * 4);
  assert.ok(rect.data[(v * rect.width + u) * 4] < 90, 'Loch nicht dunkel an erwarteter Stelle');
  const u2 = Math.round((40 + 100) * 4), v2 = Math.round((100 - 45) * 4);
  assert.ok(rect.data[(v2 * rect.width + u2) * 4] > 150, 'freie Fläche ist nicht hell');
});

test('Trefferbild und Klickkorrektur', () => {
  const s = groupStats([{ x: 31, y: -50 }, { x: 41, y: -60 }, { x: 36, y: -40 }]);
  assert.deepEqual(s.mpi, { x: 36, y: -50 });
  assert.ok(Math.abs(s.es - Math.hypot(5, 20)) < 1e-9);
  // 100 m, 0,1 mrad: 50 mm tief -> 5 Klicks hoch, 36 mm rechts -> 4 Klicks links
  assert.deepEqual(clickCorrection(s.mpi, 100, 'mrad', 0.1), { up: 5, right: -4 });
  // 1/4 MOA auf 100 m = 7,27 mm/Klick
  assert.deepEqual(clickCorrection({ x: 0, y: -29.1 }, 100, 'MOA', 0.25), { up: 4, right: 0 });
});

test('Kaliberdurchmesser', () => {
  assert.ok(Math.abs(caliberMm('.308 Win') - 7.82) < 0.01);
  assert.equal(caliberMm('9,3x62'), 9.3);
  assert.equal(caliberMm('6.5 Creedmoor'), 6.5);
  assert.equal(caliberMm('???'), 7.8);
});

test('Ruhige und verrissene Schüsse werden unterschieden', () => {
  const mk = (jerkAmp) => {
    const tr = [];
    for (let t = -1500; t <= 300; t += 16.7) {
      const noise = Math.sin(t / 37) * 0.002;
      const jerk = t > -100 && t < -30 ? jerkAmp : 0;
      tr.push({ t, gx: noise + jerk, gy: noise * 0.5, gz: 0.001, ax: 0, ay: 0, az: 0 });
    }
    return tr;
  };
  assert.equal(rateShot(shotMetrics(mk(0))), 'ruhig');
  assert.equal(rateShot(shotMetrics(mk(0.08))), 'verrissen');
});

test('Ausreißer: Ölschuss wird erkannt, enge Gruppe bleibt unberührt', () => {
  const group = [{ x: 2, y: 1 }, { x: -3, y: 4 }, { x: 1, y: -5 }, { x: 4, y: 2 }, { x: -2, y: -1 }];
  assert.equal(findOutliers(group).size, 0);
  const withFlyer = [{ x: 45, y: -60 }, ...group.slice(1)];
  assert.deepEqual([...findOutliers(withFlyer)], [0]);
  assert.equal(findOutliers(group.slice(0, 2)).size, 0);
});

test('Haltepunktverlauf ist zum Schuss hin auf 0 normiert', () => {
  const tr = [];
  for (let t = -1500; t <= 300; t += 10) tr.push({ t, gx: t < -500 ? 0.002 : 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0 });
  const s = aimSeries(tr);
  assert.ok(s.length > 50);
  assert.equal(s[s.length - 1][1], 0);
  assert.ok(s[0][1] > s[s.length - 1][1]);
});

test('Kontrollschuss: im Streukreis, Restkorrektur und Schützenfehler', () => {
  const ref = groupStats([{ x: 30, y: -40 }, { x: 40, y: -50 }, { x: 35, y: -45 }]);
  const base = { ref, aim: { x: 0, y: 40 }, distanceM: 100, einheit: 'mrad', klick: 0.1 };
  // Empfehlung 8,5 hoch / 3,5 links -> 9 hoch, 4 links gedreht: Erwartung (−5, 45)
  const ok = controlCheck({ ...base, hole: { x: -3, y: 42 }, adjust: { up: 9, right: -4 }, calm: true });
  assert.equal(ok.verdict, 'ok');
  assert.deepEqual(ok.expect, { x: -5, y: 45 });
  const rest = controlCheck({ ...base, hole: { x: 33, y: 2 }, adjust: { up: 5, right: 0 }, calm: true });
  assert.equal(rest.verdict, 'rest');
  assert.deepEqual(rest.rest, { up: 4, right: -3 });
  assert.equal(controlCheck({ ...base, hole: { x: 60, y: 60 }, adjust: { up: 9, right: -4 }, calm: false }).verdict, 'shooter');
  assert.equal(controlCheck({ ...base, hole: { x: 60, y: 60 }, adjust: { up: 9, right: -4 }, calm: true }).verdict, 'off');
});
