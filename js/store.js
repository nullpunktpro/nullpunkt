// Alle Daten bleiben auf dem Gerät (localStorage). Kein Server, kein Konto.

const KEY = 'nullpunkt.v1';

const empty = () => ({
  version: 1,
  ackSafety: false,
  setups: [],
  sessions: [],
  settings: { thrScharf: 8, thrTrocken: 0.4 },
});

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.version === 1) return { ...empty(), ...d, settings: { ...empty().settings, ...d.settings } };
  } catch {}
  return empty();
}

export function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function importJson(text) {
  const d = JSON.parse(text);
  if (!d || d.version !== 1 || !Array.isArray(d.setups) || !Array.isArray(d.sessions)) throw new Error('format');
  return { ...empty(), ...d, settings: { ...empty().settings, ...d.settings } };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
