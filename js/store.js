// Alle voortgang staat lokaal op het toestel (localStorage), per taal.
const KEY = 'taal-app-v1';

const DEFAULT_SETTINGS = {
  lang: 'es',
  newPerDay: 10,
  maxReviews: 120,
  autoplay: true,
  typing: true,
  minutes: 10,
};

let state = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.langs) {
      raw.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
      return raw;
    }
  } catch (e) { /* lege of kapotte opslag: opnieuw beginnen */ }
  return { settings: { ...DEFAULT_SETTINGS }, langs: {} };
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
}

export const settings = () => state.settings;

export function setSetting(key, value) {
  state.settings[key] = value;
  save();
}

export function lang(code = state.settings.lang) {
  if (!state.langs[code]) state.langs[code] = { cards: {}, days: {}, streak: 0, lastDay: null };
  return state.langs[code];
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function today() {
  const l = lang();
  const k = dayKey();
  if (!l.days[k]) l.days[k] = { reviews: 0, newWords: 0, seconds: 0, correct: 0 };
  return l.days[k];
}

// Telt een dag mee voor de reeks zodra er die dag iets geoefend is.
export function markPracticed() {
  const l = lang();
  const k = dayKey();
  if (l.lastDay === k) return;
  const yesterday = dayKey(Date.now() - 86400000);
  l.streak = l.lastDay === yesterday ? l.streak + 1 : 1;
  l.lastDay = k;
}

export function streak() {
  const l = lang();
  const yesterday = dayKey(Date.now() - 86400000);
  return l.lastDay === dayKey() || l.lastDay === yesterday ? l.streak : 0;
}

export function exportJSON() {
  return JSON.stringify({ app: 'taal-app', exported: new Date().toISOString(), ...state });
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data.langs || !data.settings) throw new Error('Geen geldig back-upbestand');
  state = { settings: { ...DEFAULT_SETTINGS, ...data.settings }, langs: data.langs };
  save();
}

export function resetLang(code) {
  delete state.langs[code];
  save();
}
