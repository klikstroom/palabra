import { schedule, preview, formatInterval, retrievability, newCardState, startOfDay } from './fsrs.js';
import * as store from './store.js';
import { LANGS, POS, parseDeck } from './langs.js';

const DAY = 86400000;
const KNOWN_DAYS = 21;        // vanaf deze stabiliteit telt een woord als "gekend"
const PRODUCE_AFTER = 3;      // actief produceren start als herkenning ≥ 3 dagen stabiel is
const GROUP = 5;              // nieuwe woorden per blokje: 5 uitleggen, dan 5 overhoren

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
let deck = [];
let byId = new Map();
let tab = 'home';
let session = null;
let wordFilter = { q: '', status: 'all' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cards = () => store.lang().cards;
const wordOf = (key) => byId.get(key.slice(0, key.lastIndexOf(':')));
const L = () => LANGS[store.settings().lang];

// ---------- Uitspraak ----------
let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function speak(text, rate = 0.9) {
  if (!window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const code = L().voice;
  u.lang = code;
  const v = voices.find((v) => v.lang.replace('_', '-') === code) ||
    voices.find((v) => v.lang.startsWith(code.slice(0, 2)));
  if (v) u.voice = v;
  u.rate = rate;
  speechSynthesis.speak(u);
}

// ---------- Planning ----------
function dueKeys(now = Date.now()) {
  const c = cards();
  const r = (k) => c[k].state === 'new' ? 0.8 : retrievability((now - c[k].last) / DAY, c[k].s);
  return Object.keys(c)
    .filter((k) => c[k].due <= now && wordOf(k))
    .sort((a, b) => r(a) - r(b));
}

function plan() {
  const s = store.settings();
  const t = store.today();
  const due = dueKeys();
  const reviewRoom = Math.max(0, s.maxReviews - t.reviews);
  const reviews = Math.min(due.length, reviewRoom);
  // Achterstand? Dan rustig aan met nieuwe woorden.
  let room = Math.max(0, s.newPerDay - t.newWords);
  if (due.length > 60) room = 0;
  else if (due.length > 30) room = Math.ceil(room / 2);
  const fresh = deck.filter((w) => !cards()[w.id + ':r']);
  const newCount = Math.min(room, fresh.length);
  const minutes = Math.ceil((reviews * 9 + newCount * 30) / 60);
  return { due, reviews, newCount, fresh, backlog: due.length - reviews, minutes };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function startSession({ extraNew = 0, minutes = store.settings().minutes } = {}) {
  const p = plan();
  const queue = extraNew ? [] : p.due.slice(0, p.reviews).map((key) => ({ type: 'review', key }));
  const news = p.fresh.slice(0, extraNew || p.newCount);
  for (let i = 0; i < news.length; i += GROUP) {
    const group = news.slice(i, i + GROUP);
    group.forEach((w) => queue.push({ type: 'intro', id: w.id }));
    shuffle(group.map((w) => ({ type: 'learn', key: w.id + ':r' }))).forEach((it) => queue.push(it));
  }
  if (!queue.length) return;
  session = {
    queue, pos: 0, total: queue.length, start: Date.now(), limit: minutes * 60000,
    stats: { reviews: 0, newWords: 0, correct: 0, rated: 0, known: 0 }, counted: new Set(),
    revealed: false, verdict: null, history: [],
    queuedIds: new Set(news.map((w) => w.id)), replaced: 0, tailStart: null, tailIntros: 0,
  };
  document.body.classList.add('in-session');
  session.timer = setInterval(updateTimer, 1000);
  showItem();
}

function endSession() {
  if (!session) return;
  clearInterval(session.timer);
  const t = store.today();
  t.seconds += Math.round((Date.now() - session.start) / 1000);
  store.save();
  const done = session.stats.rated + session.stats.known > 0;
  const stats = session.stats;
  const elapsed = Date.now() - session.start;
  session = null;
  document.body.classList.remove('in-session');
  if (done) renderSummary(stats, elapsed); else render();
}

function current() { return session.queue[session.pos]; }

function next() {
  session.pos++;
  session.revealed = false;
  session.verdict = null;
  const it = current();
  if (!it) return endSession();
  // Tijd op? Woorden die al uitgelegd zijn nog afmaken, daarna stoppen.
  if (Date.now() - session.start >= session.limit && it.type !== 'learn') return endSession();
  showItem();
}

// ---------- Ongedaan maken ----------
function snapshot(keys) {
  const c = cards();
  const l = store.lang();
  session.history.push({
    pos: session.pos, queue: session.queue.slice(), total: session.total,
    tailStart: session.tailStart, tailIntros: session.tailIntros, replaced: session.replaced,
    stats: { ...session.stats }, counted: new Set(session.counted), queuedIds: new Set(session.queuedIds),
    revealed: session.revealed, verdict: session.verdict,
    cards: keys.map((k) => [k, c[k] ? { ...c[k] } : null]),
    day: { ...store.today() }, streak: [l.streak, l.lastDay, l.best],
  });
  if (session.history.length > 30) session.history.shift();
}

function undo() {
  const h = session.history.pop();
  if (!h) return;
  const c = cards();
  const l = store.lang();
  for (const [k, v] of h.cards) { if (v) c[k] = v; else delete c[k]; }
  Object.assign(store.today(), h.day);
  [l.streak, l.lastDay, l.best] = h.streak;
  const { cards: _c, day: _d, streak: _s, ...rest } = h;
  Object.assign(session, rest);
  store.save();
  showItem();
}

// ---------- "Ken ik al" ----------
// Bekend woord: herkenning pas over ~2 weken, actief produceren al vanaf morgen.
function markKnown(id) {
  const c = cards();
  c[id + ':r'] = schedule(newCardState(), 4);
  if (!c[id + ':p']) c[id + ':p'] = { ...newCardState(), due: startOfDay() + DAY };
  const t = store.today();
  t.known = (t.known || 0) + 1;
}

function knownIntro() {
  const it = current();
  snapshot([it.id + ':r', it.id + ':p']);
  markKnown(it.id);
  session.stats.known++;
  const q = session.queue;
  const i = q.findIndex((x, j) => j > session.pos && x.type === 'learn' && x.key === it.id + ':r');
  if (i > -1) {
    q.splice(i, 1);
    session.total--;
    if (session.tailStart != null && i < session.tailStart) session.tailStart--;
  }
  // Telt niet mee voor je dagelijkse limiet: er komt een volgend nieuw woord voor in de plaats.
  const w = deck.find((x) => !cards()[x.id + ':r'] && !session.queuedIds.has(x.id));
  if (w && session.replaced < 60) {
    session.replaced++;
    session.queuedIds.add(w.id);
    if (session.tailStart == null || session.tailIntros >= GROUP) { session.tailStart = q.length; session.tailIntros = 0; }
    q.splice(session.tailStart + session.tailIntros++, 0, { type: 'intro', id: w.id });
    q.push({ type: 'learn', key: w.id + ':r' });
    session.total += 2;
  }
  store.markPracticed();
  store.save();
  next();
}

function rate(g) {
  const it = current();
  const c = cards();
  snapshot([it.key, it.key.slice(0, -2) + ':p']);
  const card = c[it.key] || newCardState();
  const updated = schedule(card, g);
  c[it.key] = updated;
  const t = store.today();
  if (!session.counted.has(it.key)) {
    session.counted.add(it.key);
    if (it.type === 'learn') { t.newWords++; session.stats.newWords++; } else { t.reviews++; session.stats.reviews++; }
  }
  session.stats.rated++;
  t.rated = (t.rated || 0) + 1;
  if (g >= 2) { t.correct++; session.stats.correct++; }
  if (g === 1) {
    // Binnen deze sessie nog eens terug laten komen.
    const at = Math.min(session.queue.length, session.pos + 4);
    session.queue.splice(at, 0, { type: it.type === 'learn' ? 'learn' : 'review', key: it.key, again: true });
    session.total++;
    if (session.tailStart != null && at <= session.tailStart) session.tailStart++;
  }
  const id = it.key.slice(0, -2);
  // Pas na een geslaagde herhaling op een latere dag ook actief produceren (vanaf morgen).
  if (it.type === 'review' && it.key.endsWith(':r') && g >= 2 && updated.s >= PRODUCE_AFTER && !c[id + ':p']) {
    c[id + ':p'] = { ...newCardState(), due: startOfDay() + DAY };
  }
  store.markPracticed();
  store.save();
  next();
}

// ---------- Antwoord controleren ----------
const norm = (s) => s.toLowerCase().replace(/[¡!¿?.,;:"'«»()]/g, '').replace(/\s+/g, ' ').trim();
const plain = (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const noArt = (s) => s.replace(/^(el|la|los|las|un|una|unos|unas|lo|il|lo|gli|le|der|die|das|le|les|l)\s+/, '');

function check(answer, w) {
  const a = norm(answer);
  if (!a) return { kind: 'bad', text: 'Geen antwoord — kijk goed naar het juiste woord.' };
  const target = norm(w.form);
  if (a === target) return { kind: 'ok', text: '¡Perfecto!' };
  if (plain(a) === plain(w.form)) return { kind: 'almost', text: `Bijna — let op de accenten: ${w.form}` };
  if (noArt(plain(a)) === noArt(plain(w.form))) return { kind: 'almost', text: `Goed woord, let op het lidwoord: ${w.form}` };
  if (plain(a) === plain(w.term) || noArt(plain(a)) === noArt(plain(w.term))) {
    return { kind: 'almost', text: `Juiste woord! In deze zin wordt het: ${w.form}` };
  }
  return { kind: 'bad', text: `Het juiste antwoord: ${w.form}` };
}

// ---------- Weergave sessie ----------
function termHtml(term) {
  const m = term.match(/^(l'|(?:el|la|los|las|il|lo|gli|le|der|die|das)\s)\s*(.+)$/i);
  return m ? `<span class="art">${esc(m[1].trim())}</span> ${esc(m[2])}` : esc(term);
}

function updateTimer() {
  const el = document.querySelector('.s-top .t');
  if (!el || !session) return;
  const sec = Math.floor((Date.now() - session.start) / 1000);
  el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function phaseLabel(it) {
  if (it.listen) return 'Herhalen · luisteren';
  if (it.type === 'review') return it.key.endsWith(':p') ? 'Herhalen · actief' : 'Herhalen';
  if (it.type === 'intro') return 'Nieuw woord';
  return 'Overhoren';
}

function backSide(w) {
  return `
    <div class="divider"></div>
    <div class="meaning">${esc(w.nl)}</div>
    ${w.ex ? `<div class="ex" style="margin-top:14px">${w.exHtml}
      <button class="speak sm" data-say="${esc(w.ex)}" aria-label="Zin uitspreken">🔊</button></div>
      <div class="ex-nl">${esc(w.exNl)}</div>` : ''}
    ${w.extra ? `<div class="extra">${esc(w.extra)}</div>` : ''}`;
}

function showItem() {
  const it = current();
  const w = it.type === 'intro' ? byId.get(it.id) : wordOf(it.key);
  const s = store.settings();
  const pct = Math.round(session.pos / session.total * 100);
  const production = it.key && it.key.endsWith(':p');
  const card = it.key ? (cards()[it.key] || newCardState()) : null;
  let body = '';
  let actions = '';
  // Bij woorden die al redelijk vastzitten soms alleen de audio laten horen.
  if (it.listen === undefined) {
    it.listen = it.type === 'review' && !production && s.listening && !!window.speechSynthesis &&
      card.s >= 5 && card.reps % 3 === 0;
  }

  if (it.type === 'intro') {
    body = `
      <span class="pos">${esc(POS[w.pos] || w.pos)}</span>
      <div class="word">${termHtml(w.term)}</div>
      <button class="speak" data-say="${esc(w.term)}" aria-label="Uitspreken">🔊</button>
      ${backSide(w)}`;
    actions = `<div class="pair"><button class="btn secondary" data-act="known">Ken ik al</button><button class="btn" data-act="next">Begrepen</button></div>`;
  } else if (it.listen && !session.revealed) {
    body = `
      <span class="pos">🎧 luister</span>
      <button class="speak big" data-say="${esc(w.term)}" aria-label="Nog eens afspelen">🔊</button>
      <p class="muted small" style="margin-top:18px">Wat hoor je, en wat betekent het?</p>`;
  } else if (!production) {
    body = `
      <span class="pos">${esc(POS[w.pos] || w.pos)}</span>
      <div class="word">${termHtml(w.term)}</div>
      <button class="speak" data-say="${esc(w.term)}" aria-label="Uitspreken">🔊</button>
      ${session.revealed ? backSide(w) : '<p class="muted small" style="margin-top:18px">Wat betekent dit?</p>'}`;
  } else {
    const v = session.verdict;
    body = `
      <span class="pos">${esc(POS[w.pos] || w.pos)} · zeg het in het ${esc(L().name)}</span>
      <div class="prompt-nl">${esc(w.nl)}</div>
      ${w.gapHtml ? `<div class="ex-nl" style="margin-top:14px">${esc(w.exNl)}</div>
        <div class="ex" style="margin-top:6px">${session.revealed ? w.exHtml : w.gapHtml}</div>` : ''}
      ${session.revealed ? `
        <div class="divider"></div>
        <div class="word">${termHtml(w.term)}</div>
        <button class="speak" data-say="${esc(w.ex || w.term)}" aria-label="Uitspreken">🔊</button>
        ${v ? `<div class="feedback ${v.kind}">${esc(v.text)}</div>` : ''}
        ${w.extra ? `<div class="extra">${esc(w.extra)}</div>` : ''}` :
        s.typing ? `<input class="answer-input" id="answer" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="Typ je antwoord">` : ''}`;
  }

  if (it.type !== 'intro') {
    if (!session.revealed) {
      actions = production && s.typing
        ? `<button class="btn" data-act="check">Controleer</button><button class="btn secondary" data-act="reveal">Weet ik niet</button>`
        : `<button class="btn" data-act="reveal">Toon antwoord</button>`;
    } else {
      const labels = preview(card);
      const sug = session.verdict ? { ok: 3, almost: 2, bad: 1 }[session.verdict.kind] : 0;
      actions = `<div class="ratings">${['Opnieuw', 'Moeilijk', 'Goed', 'Makkelijk'].map((n, i) =>
        `<button class="rate r${i + 1}${sug === i + 1 ? ' suggest' : ''}" data-rate="${i + 1}">${n}<small>${labels[i]}</small></button>`).join('')}</div>`;
    }
  }

  $app.innerHTML = `
    <div class="session">
      <div class="s-top">
        <button class="x" data-act="quit" aria-label="Stoppen">✕</button>
        <div class="progress"><div style="width:${pct}%"></div></div>
        ${session.history.length ? '<button class="x undo" data-act="undo" aria-label="Ongedaan maken">↶</button>' : ''}
        <span class="t"></span>
      </div>
      <div class="phase">${phaseLabel(it)}</div>
      <div class="flash"><div class="card" data-act="${!session.revealed && it.type !== 'intro' && !(production && s.typing) ? 'reveal' : ''}">${body}</div></div>
      <div class="actions">${actions}</div>
    </div>`;
  updateTimer();

  const input = document.getElementById('answer');
  if (input) {
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doCheck(); } });
  }
  if (s.autoplay || (it.listen && !session.revealed)) {
    const say = it.type === 'intro' || (!production && !session.revealed) ? w.term
      : production && session.revealed ? (w.ex || w.term) : null;
    if (say) speak(say);
  }
}

function doCheck() {
  const it = current();
  const input = document.getElementById('answer');
  session.verdict = check(input ? input.value : '', wordOf(it.key));
  session.revealed = true;
  showItem();
}

// ---------- Overige schermen ----------
function statusOf(w) {
  const c = cards()[w.id + ':r'];
  if (!c) return { k: 'new', label: 'nieuw' };
  if (c.s >= KNOWN_DAYS) return { k: 'known', label: 'gekend' };
  return { k: 'learning', label: c.due <= Date.now() ? 'nu' : formatInterval(c.due - Date.now()) };
}

const TIPS = [
  'Luister naast de app elke dag 15 minuten Spaans dat je bijna begrijpt — bijvoorbeeld Dreaming Spanish (Superbeginner/Beginner).',
  'Herken je een woord dankzij Latijn of Frans? Druk dan gerust op Makkelijk; dan krijgen moeilijke woorden meer aandacht.',
  'Zeg het antwoord hardop voordat je het omdraait. Hardop spreken helpt bij het onthouden.',
  'Een dag gemist? Geen probleem: de app verdeelt de achterstand en geeft dan minder nieuwe woorden.',
  'Vanaf ~300 woorden: probeer graded readers of kinderseries in het Spaans met Spaanse ondertitels.',
];

function renderHome() {
  const lang = L();
  if (!deck.length) {
    $app.innerHTML = `<h1>${lang.flag} ${esc(lang.name)}</h1>
      <div class="card tip">Voor ${esc(lang.name)} is nog geen woordenlijst toegevoegd. Kies in Instellingen een andere taal.</div>`;
    return;
  }
  const p = plan();
  const s = store.settings();
  const introduced = deck.filter((w) => cards()[w.id + ':r']).length;
  const known = deck.filter((w) => (cards()[w.id + ':r'] || {}).s >= KNOWN_DAYS).length;
  const streak = store.streak();
  const nothing = !p.reviews && !p.newCount;
  const tip = TIPS[new Date().getDate() % TIPS.length];
  $app.innerHTML = `
    <div class="home-head">
      <div><div class="muted">${lang.flag} ${esc(lang.name)}</div><h1>${greeting()}</h1></div>
      <div class="streak" title="Dagen op rij">🔥 ${streak}</div>
    </div>
    <div class="stats">
      <div class="card stat review"><div class="n">${p.reviews}</div><div class="l">te herhalen</div></div>
      <div class="card stat new"><div class="n">${p.newCount}</div><div class="l">nieuwe woorden</div></div>
    </div>
    ${p.backlog > 0 ? `<p class="small muted">Nog ${p.backlog} herhalingen wachten tot morgen, zodat het behapbaar blijft.</p>` : ''}
    ${nothing ? '' : `
      <div class="row small muted" style="margin-bottom:8px"><span>Hoeveel tijd heb je?</span><span>alles ≈ ${p.minutes} min</span></div>
      <div class="chips">${[5, 10, 15, 20].map((m) => `<button class="chip${s.minutes === m ? ' on' : ''}" data-min="${m}">${m} min</button>`).join('')}</div>`}
    ${nothing
      ? `<div class="card tip" style="text-align:center;color:var(--text)">🎉 Klaar voor vandaag! ${nextDueText()}</div>
         ${p.fresh.length ? '<button class="btn secondary" data-act="extra" style="margin-top:12px">Toch 5 extra nieuwe woorden</button>' : ''}`
      : '<button class="btn" data-act="start">Start sessie</button>'}
    ${introduced < 150 && p.fresh.length ? `<button class="card tip linkcard" data-act="check-open">⚡ <b>Snelcheck</b>: vink de woorden af die je al kent, zodat je sneller bij nieuwe woorden bent. →</button>` : ''}
    <h2>Voortgang</h2>
    <div class="card">
      <div class="row small"><span>Geleerd</span><span><b>${introduced}</b> / ${deck.length}</span></div>
      <div class="progress" style="margin:8px 0 14px"><div style="width:${introduced / deck.length * 100}%"></div></div>
      <div class="row small"><span>Goed gekend (≥ 3 weken)</span><span><b>${known}</b></span></div>
      <div class="progress" style="margin-top:8px"><div style="width:${known / deck.length * 100}%;background:var(--easy)"></div></div>
    </div>
    <div class="card tip">💡 ${esc(tip)}</div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? '¡Buenos días!' : h < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
}

function nextDueText() {
  const now = Date.now();
  const future = Object.values(cards()).map((c) => c.due).filter((d) => d > now);
  if (!future.length) return '';
  const tomorrowEnd = startOfDay(now) + 2 * DAY;
  const tomorrow = future.filter((d) => d < tomorrowEnd).length;
  return tomorrow ? `Morgen staan er ongeveer ${tomorrow} ${tomorrow === 1 ? 'herhaling' : 'herhalingen'} klaar.` :
    `Volgende herhaling over ${formatInterval(Math.min(...future) - now)}.`;
}

function renderSummary(st, elapsed) {
  const pct = st.rated ? Math.round(st.correct / st.rated * 100) : 0;
  const p = plan();
  const left = p.reviews + p.newCount;
  $app.innerHTML = `
    <div class="big-emoji">${pct >= 85 ? '🌟' : pct >= 60 ? '💪' : '🌱'}</div>
    <h1 style="text-align:center">¡Bien hecho!</h1>
    <p class="muted" style="text-align:center;margin:0">${store.streak()} ${store.streak() === 1 ? 'dag' : 'dagen'} op rij</p>
    <div class="summary-grid">
      <div class="card stat review"><div class="n">${st.reviews}</div><div class="l">herhaald</div></div>
      <div class="card stat new"><div class="n">${st.newWords}</div><div class="l">nieuwe woorden</div></div>
      <div class="card stat"><div class="n">${pct}%</div><div class="l">goed</div></div>
      <div class="card stat"><div class="n">${Math.max(1, Math.round(elapsed / 60000))}</div><div class="l">minuten</div></div>
    </div>
    ${st.known ? `<p class="muted small" style="text-align:center">+ ${st.known} ${st.known === 1 ? 'woord' : 'woorden'} afgevinkt als al bekend</p>` : ''}
    <div class="card tip" style="color:var(--text);margin-bottom:16px">${nextDueText() || 'Alles staat ingepland.'}</div>
    ${left ? `<button class="btn secondary" data-act="more">Nog 5 minuten (${left} klaar)</button>` : ''}
    <button class="btn" data-act="home">Klaar</button>`;
}

function renderWords() {
  const q = plain(wordFilter.q);
  const list = deck.filter((w) => {
    if (q && !plain(w.term).includes(q) && !plain(w.nl).includes(q)) return false;
    return wordFilter.status === 'all' || statusOf(w).k === wordFilter.status;
  });
  $app.innerHTML = `
    <h1>Woorden</h1>
    <input class="search" id="search" type="search" placeholder="Zoek in ${esc(L().name)} of Nederlands" value="${esc(wordFilter.q)}">
    <div class="filters">${[['all', 'Alle'], ['new', 'Nieuw'], ['learning', 'Lerend'], ['known', 'Gekend']].map(([k, n]) =>
      `<button class="chip${wordFilter.status === k ? ' on' : ''}" data-filter="${k}">${n}</button>`).join('')}</div>
    <p class="small muted">${list.length} woorden</p>
    <div class="card list">${list.map((w) => {
      const st = statusOf(w);
      return `<button class="item" data-word="${esc(w.id)}"><div><div class="es">${esc(w.term)}</div><div class="nl">${esc(w.nl)}</div></div><span class="pill ${st.k}">${esc(st.label)}</span></button>`;
    }).join('') || '<div class="item muted">Niets gevonden</div>'}</div>`;
  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    wordFilter.q = search.value;
    const pos = search.selectionStart;
    renderWords();
    const s2 = document.getElementById('search');
    s2.focus(); s2.setSelectionRange(pos, pos);
  });
}

function showWord(id) {
  const w = byId.get(id);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet"><div class="card">
      <span class="pos">${esc(POS[w.pos] || w.pos)}${w.tag ? ' · ' + esc(w.tag) : ''}</span>
      <div class="word">${termHtml(w.term)}</div>
      <button class="speak" data-say="${esc(w.term)}">🔊</button>
      ${backSide(w)}</div>
      <button class="btn secondary" style="margin-top:12px" data-act="close">Sluiten</button></div>`;
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-act="close"]')) ov.remove();
  });
  document.body.appendChild(ov);
  speak(w.term);
}

// ---------- Snelcheck: bekende woorden in één keer afvinken ----------
const checkSel = new Set();
const CHECK_BATCH = 24;

function renderCheck() {
  const batch = deck.filter((w) => !cards()[w.id + ':r']).slice(0, CHECK_BATCH);
  $app.innerHTML = `
    <h1>Snelcheck</h1>
    <p class="muted">Tik op elk woord dat je <b>direct</b> kent. Die komen pas over ~2 weken terug ter controle, en je oefent ze vanaf morgen actief. Twijfel je? Laat dan staan.</p>
    <div class="checkgrid">${batch.map((w) => `
      <button class="checkitem${checkSel.has(w.id) ? ' on' : ''}" data-check="${esc(w.id)}">
        <span class="es">${esc(w.term)}</span><span class="nl">${esc(w.nl)}</span></button>`).join('')}</div>
    ${batch.length ? `<button class="btn" data-act="check-save" style="margin-top:16px">${checkSel.size ? `${checkSel.size} als bekend opslaan, volgende` : 'Ken ik geen van allen: stoppen'}</button>` :
      '<p class="muted">Alle woorden zijn al ingedeeld.</p>'}
    <button class="btn secondary" data-act="home">Terug</button>`;
}

function toggleCheck(el) {
  const id = el.dataset.check;
  if (checkSel.has(id)) checkSel.delete(id); else checkSel.add(id);
  el.classList.toggle('on');
  const btn = document.querySelector('[data-act="check-save"]');
  if (btn) btn.textContent = checkSel.size ? `${checkSel.size} als bekend opslaan, volgende` : 'Ken ik geen van allen: stoppen';
}

function saveCheck() {
  if (!checkSel.size) { tab = 'home'; render(); return; }
  checkSel.forEach(markKnown);
  checkSel.clear();
  store.markPracticed();
  store.save();
  render();
}

// ---------- Statistiek ----------
const WD = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

// Eenvoudige staafgrafiek (één reeks) met tik/hover-tooltip.
function barChart(points, color, unit) {
  const W = 340, H = 130, top = 14, bottom = 20;
  const max = Math.max(1, ...points.map((p) => p.v));
  const bw = W / points.length;
  const r = 4;
  const bars = points.map((p, i) => {
    const h = p.v ? Math.max(3, (H - top - bottom) * p.v / max) : 0;
    const x = i * bw + 2, w = bw - 4, y = H - bottom - h;
    const rr = Math.min(r, h, w / 2);
    const path = h ? `M${x},${H - bottom} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${H - bottom} Z` : '';
    return `<g data-tip="${esc(p.tip)}: ${p.v} ${unit}">
      <rect x="${i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>
      ${path ? `<path d="${path}" fill="${color}"/>` : ''}
      ${p.label ? `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle" class="axis">${p.label}</text>` : ''}
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">
    <line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" class="base"/>${bars}</svg>`;
}

function showTip(el) {
  const box = el.closest('.card')?.querySelector('.tipline');
  if (box) box.textContent = el.dataset.tip;
}

function renderStats() {
  const l = store.lang();
  const c = cards();
  const now = Date.now();
  const sod = startOfDay(now);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const t = sod - i * DAY + 12 * 3600000;
    const d = l.days[store.dayKey(t)] || {};
    days.push({ t, d });
  }
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const allDays = Object.values(l.days);
  const totalMin = Math.round(sum(allDays, (d) => d.seconds) / 60);
  const week = days.slice(-7).map((x) => x.d);
  const rated = sum(week, (d) => d.rated);
  const pct = rated ? Math.round(sum(week, (d) => d.correct) / rated * 100) : null;
  const counts = { new: 0, learning: 0, known: 0 };
  deck.forEach((w) => counts[statusOf(w).k]++);

  const activity = days.map(({ t, d }, i) => ({
    v: (d.reviews || 0) + (d.newWords || 0),
    label: i % 2 === 1 || i === 13 ? WD[new Date(t).getDay()] : '',
    tip: i === 13 ? 'Vandaag' : new Date(t).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }),
  }));
  const forecast = [];
  for (let i = 0; i < 7; i++) {
    const end = sod + (i + 1) * DAY;
    const start = i === 0 ? -Infinity : sod + i * DAY;
    forecast.push({
      v: Object.keys(c).filter((k) => wordOf(k) && c[k].due >= start && c[k].due < end).length,
      label: i === 0 ? 'nu' : WD[new Date(sod + i * DAY + 12 * 3600000).getDay()],
      tip: i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : new Date(sod + i * DAY + 12 * 3600000).toLocaleDateString('nl-NL', { weekday: 'long' }),
    });
  }
  const hardest = Object.entries(c)
    .filter(([k, v]) => v.lapses > 0 && wordOf(k))
    .sort((a, b) => b[1].lapses - a[1].lapses || a[1].s - b[1].s)
    .slice(0, 6);
  const fmtTime = totalMin >= 60 ? `${Math.floor(totalMin / 60)}u ${totalMin % 60}m` : `${totalMin}m`;
  const seg = (n, color, label) => n ? `<div style="flex:${n};background:${color}" data-tip="${label}: ${n}"></div>` : '';

  $app.innerHTML = `
    <h1>Statistiek</h1>
    <div class="summary-grid">
      <div class="card stat"><div class="n">${counts.learning + counts.known}</div><div class="l">woorden geleerd</div></div>
      <div class="card stat"><div class="n">${counts.known}</div><div class="l">goed gekend (≥ 3 wkn)</div></div>
      <div class="card stat"><div class="n">${store.streak()}</div><div class="l">dagen op rij · record ${l.best || store.streak()}</div></div>
      <div class="card stat"><div class="n">${pct == null ? '–' : pct + '%'}</div><div class="l">goed, afgelopen 7 dagen</div></div>
    </div>
    <div class="card">
      <div class="row"><b>Kaarten per dag</b><span class="small muted">14 dagen</span></div>
      <div class="tipline small muted">Tik op een balk voor details</div>
      ${barChart(activity, 'var(--easy)', 'kaarten')}
    </div>
    <div class="card" style="margin-top:12px">
      <div class="row"><b>Komende herhalingen</b><span class="small muted">7 dagen</span></div>
      <div class="tipline small muted">Tik op een balk voor details</div>
      ${barChart(forecast, 'var(--accent)', 'herhalingen')}
    </div>
    <div class="card" style="margin-top:12px">
      <div class="row"><b>Woordenlijst</b><span class="small muted">${deck.length} woorden</span></div>
      <div class="tipline small muted"></div>
      <div class="stack">${seg(counts.known, 'var(--good)', 'Gekend')}${seg(counts.learning, 'var(--hard)', 'Lerend')}${seg(counts.new, 'var(--surface-2)', 'Nog niet geleerd')}</div>
      <div class="legend small">
        <span><i style="background:var(--good)"></i>Gekend ${counts.known}</span>
        <span><i style="background:var(--hard)"></i>Lerend ${counts.learning}</span>
        <span><i style="background:var(--surface-2)"></i>Nieuw ${counts.new}</span>
      </div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="row small"><span>Totale studietijd</span><b>${fmtTime}</b></div>
      <div class="row small" style="margin-top:6px"><span>Herhalingen in totaal</span><b>${sum(allDays, (d) => d.rated)}</b></div>
      <div class="row small" style="margin-top:6px"><span>Afgevinkt als bekend</span><b>${sum(allDays, (d) => d.known)}</b></div>
    </div>
    ${hardest.length ? `<h2>Lastigste woorden</h2><div class="card list">${hardest.map(([k, v]) => {
      const w = wordOf(k);
      return `<button class="item" data-word="${esc(w.id)}"><div><div class="es">${esc(w.term)}</div><div class="nl">${esc(w.nl)}${k.endsWith(':p') ? ' · actief' : ''}</div></div><span class="pill learning">${v.lapses}× vergeten</span></button>`;
    }).join('')}</div>` : ''}`;
}

function renderSettings() {
  const s = store.settings();
  const opt = (vals, cur, fmt = (v) => v) => vals.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $app.innerHTML = `
    <h1>Instellingen</h1>
    <h2>Leren</h2>
    <div class="card set">
      <div class="set-row"><span>Actieve taal</span><select id="lang">${Object.entries(LANGS).map(([k, v]) =>
        `<option value="${k}"${k === s.lang ? ' selected' : ''}${v.load ? '' : ' disabled'}>${v.flag} ${v.name}${v.load ? '' : ' (binnenkort)'}</option>`).join('')}</select></div>
      <div class="set-row"><span>Nieuwe woorden per dag</span><select id="newPerDay">${opt([0, 5, 10, 15, 20, 25, 30], s.newPerDay)}</select></div>
      <div class="set-row"><span>Max. herhalingen per dag</span><select id="maxReviews">${opt([50, 80, 120, 200, 400], s.maxReviews)}</select></div>
      <div class="set-row"><span>Automatisch uitspreken</span><label class="toggle"><input type="checkbox" id="autoplay"${s.autoplay ? ' checked' : ''}><span></span></label></div>
      <div class="set-row"><span>Typen bij actief produceren</span><label class="toggle"><input type="checkbox" id="typing"${s.typing ? ' checked' : ''}><span></span></label></div>
      <div class="set-row"><span>Luisterkaarten (alleen audio)</span><label class="toggle"><input type="checkbox" id="listening"${s.listening ? ' checked' : ''}><span></span></label></div>
    </div>
    <h2>Dagelijkse herinnering</h2>
    <div class="card set help" style="padding:14px 16px">
      Zet een vaste herinnering via de Opdrachten-app van je iPhone:
      <ol>
        <li>Opdrachten → <b>Automatisering</b> → <b>+</b> → <b>Tijdstip</b> (bijv. 19:00, dagelijks).</li>
        <li>Kies <b>Voer direct uit</b> en voeg de actie <b>Toon melding</b> toe ("¡Hora de practicar! 🇪🇸").</li>
      </ol>
      Echte pushmeldingen vanuit de app zelf (met het aantal woorden dat klaarstaat) kunnen later worden toegevoegd.
    </div>
    <h2>Installeren</h2>
    <div class="card set help" style="padding:14px 16px">${standalone ? '✅ Je gebruikt de app vanaf je beginscherm.' :
      'Open deze pagina in Safari → tik op <b>Deel</b> (vierkant met pijl) → <b>Zet op beginscherm</b>. Daarna opent hij als een gewone app, ook zonder internet.'}</div>
    <h2>Back-up</h2>
    <div class="card set">
      <div class="set-row"><span>Voortgang exporteren</span><button class="chip" style="flex:0;padding:8px 14px" data-act="export">Exporteer</button></div>
      <div class="set-row"><span>Back-up terugzetten</span><label class="chip" style="flex:0;padding:8px 14px">Importeer<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      <div class="set-row"><button class="danger" data-act="reset">Voortgang ${esc(L().name)} wissen</button></div>
    </div>
    <p class="small muted" style="text-align:center;margin-top:24px">Palabra · ${deck.length} woorden · FSRS</p>`;

  const sel = (id, key, num = true) => document.getElementById(id).addEventListener('change', async (e) => {
    store.setSetting(key, num ? Number(e.target.value) : e.target.value);
    if (key === 'lang') await loadDeck();
    render();
  });
  sel('lang', 'lang', false);
  sel('newPerDay', 'newPerDay');
  sel('maxReviews', 'maxReviews');
  ['autoplay', 'typing', 'listening'].forEach((k) => document.getElementById(k).addEventListener('change', (e) => store.setSetting(k, e.target.checked)));
  document.getElementById('import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { store.importJSON(await f.text()); await loadDeck(); alert('Back-up teruggezet.'); render(); } catch (err) { alert('Importeren mislukt: ' + err.message); }
  });
}

async function exportBackup() {
  const name = `palabra-backup-${store.dayKey()}.json`;
  const file = new File([store.exportJSON()], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Palabra back-up' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function render() {
  window.scrollTo(0, 0);
  $tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'home') renderHome();
  else if (tab === 'words') renderWords();
  else if (tab === 'stats') renderStats();
  else if (tab === 'check') renderCheck();
  else renderSettings();
}

// ---------- Events ----------
document.addEventListener('click', (e) => {
  const say = e.target.closest('[data-say]');
  if (say) { e.stopPropagation(); speak(say.dataset.say, say.classList.contains('sm') ? 0.85 : 0.9); return; }
  const tip = e.target.closest('[data-tip]');
  if (tip) { showTip(tip); return; }
  const t = e.target.closest('[data-tab],[data-act],[data-rate],[data-min],[data-filter],[data-word],[data-check]');
  if (!t) return;
  if (t.dataset.check) { toggleCheck(t); return; }
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  if (t.dataset.rate) { rate(Number(t.dataset.rate)); return; }
  if (t.dataset.min) { store.setSetting('minutes', Number(t.dataset.min)); render(); return; }
  if (t.dataset.filter) { wordFilter.status = t.dataset.filter; renderWords(); return; }
  if (t.dataset.word) { showWord(t.dataset.word); return; }
  switch (t.dataset.act) {
    case 'start': startSession(); break;
    case 'extra': startSession({ extraNew: 5 }); break;
    case 'more': startSession({ minutes: 5 }); break;
    case 'home': tab = 'home'; render(); break;
    case 'next': snapshot([]); next(); break;
    case 'known': knownIntro(); break;
    case 'undo': undo(); break;
    case 'check-open': tab = 'check'; checkSel.clear(); render(); break;
    case 'check-save': saveCheck(); break;
    case 'reveal': session.revealed = true; showItem(); break;
    case 'check': doCheck(); break;
    case 'quit': endSession(); break;
    case 'export': exportBackup(); break;
    case 'reset':
      if (confirm(`Weet je zeker dat je alle voortgang voor ${L().name} wilt wissen?`)) { store.resetLang(store.settings().lang); render(); }
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (!session || e.target.tagName === 'INPUT') return;
  const it = current();
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (it.type === 'intro') next();
    else if (!session.revealed) { session.revealed = true; showItem(); }
    else rate(3);
  } else if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key));
  else if (e.key === 'u' || e.key === 'Backspace') undo();
});

document.addEventListener('mouseover', (e) => {
  const tip = e.target.closest('[data-tip]');
  if (tip) showTip(tip);
});

// Terug in de app na een tijdje? Tellers verversen.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !session) render(); });

async function loadDeck() {
  const lang = L();
  deck = lang.load ? parseDeck((await lang.load()).default) : [];
  byId = new Map(deck.map((w) => [w.id, w]));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

await loadDeck();
render();
