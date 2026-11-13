// Cloudflare Worker: gives the static (GitHub Pages) build data.gov search and CSV loading.
// Deploy: `npx wrangler deploy worker/proxy.js --name plainsight-proxy`, then set
// window.PS_API_BASE = 'https://plainsight-proxy.<you>.workers.dev/' in public/index.html.
const ALLOW = [/\.gov$/i, /\.mil$/i, /\.us$/i, /^data\.[a-z0-9-]+\.(org|com|net)$/i, /^fred\.stlouisfed\.org$/i, /^api\.worldbank\.org$/i, /^opendata\.[a-z0-9.-]+$/i,
  /\.edu$/i, /(^|\.)arcgis\.com$/i, /^api\.us\.socrata\.com$/i, /^data\.geospatialhub\.org$/i, /^ourworldindata\.org$/i];
const cors = { 'Access-Control-Allow-Origin': '*' };

// ---------- AI voice: /api/tts/status and /api/tts ----------
// Google Cloud Text-to-Speech, with the key kept here as a Worker secret (never in the site or
// GitHub). Settings, all in the Cloudflare dashboard or wrangler (see worker/README-tts.md):
//   GOOGLE_TTS_KEY      secret  Google API key, restricted to the Cloud Text-to-Speech API
//   TURNSTILE_SECRET    secret  Cloudflare Turnstile secret key (bot check)
//   TURNSTILE_SITEKEY   var     Turnstile site key (public; the site reads it from /api/tts/status)
//   TTS_KV              KV      optional: per-visitor and daily limits that hold across Cloudflare locations
//   TTS_DAILY_CHARS     var     optional daily character budget (default 160000: at most ~$4.80/day on
//                               Chirp 3 HD at $30 per million, about 400 voiceovers)
//   TTS_ORIGINS         var     optional comma list of sites allowed to call (default civiccharts.com)
const VOICES = new Set(['en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Kore', 'en-US-Chirp3-HD-Puck', 'en-US-Chirp3-HD-Aoede']);
const MAX_CHARS = 1000, PER_HOUR = 12;
const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }

async function tts(req, env, ctx, path) {
  const origins = (env.TTS_ORIGINS || 'https://civiccharts.com,https://www.civiccharts.com').split(',').map(x => x.trim());
  const origin = req.headers.get('Origin') || '';
  const okOrigin = origins.includes(origin);
  const h = { 'Access-Control-Allow-Origin': okOrigin ? origin : origins[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (path === '/api/tts/status') return json({ enabled: !!env.GOOGLE_TTS_KEY, sitekey: env.TURNSTILE_SITEKEY || null, voices: [...VOICES], maxChars: MAX_CHARS }, 200, h);
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, h);
  if (!env.GOOGLE_TTS_KEY) return json({ error: 'AI voices are not set up.' }, 503, h);
  if (!okOrigin) return json({ error: 'This site is not allowed to use the voice service.' }, 403, h);
  let body; try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400, h); }
  const text = String(body.text || '').replace(/\s+/g, ' ').trim(), voice = String(body.voice || '');
  if (!text) return json({ error: 'Write a script first.' }, 400, h);
  if (text.length > MAX_CHARS) return json({ error: `Scripts can be up to ${MAX_CHARS} characters.` }, 400, h);
  if (!VOICES.has(voice)) return json({ error: 'Unknown voice.' }, 400, h);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';

  // Bot check: every request needs a fresh Turnstile token once a secret is set.
  if (env.TURNSTILE_SECRET) {
    const form = new FormData(); form.append('secret', env.TURNSTILE_SECRET); form.append('response', String(body.token || '')); form.append('remoteip', ip);
    const v = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })).json().catch(() => ({}));
    if (!v.success) return json({ error: 'The bot check failed. Reload the page and try again.' }, 403, h);
  }

  // Same text and voice: serve the saved audio (free, instant).
  const cacheKey = new Request(`https://tts.cache/${await sha(voice + '|' + text)}.mp3`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Response(hit.body, { headers: { ...h, 'Content-Type': 'audio/mpeg', 'X-Cache': 'HIT' } });

  // Limits: per visitor per hour, and a daily character budget for the whole site.
  const hour = new Date().toISOString().slice(0, 13), day = hour.slice(0, 10);
  const daily = +(env.TTS_DAILY_CHARS || 160000);
  if (env.TTS_KV) {
    const [n, used] = await Promise.all([env.TTS_KV.get(`ip:${ip}:${hour}`), env.TTS_KV.get(`day:${day}`)]);
    if (+n >= PER_HOUR) return json({ error: `That's ${PER_HOUR} voiceovers this hour. Try again later.` }, 429, h);
    if (+used + text.length > daily) return json({ error: 'The voice service has reached today\'s limit. Try again tomorrow.' }, 429, h);
    ctx.waitUntil(Promise.all([
      env.TTS_KV.put(`ip:${ip}:${hour}`, String(+n + 1), { expirationTtl: 7200 }),
      env.TTS_KV.put(`day:${day}`, String(+used + text.length), { expirationTtl: 172800 }),
    ]));
  }

  const g = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_TTS_KEY },
    body: JSON.stringify({ input: { text }, voice: { languageCode: 'en-US', name: voice }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 } }),
  });
  if (!g.ok) { console.log('Google TTS', g.status, (await g.text()).slice(0, 300)); return json({ error: g.status === 429 ? 'The voice service is busy. Try again in a minute.' : 'The voice service had a problem. Try again later.' }, 502, h); }
  const { audioContent } = await g.json();
  const bytes = Uint8Array.from(atob(audioContent), c => c.charCodeAt(0));
  const res = new Response(bytes, { headers: { ...h, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=2592000' } });
  ctx.waitUntil(caches.default.put(cacheKey, new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=2592000' } })));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === '/api/tts' || u.pathname === '/api/tts/status') return tts(req, env, ctx, u.pathname);
    let target;
    if (u.pathname === '/api/search') {
      target = new URL('https://catalog.data.gov/search');
      u.searchParams.forEach((v, k) => target.searchParams.set(k, v));
    } else if (u.pathname === '/api/proxy') {
      try { target = new URL(u.searchParams.get('url')); } catch { return new Response('Bad URL', { status: 400, headers: cors }); }
      if (!ALLOW.some(r => r.test(target.hostname))) return new Response('Host not on the public-data allowlist', { status: 403, headers: cors });
    } else return new Response('Not found', { status: 404, headers: cors });
    const cache = caches.default, key = new Request(target.toString());
    let res = await cache.match(key);
    if (!res) {
      const up = await fetch(target, { headers: { 'User-Agent': 'civiccharts/1.0 (public data visualizer)' } });
      if (!up.ok) return new Response(`Upstream HTTP ${up.status}`, { status: 502, headers: cors });
      if (+up.headers.get('content-length') > 40e6) return new Response('File is larger than 40 MB', { status: 413, headers: cors });
      res = new Response(up.body, { headers: { ...cors, 'Content-Type': up.headers.get('content-type') || 'text/plain', 'Cache-Control': 'public, max-age=3600' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};
