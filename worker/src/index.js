// Palabra push: bewaart abonnementen en stuurt elk uur de herinneringen van wie
// op dat (lokale) uur een melding wil en vandaag nog niet geoefend heeft.
import { sendPush } from './webpush.js';

const ORIGINS = ['https://klikstroom.github.io', 'http://localhost:8765'];

function cors(req) {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function keys(env) {
  return { privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), publicKey: env.VAPID_PUBLIC, subject: env.VAPID_SUBJECT };
}

function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

async function push(env, id, rec, payload) {
  const res = await sendPush(rec.subscription, JSON.stringify(payload), keys(env));
  if (res.status === 404 || res.status === 410) await env.SUBS.delete(id);   // abonnement verlopen
  return res.status;
}

export default {
  async fetch(req, env) {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    const url = new URL(req.url);
    if (req.method !== 'POST') return new Response('Palabra push', { headers });

    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const endpoint = body.subscription?.endpoint || body.endpoint;
    if (!endpoint || !/^https:\/\//.test(endpoint)) return json({ error: 'missing endpoint' }, 400);
    const id = await idOf(endpoint);

    if (url.pathname === '/subscribe') {
      const old = (await env.SUBS.get(id, 'json')) || {};
      const hour = Math.min(23, Math.max(0, Number(body.hour) || 19));
      await env.SUBS.put(id, JSON.stringify({ ...old, subscription: body.subscription, hour, tz: body.tz || 'Europe/Amsterdam' }));
      return json({ ok: true });
    }
    const rec = await env.SUBS.get(id, 'json');
    if (!rec) return json({ error: 'unknown subscription' }, 404);

    if (url.pathname === '/practiced') {
      rec.practiced = String(body.day || '');
      await env.SUBS.put(id, JSON.stringify(rec));
      return json({ ok: true });
    }
    if (url.pathname === '/unsubscribe') {
      await env.SUBS.delete(id);
      return json({ ok: true });
    }
    if (url.pathname === '/test') {
      try { return json({ status: await push(env, id, rec, { type: 'test' }) }); } catch (e) { return json({ error: String(e) }, 502); }
    }
    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env) {
    let cursor;
    do {
      const page = await env.SUBS.list({ cursor });
      for (const { name } of page.keys) {
        const rec = await env.SUBS.get(name, 'json');
        if (!rec) continue;
        const { day, hour } = localNow(rec.tz);
        if (hour !== rec.hour || rec.lastSent === day || rec.practiced === day) continue;
        rec.lastSent = day;
        await env.SUBS.put(name, JSON.stringify(rec));
        try { await push(env, name, rec, { type: 'reminder' }); } catch (e) { console.error('push failed', e); }
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  },
};
