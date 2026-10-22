// FSRS-4.5 (Free Spaced Repetition Scheduler) met standaardgewichten.
// Rating: 1 = Opnieuw, 2 = Moeilijk, 3 = Goed, 4 = Makkelijk.

const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const MAX_INTERVAL = 365;
const DAY = 86400000;
const MIN = 60000;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays, stability) {
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

function intervalDays(stability) {
  const i = stability / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(i), 1, MAX_INTERVAL);
}

const initDifficulty = (g) => clamp(W[4] - (g - 3) * W[5], 1, 10);

function nextDifficulty(d, g) {
  const next = d - W[6] * (g - 3);
  return clamp(W[7] * initDifficulty(3) + (1 - W[7]) * next, 1, 10);
}

function recallStability(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}

function forgetStability(d, s, r) {
  return W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r));
}

export function newCardState() {
  return { state: 'new', due: 0, s: 0, d: 0, reps: 0, lapses: 0, last: 0 };
}

// Geeft de nieuwe kaartstatus terug. Kaarten die "Opnieuw" krijgen komen
// over 10 minuten terug (en worden binnen de sessie opnieuw gevraagd).
export function schedule(card, g, now = Date.now()) {
  const c = { ...card, reps: card.reps + 1, last: now };
  if (card.state === 'new') {
    c.s = W[g - 1];
    c.d = initDifficulty(g);
  } else {
    const elapsed = Math.max(0, (now - card.last) / DAY);
    const r = retrievability(elapsed, card.s);
    c.d = nextDifficulty(card.d, g);
    if (g === 1) {
      c.s = Math.min(card.s, forgetStability(card.d, card.s, r));
      c.lapses = card.lapses + 1;
    } else if (elapsed < 0.5) {
      // Herhaling op dezelfde dag: stabiliteit nauwelijks laten groeien.
      c.s = card.s * (g === 4 ? 1.3 : g === 3 ? 1.1 : 1);
    } else {
      c.s = recallStability(card.d, card.s, r, g);
    }
  }
  if (g === 1) {
    c.state = 'relearning';
    c.due = now + 10 * MIN;
  } else {
    c.state = 'review';
    c.due = startOfDay(now) + intervalDays(c.s) * DAY + 4 * 3600000;
  }
  return c;
}

// Voor de knoppen: hoeveel tijd tot de volgende herhaling per beoordeling.
export function preview(card, now = Date.now()) {
  return [1, 2, 3, 4].map((g) => formatInterval(schedule(card, g, now).due - now));
}

export function formatInterval(ms) {
  if (ms < 3600000) return `${Math.max(1, Math.round(ms / MIN))} min`;
  // In kalenderdagen, zodat "morgen" altijd 1 d is, ongeacht het tijdstip.
  const now = Date.now();
  const days = Math.max(1, Math.round((startOfDay(now + ms) - startOfDay(now)) / DAY));
  if (days < 31) return `${days} d`;
  if (days < 365) return `${Math.round(days / 30)} mnd`;
  return `${(days / 365).toFixed(1)} jr`;
}

export function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
