// Bildverarbeitung: Eckmarken finden, Homographie, Entzerrung der Scheibe.
// Koordinaten auf der Scheibe in mm, Ursprung = Haltepunkt, x nach rechts, y nach oben.

export const MARKER_OFFSET = 85; // Abstand Markenmitte zum Haltepunkt (mm)
export const MARKER_SIZE = 20; // Kantenlänge der Marken (mm)
export const VIEW_R = 100; // entzerrter Ausschnitt: ±100 mm
export const VIEW_SCALE = 4; // Pixel je mm im entzerrten Bild

// Reihenfolge immer: oben links, oben rechts, unten rechts, unten links
export const MARKER_MM = [
  [-MARKER_OFFSET, MARKER_OFFSET],
  [MARKER_OFFSET, MARKER_OFFSET],
  [MARKER_OFFSET, -MARKER_OFFSET],
  [-MARKER_OFFSET, -MARKER_OFFSET],
];

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('singular');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Homographie, die src-Punkte auf dst-Punkte abbildet (je 4 Punkte [x, y])
export function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solveLinear(A, b), 1];
}

export function applyH(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function toGray(imageData) {
  const { data, width, height } = imageData;
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return g;
}

// Sucht die vier schwarzen Eckmarken. Rückgabe: { corners: [[x,y] x4], oriented } oder null.
// oriented = true, wenn die Marke mit weißem Kern (oben links) gefunden wurde.
export function detectMarkers(gray, w, h) {
  const W1 = w + 1;
  const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      s += gray[y * w + x];
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + s;
    }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 10));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x];
      mask[y * w + x] = v < mean * 0.7 && v < 170 ? 1 : 0;
    }
  }

  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    next++;
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    const total = w * h;
    if (area < total * 0.0003 || area > total * 0.05) continue;
    if (minx === 0 || miny === 0 || maxx === w - 1 || maxy === h - 1) continue;
    const aspect = bw / bh;
    if (aspect < 0.5 || aspect > 2) continue;
    if (area / (bw * bh) < 0.55) continue;
    blobs.push({ area, cx: sx / area, cy: sy / area, bw, bh });
  }
  if (blobs.length < 4) return null;

  // Marke mit weißem Kern: in der Mitte liegt kein dunkles Pixel
  for (const b of blobs) {
    const cx = Math.round(b.cx);
    const cy = Math.round(b.cy);
    let dark = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dark += mask[(cy + dy) * w + cx + dx];
    b.hole = dark <= 2;
  }

  const cand = blobs.sort((a, b) => b.area - a.area).slice(0, 16);
  let best = null;
  const n = cand.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const q = [cand[a], cand[b], cand[c], cand[d]];
    const areas = q.map((k) => k.area);
    if (Math.max(...areas) / Math.min(...areas) > 4) continue;
    const mx = q.reduce((s, k) => s + k.cx, 0) / 4;
    const my = q.reduce((s, k) => s + k.cy, 0) / 4;
    q.sort((p1, p2) => Math.atan2(p1.cy - my, p1.cx - mx) - Math.atan2(p2.cy - my, p2.cx - mx));
    let convex = true;
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const p0 = q[i], p1 = q[(i + 1) % 4], p2 = q[(i + 2) % 4];
      const cross = (p1.cx - p0.cx) * (p2.cy - p1.cy) - (p1.cy - p0.cy) * (p2.cx - p1.cx);
      if (cross <= 0) convex = false;
      area2 += p0.cx * p1.cy - p1.cx * p0.cy;
    }
    if (!convex) continue;
    const side = (i) => Math.hypot(q[i].cx - q[(i + 1) % 4].cx, q[i].cy - q[(i + 1) % 4].cy);
    const s = [0, 1, 2, 3].map(side);
    if (Math.max(s[0], s[2]) / Math.min(s[0], s[2]) > 2.5 || Math.max(s[1], s[3]) / Math.min(s[1], s[3]) > 2.5) continue;
    // Marken müssen deutlich kleiner sein als ihr Abstand (Verhältnis auf der Scheibe 20:170)
    const markerSide = Math.sqrt(areas.reduce((x, y) => x + y, 0) / 4);
    const meanSide = s.reduce((x, y) => x + y, 0) / 4;
    if (markerSide / meanSide > 0.25 || markerSide / meanSide < 0.05) continue;
    const score = Math.abs(area2) / 2;
    if (!best || score > best.score) best = { score, q };
  }
  if (!best) return null;

  // Bildschirmkoordinaten (y nach unten): aufsteigender Winkel ergibt OL, OR, UR, UL
  let q = best.q;
  const holes = q.filter((k) => k.hole);
  let oriented = false;
  let startIdx;
  if (holes.length === 1) {
    startIdx = q.indexOf(holes[0]);
    oriented = true;
  } else {
    startIdx = q.reduce((bi, k, i) => (k.cx + k.cy < q[bi].cx + q[bi].cy ? i : bi), 0);
  }
  q = [...q.slice(startIdx), ...q.slice(0, startIdx)];
  return { corners: q.map((k) => [k.cx, k.cy]), oriented };
}

// Entzerrt das Foto auf ein quadratisches Bild ±VIEW_R mm mit VIEW_SCALE px/mm.
// Hmm2px: Homographie von Scheiben-mm auf Foto-Pixel.
export function rectify(src, Hmm2px, R = VIEW_R, s = VIEW_SCALE) {
  const size = Math.round(2 * R * s);
  const out = new Uint8ClampedArray(size * size * 4);
  const { data, width, height } = src;
  for (let v = 0; v < size; v++) {
    const ymm = R - (v + 0.5) / s;
    for (let u = 0; u < size; u++) {
      const xmm = -R + (u + 0.5) / s;
      const [px, py] = applyH(Hmm2px, [xmm, ymm]);
      const o = (v * size + u) * 4;
      const x0 = Math.floor(px - 0.5);
      const y0 = Math.floor(py - 0.5);
      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) {
        out[o] = out[o + 1] = out[o + 2] = 40;
        out[o + 3] = 255;
        continue;
      }
      const fx = px - 0.5 - x0;
      const fy = py - 0.5 - y0;
      const i00 = (y0 * width + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + width * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] =
          data[i00 + c] * (1 - fx) * (1 - fy) + data[i10 + c] * fx * (1 - fy) + data[i01 + c] * (1 - fx) * fy + data[i11 + c] * fx * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: size, height: size };
}
