// Scheibe als SVG für die Ergebnisansicht (gleiche Geometrie wie die Druckvorlage).
import { MARKER_MM, MARKER_SIZE } from './vision.js';
import { T } from './i18n.js';

// holes: [{x, y, out?}] – aussortierte Treffer erscheinen hohl. aim: Zielpunkt (z. B. GEE 4 cm hoch).
// expect: {x, y, r} – Erwartungskreis für den Kontrollschuss.
export function targetSVG({ holes = [], mpi = null, calDia = 7.8, older = [], aim = null, expect = null } = {}) {
  const lines = [];
  for (let v = -70; v <= 70; v += 10) {
    const strong = v % 50 === 0;
    const sw = strong ? 0.5 : 0.2;
    const col = strong ? 'var(--grid-strong)' : 'var(--grid)';
    lines.push(`<line x1="${v}" y1="-70" x2="${v}" y2="70" stroke="${col}" stroke-width="${sw}"/>`);
    lines.push(`<line x1="-70" y1="${v}" x2="70" y2="${v}" stroke="${col}" stroke-width="${sw}"/>`);
  }
  const half = MARKER_SIZE / 2;
  const markers = MARKER_MM.map(([x, y], i) => {
    const core = i === 0 ? `<rect x="${x - 4}" y="${-y - 4}" width="8" height="8" fill="var(--paper)"/>` : '';
    return `<rect x="${x - half}" y="${-y - half}" width="${MARKER_SIZE}" height="${MARKER_SIZE}" fill="var(--paper-ink)"/>${core}`;
  }).join('');
  const arms = [
    [-1, 8, 2, 22], [-1, -30, 2, 22], [8, -1, 22, 2], [-30, -1, 22, 2],
  ].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--paper-ink)"/>`).join('');
  const r = calDia / 2;
  const old = older.map((p) => `<circle cx="${p.x}" cy="${-p.y}" r="${r}" fill="none" stroke="var(--muted)" stroke-width="0.6" stroke-dasharray="1.2 1"/>`).join('');
  const shots = holes.map((p, i) => {
    const dot = p.out
      ? `<circle cx="${p.x}" cy="${-p.y}" r="${r}" fill="none" stroke="var(--bad)" stroke-width="0.9"/><path d="M${p.x - r} ${-p.y - r}L${p.x + r} ${-p.y + r}" stroke="var(--bad)" stroke-width="0.7"/>`
      : `<circle cx="${p.x}" cy="${-p.y}" r="${r}" fill="var(--hole)"/>`;
    return `${dot}<text x="${p.x + r + 1}" y="${-p.y - r}" font-size="5" fill="${p.out ? 'var(--bad)' : 'var(--paper-ink)'}" font-family="ui-monospace,monospace">${p.label ?? i + 1}</text>`;
  }).join('');
  const m = mpi
    ? `<g stroke="var(--accent)" stroke-width="1.2"><line x1="${mpi.x - 7}" y1="${-mpi.y}" x2="${mpi.x + 7}" y2="${-mpi.y}"/><line x1="${mpi.x}" y1="${-mpi.y - 7}" x2="${mpi.x}" y2="${-mpi.y + 7}"/></g>`
    : '';
  const a = aim && (aim.x || aim.y)
    ? `<circle cx="${aim.x}" cy="${-aim.y}" r="3" fill="none" stroke="var(--good)" stroke-width="1"/><circle cx="${aim.x}" cy="${-aim.y}" r="0.8" fill="var(--good)"/>`
    : '';
  const e = expect
    ? `<circle cx="${expect.x}" cy="${-expect.y}" r="${expect.r}" fill="none" stroke="var(--accent)" stroke-width="0.8" stroke-dasharray="2 1.5"/>`
    : '';
  return `<svg viewBox="-100 -100 200 200" role="img" aria-label="${T.targetAria}">
  <rect x="-100" y="-100" width="200" height="200" fill="var(--paper)"/>
  ${lines.join('')}
  <circle r="40" fill="none" stroke="var(--paper-ink)" stroke-width="0.5"/>
  ${arms}
  <path d="M-3 0H3M0 -3V3" stroke="var(--paper-ink)" stroke-width="0.3"/>
  ${markers}${old}${a}${e}${shots}${m}
</svg>`;
}
