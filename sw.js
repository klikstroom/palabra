// Offline: alle bestanden worden bij installatie opgeslagen. Verhoog VERSION
// na elke wijziging zodat telefoons de nieuwe versie ophalen.
const VERSION = 'palabra-v3';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/fsrs.js', 'js/store.js', 'js/langs.js', 'js/conj.js', 'js/push.js', 'js/config.js',
  'data/es.js', 'data/es-verbs.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'palabra-meta').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Eerst netwerk (zodat updates direct binnenkomen), anders de opgeslagen versie.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// ---------- Pushmeldingen ----------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function reminderText(type) {
  if (type === 'test') return 'Testmelding: de herinneringen werken. ¡Perfecto!';
  try {
    const res = await (await caches.open('palabra-meta')).match('meta');
    const f = res && (await res.json()).forecast?.[today()];
    if (f && (f.reviews || f.newWords)) {
      const parts = [];
      if (f.reviews) parts.push(`${f.reviews} ${f.reviews === 1 ? 'herhaling' : 'herhalingen'}`);
      if (f.newWords) parts.push(`${f.newWords} nieuwe woorden`);
      return `${parts.join(' en ')} staan klaar. ¡Vamos! 🇪🇸`;
    }
  } catch (e) { /* standaardtekst */ }
  return 'Tijd voor je dagelijkse Spaans. ¡Vamos! 🇪🇸';
}

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { /* lege melding */ }
  e.waitUntil(reminderText(data.type).then((body) => self.registration.showNotification('Palabra', {
    body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'palabra-reminder',
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) =>
    list.length ? list[0].focus() : self.clients.openWindow('./')));
});
