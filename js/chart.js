// Überlagerung: Abstand vom Haltepunkt vor dem Schuss, je Schuss eine Linie, Ruhemessung als graue Fläche.
// x: Zeit bis zum Schuss (−1,5 s … 0), y: mrad (rechts in cm auf der gewählten Distanz).

const W = 340, H = 170, L = 34, R = 40, TOP = 10, B = 24;

export function aimChart({ shots = [], rest = null, distanceM = 100 }) {
  // Aussortierte Schüsse bestimmen die Skala nicht, sonst verschwinden die ruhigen in der Nulllinie
  const scaled = shots.some((s) => !s.out) ? shots.filter((s) => !s.out) : shots;
  const all = [...scaled.flatMap((s) => s.series.map((p) => p[1])), ...(rest || []).map((p) => p[1])];
  if (!all.length) return '';
  const steps = [0.25, 0.5, 1, 2, 3, 5, 10];
  const yMax = steps.find((v) => v >= Math.max(...all) * 1.05) ?? Math.ceil(Math.max(...all));
  const x = (t) => L + ((t + 1500) / 1500) * (W - L - R);
  const y = (v) => TOP + (1 - Math.min(v, yMax) / yMax) * (H - TOP - B);
  const line = (s) => s.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join('');

  const grid = [0, 0.5, 1].map((f) => {
    const v = yMax * f;
    const cm = (v * distanceM) / 10;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/>
      <text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>
      <text x="${W - R + 4}" y="${y(v) + 3}">${fmt(cm)} cm</text>`;
  }).join('');
  const ticks = [-1500, -1000, -500, 0].map((t) => `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${t ? fmt(t / 1000) + ' s' : 'Schuss'}</text>`).join('');

  const restArea = rest?.length
    ? `<path d="${line(rest)}L${x(rest[rest.length - 1][0])} ${y(0)}L${x(rest[0][0])} ${y(0)}Z" class="ch-rest"/>`
    : '';
  const lines = shots
    .map((s) => {
      const first = s.series[0];
      return `<path d="${line(s.series)}" class="ch-shot ${s.rating}${s.out ? ' out' : ''}"/>
        <text x="${x(first[0]) + 2}" y="${y(first[1]) - 3}" class="ch-label ${s.rating}">${s.label}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="aim-chart" role="img" aria-label="Abstand vom Haltepunkt vor jedem Schuss">
    ${grid}${ticks}${restArea}${lines}
    <line x1="${x(0)}" x2="${x(0)}" y1="${TOP}" y2="${H - B}" class="ch-zero"/>
  </svg>`;
}

function fmt(v) {
  return v.toLocaleString('de-DE', { maximumFractionDigits: v < 1 && v > 0 ? 2 : 1 });
}
