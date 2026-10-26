// Auswertung: Trefferbild, Klickkorrektur, Ruhe vor dem Schuss.

export const MOA_IN_MRAD = 0.290888;

export const CLICK_OPTIONS = {
  mrad: [
    [0.1, '0,1 mrad (1 cm auf 100 m)'],
    [0.05, '0,05 mrad (0,5 cm auf 100 m)'],
    [0.2, '0,2 mrad (2 cm auf 100 m)'],
  ],
  MOA: [
    [0.25, '1/4 MOA (ca. 0,73 cm auf 100 m)'],
    [0.125, '1/8 MOA (ca. 0,36 cm auf 100 m)'],
    [0.5, '1/2 MOA (ca. 1,45 cm auf 100 m)'],
    [1, '1 MOA (ca. 2,9 cm auf 100 m)'],
  ],
};

// Geschossdurchmesser in mm aus der Kaliberangabe (".308 Win", "8x57 IS", "9,3x62")
export function caliberMm(kaliber) {
  const s = String(kaliber || '').trim().replace(',', '.');
  const inch = s.match(/^\.(\d+)/);
  if (inch) return parseFloat('0.' + inch[1]) * 25.4;
  const mm = parseFloat(s);
  return isFinite(mm) && mm > 2 && mm < 20 ? mm : 7.8;
}

// holes: [{x, y}] in mm relativ zum Haltepunkt (y nach oben)
export function groupStats(holes) {
  const n = holes.length;
  if (!n) return null;
  const mpi = {
    x: holes.reduce((s, p) => s + p.x, 0) / n,
    y: holes.reduce((s, p) => s + p.y, 0) / n,
  };
  let es = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) es = Math.max(es, Math.hypot(holes[i].x - holes[j].x, holes[i].y - holes[j].y));
  const meanRadius = holes.reduce((s, p) => s + Math.hypot(p.x - mpi.x, p.y - mpi.y), 0) / n;
  return { n, mpi, es, meanRadius };
}

export function clickMrad(einheit, klick) {
  return einheit === 'MOA' ? klick * MOA_IN_MRAD : klick;
}

// Klicks, um den mittleren Treffpunkt auf den Haltepunkt zu schieben.
// up > 0: Höhe nach oben drehen, right > 0: Seite nach rechts drehen.
export function clickCorrection(mpi, distanceM, einheit, klick) {
  const c = clickMrad(einheit, klick);
  return {
    up: Math.round(-mpi.y / distanceM / c) || 0,
    right: Math.round(-mpi.x / distanceM / c) || 0,
  };
}

