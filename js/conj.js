// Vervoegingstrainer: per werkwoord + tijd één FSRS-kaart. Elke beurt vraagt
// drie willekeurige personen; de beoordeling volgt automatisch uit je antwoorden.
import { schedule, newCardState, formatInterval } from './fsrs.js';
import * as store from './store.js';

const ROUND = 3;
const MAX_REVIEWS = 15;
const PRONOUNS = /^(yo|tú|tu|él|el|ella|usted|nosotros|nosotras|vosotros|vosotras|ellos|ellas|ustedes)\s+/;

let ctx;       // { app, esc, speak, norm, plain, exit }
let mod;       // { default: verbs, PERSONS, TENSES }
let run = null;

export function init(c) { ctx = c; }
export function setModule(m) { mod = m; }
export const available = () => !!mod;

const conjCards = () => {
  const l = store.lang();
  if (!l.conj) l.conj = {};
  return l.conj;
};
const settings = () => {
  const s = store.settings();
  return { tenses: s.conjTenses || ['pres'], vosotros: s.vosotros !== false, perSession: s.conjNew || 4 };
};

export function plan() {
  if (!mod) return { due: [], fresh: [] };
  const c = conjCards();
  const { tenses } = settings();
  const now = Date.now();
  const tOrder = Object.keys(mod.TENSES);
  const pairs = [];
  mod.default.forEach((v, vi) => tenses.forEach((t) => pairs.push({ key: `${v.inf}:${t}`, v, t, order: vi + tOrder.indexOf(t) * 10 })));
  const due = pairs.filter((p) => c[p.key] && c[p.key].due <= now).sort((a, b) => c[a.key].due - c[b.key].due);
  const fresh = pairs.filter((p) => !c[p.key]).sort((a, b) => a.order - b.order);
  return { due, fresh, learned: pairs.length - fresh.length, total: pairs.length };
}

function pickPersons() {
  const pool = [0, 1, 2, 3, 4, 5].filter((i) => settings().vosotros || i !== 4);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, ROUND).sort((a, b) => a - b);
}

// ---------- Startscherm ----------
export function renderStart() {
  const { esc } = ctx;
  const p = plan();
  const s = settings();
  const reviews = Math.min(p.due.length, MAX_REVIEWS);
  const fresh = Math.min(p.fresh.length, s.perSession);
  ctx.app.innerHTML = `
    <h1>Vervoegen</h1>
    <p class="muted">Per beurt vraag ik drie personen van één werkwoord in één tijd. De app beoordeelt zelf hoe goed het ging en plant de herhaling.</p>
    <div class="stats">
      <div class="card stat review"><div class="n">${reviews}</div><div class="l">te herhalen</div></div>
      <div class="card stat new"><div class="n">${fresh}</div><div class="l">nieuw</div></div>
    </div>
    <button class="btn" data-act="conj-start"${reviews + fresh ? '' : ' disabled'}>${reviews + fresh ? 'Start' : 'Alles gedaan voor nu 🎉'}</button>
    <h2>Welke tijden?</h2>
    <div class="card set">${Object.entries(mod.TENSES).map(([k, t]) => `
      <div class="set-row"><span><b>${esc(t.name)}</b><br><span class="small muted">${esc(t.nl)} · ${esc(t.hint)}</span></span>
      <label class="toggle"><input type="checkbox" data-tense="${k}"${s.tenses.includes(k) ? ' checked' : ''}><span></span></label></div>`).join('')}
      <div class="set-row"><span>Vosotros oefenen<br><span class="small muted">jullie-vorm, alleen in Spanje</span></span>
      <label class="toggle"><input type="checkbox" id="vosotros"${s.vosotros ? ' checked' : ''}><span></span></label></div>
    </div>
    <p class="small muted" style="margin-top:14px">${p.learned} van ${p.total} combinaties gestart · ${mod.default.length} werkwoorden</p>
    <button class="btn secondary" data-act="home" style="margin-top:8px">Terug</button>`;

  ctx.app.querySelectorAll('[data-tense]').forEach((el) => el.addEventListener('change', () => {
    const on = [...ctx.app.querySelectorAll('[data-tense]:checked')].map((x) => x.dataset.tense);
    store.setSetting('conjTenses', on.length ? on : ['pres']);
    renderStart();
  }));
  ctx.app.querySelector('#vosotros').addEventListener('change', (e) => store.setSetting('vosotros', e.target.checked));
}

// ---------- Sessie ----------
export function start() {
  const p = plan();
  const items = [...p.due.slice(0, MAX_REVIEWS), ...p.fresh.slice(0, settings().perSession)]
    .map(({ key, v, t }) => ({ key, v, t, persons: pickPersons(), step: 0, results: [] }));
  if (!items.length) return;
  run = { items, pos: 0, start: Date.now(), stats: { rounds: 0, perfect: 0 } };
  document.body.classList.add('in-session');
  show();
}

export const active = () => !!run;

function cur() { return run.items[run.pos]; }

function check(answer, target) {
  const { norm, plain } = ctx;
  const a = norm(answer).replace(PRONOUNS, '');
  if (!a) return 'bad';
  if (a === norm(target)) return 'ok';
  if (plain(a) === plain(target)) return 'almost';
  return 'bad';
}

function gradeOf(results) {
  const bad = results.filter((r) => r.kind === 'bad').length;
  const almost = results.filter((r) => r.kind === 'almost').length;
  return bad >= 2 ? 1 : bad || almost ? 2 : 3;
}

