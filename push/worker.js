/* SKIDOR push – Cloudflare Worker som skickar push-notiser för påminnelser.
 *
 * Klistras in i Cloudflare (Workers & Pages → din worker → Redigera kod).
 * Kräver: en KV-koppling med namnet SKIDOR_KV och en cron-utlösare "* * * * *".
 * Inga hemliga nycklar behöver skrivas in – tjänsten skapar sina egna nycklar första gången.
 *
 * Adresser:
 *   GET  /          → statuskontroll
 *   GET  /nyckel    → publik nyckel som appen behöver för att prenumerera
 *   POST /synka     → { sub, paminnelser:[{id, at, titel, text}] } ersätter enhetens påminnelser
 *   POST /test      → { sub } skickar en testnotis direkt
 *   POST /avsluta   → { endpoint } tar bort enheten
 */

const SUB = 'https://github.com/tomas-m-andersson/skidor'; // kontaktadress som push-tjänsterna kräver
const MAX_PAMINNELSER = 500;

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const svar = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (!env.SKIDOR_KV) return svar({ fel: 'KV-kopplingen SKIDOR_KV saknas. Se guiden, steg 3.' }, 500);
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const alla = await hamtaAlla(env);
        return svar({ ok: true, tjanst: 'SKIDOR push', enheter: Object.keys(alla).length });
      }
      if (req.method === 'GET' && url.pathname === '/nyckel') {
        const n = await vapidNycklar(env);
        return svar({ publicKey: n.publicKey });
      }
      if (req.method !== 'POST') return svar({ fel: 'Okänd adress' }, 404);
      const kropp = await req.json();

      if (url.pathname === '/synka') {
        const sub = kollaSub(kropp.sub);
        const nu = Date.now();
        const pam = (Array.isArray(kropp.paminnelser) ? kropp.paminnelser : [])
          .filter((p) => p && typeof p.at === 'number' && p.at > nu - 5 * 60e3)
          .slice(0, MAX_PAMINNELSER)
          .map((p) => ({ id: String(p.id).slice(0, 120), at: p.at, titel: String(p.titel || '').slice(0, 120), text: String(p.text || '').slice(0, 300) }));
        const alla = await hamtaAlla(env);
        alla[await nyckelFor(sub.endpoint)] = { sub, pam, uppdaterad: nu };
        await sparaAlla(env, alla);
        return svar({ ok: true, antal: pam.length });
      }
      if (url.pathname === '/test') {
        const sub = kollaSub(kropp.sub);
        const r = await skickaPush(env, sub, { titel: 'SKIDOR 🎿', text: 'Testnotis – push-notiserna fungerar!', tag: 'test' });
        return svar({ ok: r.ok, status: r.status, info: r.ok ? '' : await r.text() }, r.ok ? 200 : 502);
      }
      if (url.pathname === '/avsluta') {
        const alla = await hamtaAlla(env);
        delete alla[await nyckelFor(String(kropp.endpoint || ''))];
        await sparaAlla(env, alla);
        return svar({ ok: true });
      }
      return svar({ fel: 'Okänd adress' }, 404);
    } catch (fel) {
      return svar({ fel: String(fel && fel.message || fel) }, 400);
    }
  },

  // Körs varje minut: skicka påminnelser vars tid har kommit
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(skickaForfallna(env));
  }
};

async function skickaForfallna(env) {
  const alla = await hamtaAlla(env);
  const nu = Date.now();
  let andrat = false;
  for (const [nyckel, enhet] of Object.entries(alla)) {
    const forfallna = enhet.pam.filter((p) => p.at <= nu + 20e3);
    if (!forfallna.length) continue;
    andrat = true;
    let borta = false;
    for (const p of forfallna) {
      if (p.at < nu - 30 * 60e3) continue; // för gammal – skippa
      const r = await skickaPush(env, enhet.sub, { titel: p.titel, text: p.text, tag: p.id });
      if (r.status === 404 || r.status === 410) { borta = true; break; } // prenumerationen finns inte längre
    }
    if (borta) delete alla[nyckel];
    else enhet.pam = enhet.pam.filter((p) => p.at > nu + 20e3);
  }
  if (andrat) await sparaAlla(env, alla);
}

// ---------- Lagring ----------
async function hamtaAlla(env) { return (await env.SKIDOR_KV.get('alla', 'json')) || {}; }
async function sparaAlla(env, alla) { await env.SKIDOR_KV.put('alla', JSON.stringify(alla)); }
async function nyckelFor(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function kollaSub(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('Ogiltig prenumeration');
  }
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

// ---------- VAPID-nycklar (skapas automatiskt första gången) ----------
async function vapidNycklar(env) {
  const sparad = await env.SKIDOR_KV.get('vapid', 'json');
  if (sparad) return sparad;
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', par.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const n = { publicKey: b64u(publicRaw), privateJwk };
  await env.SKIDOR_KV.put('vapid', JSON.stringify(n));
  return n;
}

// ---------- Web Push (RFC 8291 + RFC 8292) ----------
async function skickaPush(env, sub, data) {
  const n = await vapidNycklar(env);
  const kropp = await kryptera(sub, new TextEncoder().encode(JSON.stringify(data)));
  const jwt = await vapidJwt(new URL(sub.endpoint).origin, n.privateJwk);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '1800',
      Urgency: 'high',
      Authorization: `vapid t=${jwt}, k=${n.publicKey}`
    },
    body: kropp
  });
}

async function vapidJwt(aud, privateJwk) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const osignerad = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUB })}`;
  const nyckel = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, nyckel, new TextEncoder().encode(osignerad));
  return `${osignerad}.${b64u(new Uint8Array(sig))}`;
}

// Exporteras även för test: salt och serverns nyckelpar kan anges
export async function kryptera(sub, klartext, salt = crypto.getRandomValues(new Uint8Array(16)), asPar = null) {
  const uaPublic = fromB64u(sub.keys.p256dh);
  const authSecret = fromB64u(sub.keys.auth);
  const par = asPar || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, par.privateKey, 256));

  const te = new TextEncoder();
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(te.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const chiffer = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(klartext, new Uint8Array([2]))));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, chiffer);
}

async function hmac(nyckel, data) {
  const k = await crypto.subtle.importKey('raw', nyckel, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
function concat(...delar) {
  const ut = new Uint8Array(delar.reduce((s, d) => s + d.length, 0));
  let i = 0;
  for (const d of delar) { ut.set(d, i); i += d.length; }
  return ut;
}
function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
