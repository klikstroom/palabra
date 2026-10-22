// Dagelijkse herinnering via Web Push. De server weet alleen wanneer je een
// melding wilt en of je vandaag al geoefend hebt; de tekst (hoeveel kaarten)
// maakt de service worker zelf uit de lokale gegevens in de cache.
import { PUSH_URL, VAPID_PUBLIC } from './config.js';
import * as store from './store.js';

export const configured = () => !!PUSH_URL;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
export const needsInstall = () => isIOS() && !standalone();
export const enabled = () => !!store.settings().reminder;

function keyBytes(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
}

async function post(path, data) {
  const res = await fetch(PUSH_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

async function subscription(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  return sub;
}

export async function enable(hour) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Meldingen zijn niet toegestaan. Zet ze aan via Instellingen → Meldingen → Palabra.');
  const sub = await subscription(true);
  await post('/subscribe', { subscription: sub.toJSON(), hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  store.setSetting('reminder', { hour, synced: null });
}

export async function disable() {
  const sub = await subscription(false);
  if (sub) {
    try { await post('/unsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* server onbereikbaar: lokaal toch uitzetten */ }
    await sub.unsubscribe();
  }
  store.setSetting('reminder', null);
}

export async function test() {
  const sub = await subscription(false);
  if (!sub) throw new Error('Geen abonnement gevonden; zet de herinnering opnieuw aan.');
  return post('/test', { endpoint: sub.endpoint });
}

// Na elke sessie / bij openen: lokale aantallen klaarzetten voor de service worker
// en de server laten weten dat er vandaag geoefend is.
export async function sync(forecast) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('palabra-meta');
    await cache.put('meta', new Response(JSON.stringify({ forecast, lang: store.settings().lang })));
  } catch (e) { /* niet kritiek */ }
  const r = store.settings().reminder;
  const day = store.dayKey();
  if (!configured() || !r || store.lang().lastDay !== day || r.synced === day) return;
  try {
    const sub = await subscription(false);
    if (!sub) return;
    await post('/practiced', { endpoint: sub.endpoint, day });
    store.setSetting('reminder', { ...r, synced: day });
  } catch (e) { /* volgende keer opnieuw */ }
}