function show() {
  const { esc } = ctx;
  const it = cur();
  const t = mod.TENSES[it.t];
  const finished = it.step >= ROUND;
  const last = it.results[it.results.length - 1];
  const waiting = last && !last.shown;   // feedback tonen voordat de volgende persoon komt
  const pi = it.persons[Math.min(it.step, ROUND - 1)];
  const pct = Math.round(run.pos / run.items.length * 100);
  let body;
  let actions;

  if (finished) {
    const g = gradeOf(it.results);
    const card = conjCards()[it.key] || newCardState();
    const next = schedule(card, g);
    body = `
      <div class="word">${esc(it.v.inf)}</div><div class="muted">${esc(it.v.nl)}</div>
      <table class="conj">${mod.PERSONS.map((p, i) => {
        const r = it.results.find((x) => x.person === i);
        const mark = r ? (r.kind === 'ok' ? '<span class="okm">✓</span>' : r.kind === 'almost' ? '<span class="almm">~</span>' : '<span class="badm">✗</span>') : '';
        const yours = r && r.kind !== 'ok' ? `<div class="small muted">jij: ${esc(r.answer || '—')}</div>` : '';
        return `<tr class="${r ? 'asked' : ''}"><td>${esc(p)}</td><td><b>${esc(it.v.forms[it.t][i])}</b>${yours}</td><td>${mark}</td></tr>`;
      }).join('')}</table>
      <div class="feedback ${g === 3 ? 'ok' : g === 2 ? 'almost' : 'bad'}">${g === 3 ? '¡Perfecto! ' : g === 2 ? 'Bijna. ' : 'Nog even oefenen. '}Volgende keer over ${formatInterval(next.due - Date.now())}.</div>`;
    actions = `<button class="btn" data-act="conj-next">Volgende</button>`;
  } else {
    body = `
      <div class="word">${esc(it.v.inf)}</div><div class="muted">${esc(it.v.nl)}</div>
      <div class="divider"></div>
      <div class="dots">${it.persons.map((_, i) => `<i class="${i < it.step ? it.results[i].kind : i === it.step ? 'now' : ''}"></i>`).join('')}</div>
      <div class="prompt-nl">${esc(mod.PERSONS[waiting ? last.person : pi])}</div>
      ${waiting ? `<div class="answer-shown">${esc(it.v.forms[it.t][last.person])}</div>
        <div class="feedback ${last.kind}">${last.kind === 'ok' ? '¡Bien!' : last.kind === 'almost' ? `Let op de accenten: ${esc(it.v.forms[it.t][last.person])}` : `Jij: ${esc(last.answer || '—')}`}</div>`
        : `<input class="answer-input" id="conj-answer" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(mod.PERSONS[pi].split(' ')[0])} …">`}`;
    actions = waiting
      ? `<button class="btn" data-act="conj-continue">Verder</button>`
      : `<button class="btn" data-act="conj-check">Controleer</button><button class="btn secondary" data-act="conj-skip">Weet ik niet</button>`;
  }

  ctx.app.innerHTML = `
    <div class="session">
      <div class="s-top">
        <button class="x" data-act="conj-quit" aria-label="Stoppen">✕</button>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <span class="t">${run.pos + 1}/${run.items.length}</span>
      </div>
      <div class="phase">${esc(t.name)} · ${esc(t.nl)}</div>
      <div class="flash"><div class="card">${body}</div></div>
      <div class="actions">${actions}</div>
    </div>`;
  const input = document.getElementById('conj-answer');
  if (input) {
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(input.value); } });
  } else {
    const btn = ctx.app.querySelector('[data-act="conj-continue"],[data-act="conj-next"]');
    if (btn) setTimeout(() => btn.focus(), 50);
  }
}

function answer(value) {
  const it = cur();
  const person = it.persons[it.step];
  const target = it.v.forms[it.t][person];
  it.results.push({ person, answer: value.trim(), kind: check(value, target) });
  it.step++;
  if (store.settings().autoplay) ctx.speak(target);
  show();
}

function cont() {
  const it = cur();
  it.results[it.results.length - 1].shown = true;
  show();
}

function nextItem() {
  const it = cur();
  const g = gradeOf(it.results);
  const c = conjCards();
  c[it.key] = schedule(c[it.key] || newCardState(), g);
  run.stats.rounds++;
  if (g === 3) run.stats.perfect++;
  if (g === 1 && !it.again) {
    run.items.push({ ...it, persons: pickPersons(), step: 0, results: [], again: true });
  }
  const t = store.today();
  t.conj = (t.conj || 0) + 1;
  store.markPracticed();
  store.save();
  run.pos++;
  if (run.pos >= run.items.length) return finish();
  show();
}

function finish() {
  const st = run.stats;
  const t = store.today();
  t.seconds += Math.round((Date.now() - run.start) / 1000);
  store.save();
  run = null;
  document.body.classList.remove('in-session');
  if (!st.rounds) return ctx.exit();
  ctx.app.innerHTML = `
    <div class="big-emoji">${st.perfect / st.rounds >= 0.8 ? '🌟' : '💪'}</div>
    <h1 style="text-align:center">¡Muy bien!</h1>
    <div class="summary-grid">
      <div class="card stat"><div class="n">${st.rounds}</div><div class="l">werkwoorden geoefend</div></div>
      <div class="card stat"><div class="n">${st.perfect}</div><div class="l">foutloos</div></div>
    </div>
    <button class="btn" data-act="home">Klaar</button>`;
}

// Afhandeling van klikken die bij de trainer horen; true = afgehandeld.
export function handle(act) {
  switch (act) {
    case 'conj-start': start(); return true;
    case 'conj-check': answer(document.getElementById('conj-answer')?.value || ''); return true;
    case 'conj-skip': answer(''); return true;
    case 'conj-continue': cont(); return true;
    case 'conj-next': nextItem(); return true;
    case 'conj-quit': finish(); return true;
  }
  return false;
}