// trace: [{t (ms, Schuss = 0), gx, gy, gz (rad/s), ax, ay, az (m/s²)}]
// Liefert Unruhe (mrad/s), Wanderung des Haltepunkts in den letzten 0,5 s (mrad) und Abzugsruck (Faktor).
export function shotMetrics(trace) {
  const pre = trace.filter((s) => s.t >= -1500 && s.t <= -30);
  if (pre.length < 10) return null;
  const median = (k) => {
    const v = pre.map((s) => s[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const b = { gx: median('gx'), gy: median('gy'), gz: median('gz') };
  const mag = (s) => Math.hypot(s.gx - b.gx, s.gy - b.gy, s.gz - b.gz);
  const rmsOf = (arr) => (arr.length ? Math.sqrt(arr.reduce((a, s) => a + mag(s) ** 2, 0) / arr.length) : 0);

  const win = pre.filter((s) => s.t >= -500);
  const rms = rmsOf(win) * 1000;

  let ang = [0, 0, 0];
  const path = [ang];
  for (let i = 1; i < win.length; i++) {
    const dt = (win[i].t - win[i - 1].t) / 1000;
    ang = [ang[0] + (win[i].gx - b.gx) * dt, ang[1] + (win[i].gy - b.gy) * dt, ang[2] + (win[i].gz - b.gz) * dt];
    path.push(ang);
  }
  const end = path[path.length - 1];
  const wander = Math.max(...path.map((p) => Math.hypot(p[0] - end[0], p[1] - end[1], p[2] - end[2]))) * 1000;

  const late = pre.filter((s) => s.t >= -120);
  const early = pre.filter((s) => s.t < -150);
  const peakLate = late.length ? Math.max(...late.map(mag)) * 1000 : 0;
  const jerk = peakLate / (rmsOf(early) * 1000 + 2);

  return { rms, wander, jerk };
}

// Vorläufige Schwellen – werden mit echten Trocken- und Scharfschussdaten kalibriert.
export function rateShot(m) {
  if (!m) return 'unbekannt';
  if (m.wander < 0.5 && m.jerk < 4) return 'ruhig';
  if (m.wander < 1.5 && m.jerk < 8) return 'unruhig';
  return 'verrissen';
}

// Abstand vom Haltepunkt im Schussmoment (mrad) über die Zeit, normiert auf den Schuss:
// bei t = −30 ms ist der Wert 0, davor sieht man, wie weit die Waffe noch weg war.
// Liefert [[t, mrad]] im Raster von stepMs.
export function aimSeries(trace, stepMs = 20) {
  const pre = trace.filter((s) => s.t >= -1500 && s.t <= -30);
  if (pre.length < 10) return [];
  const median = (k) => {
    const v = pre.map((s) => s[k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const b = [median('gx'), median('gy'), median('gz')];
  let ang = [0, 0, 0];
  const path = [{ t: pre[0].t, a: ang }];
  for (let i = 1; i < pre.length; i++) {
    const dt = (pre[i].t - pre[i - 1].t) / 1000;
    ang = [ang[0] + (pre[i].gx - b[0]) * dt, ang[1] + (pre[i].gy - b[1]) * dt, ang[2] + (pre[i].gz - b[2]) * dt];
    path.push({ t: pre[i].t, a: ang });
  }
  const end = path[path.length - 1].a;
  const out = [];
  let next = -Infinity;
  for (const p of path) {
    if (p.t < next && p !== path[path.length - 1]) continue;
    out.push([p.t, Math.hypot(p.a[0] - end[0], p.a[1] - end[1], p.a[2] - end[2]) * 1000]);
    next = p.t + stepMs;
  }
  return out;
}

// Ruhemessung: die letzten 1,8 s des Puffers so verschieben, dass sie wie die Zeit vor einem Schuss aussehen.
export function restTrace(buf) {
  if (!buf.length) return [];
  const end = buf[buf.length - 1].t;
  return buf.filter((s) => s.t >= end - 1800).map((s) => ({ ...s, t: Math.round((s.t - end) * 10) / 10 }));
}

// Ausreißer in einer Gruppe: Treffer, der weit außerhalb der Streuung der übrigen liegt.
// Iterativ, höchstens max(1, n/4) Treffer; es bleiben immer mindestens 2 übrig.
export function findOutliers(holes) {
  const n = holes.length;
  const flagged = new Set();
  if (n < 3) return flagged;
  const limit = Math.max(1, Math.floor(n / 4));
  while (flagged.size < limit) {
    let worst = -1;
    let worstRatio = 0;
    holes.forEach((p, i) => {
      if (flagged.has(i)) return;
      const others = holes.filter((_, j) => j !== i && !flagged.has(j));
      const s = groupStats(others);
      const d = Math.hypot(p.x - s.mpi.x, p.y - s.mpi.y);
      const ref = Math.max(s.meanRadius, 4);
      const ratio = d / ref;
      if (d > 12 && ratio > 2.5 && ratio > worstRatio) {
        worst = i;
        worstRatio = ratio;
      }
    });
    if (worst < 0) break;
    flagged.add(worst);
  }
  return flagged;
}

// Bewertung eines Kontrollschusses gegen die Referenzgruppe.
// expect: erwartete Treffpunktlage nach der Verstellung, aim: Zielpunkt (Fleck oder GEE).
export function controlCheck({ hole, ref, adjust, aim, distanceM, einheit, klick, calm }) {
  const c = clickMrad(einheit, klick) * distanceM; // mm je Klick auf der Scheibe
  const expect = { x: ref.mpi.x + adjust.right * c, y: ref.mpi.y + adjust.up * c };
  const r = Math.max(ref.es / 2, 1.5 * c);
  const dExpect = Math.hypot(hole.x - expect.x, hole.y - expect.y);
  const dAim = Math.hypot(hole.x - aim.x, hole.y - aim.y);
  let verdict;
  if (dExpect <= r && dAim <= r) verdict = 'ok';
  else if (dExpect <= r) verdict = 'rest';
  else if (calm === false) verdict = 'shooter';
  else verdict = 'off';
  return { expect, r, dExpect, dAim, verdict, rest: clickCorrection({ x: hole.x - aim.x, y: hole.y - aim.y }, distanceM, einheit, klick) };
}
