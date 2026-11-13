// Civic Charts server: zero dependencies (Node 22+).
//   - serves public/
//   - /api/search   -> data.gov catalog search (adds CORS)
//   - /api/proxy    -> fetches CSV/JSON from allowlisted public-data hosts (adds CORS, caches)
//   - refreshes curated snapshots on a schedule (REFRESH_HOURS, default 6; 0 disables)
// Usage: node server.js   (PORT=8080 by default)

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import worker from './worker/proxy.js';

// The Worker code runs here too, for /api/tts. Node has no Cloudflare cache; stub it.
globalThis.caches ??= { default: { match: async () => undefined, put: async () => {} } };
// TTS_FAKE=1 answers with a synthetic "voice" (buzzy syllables and pauses) so the voiceover and
// music-ducking path can be tested without a Google key.
function fakeVoice(text) {
  const sr = 24000, segs = [];
  for (const w of text.split(/\s+/).filter(Boolean)) { segs.push([0.12 + Math.min(w.length, 10) * 0.035, 1]); segs.push([/[.!?]$/.test(w) ? 0.45 : 0.07, 0]); }
  const n = Math.ceil(segs.reduce((a, s) => a + s[0], 0.3) * sr), pcm = new Int16Array(n);
  let i = Math.floor(0.15 * sr);
  for (const [dur, on] of segs) {
    const m = Math.floor(dur * sr);
    for (let k = 0; k < m && i < n; k++, i++) if (on) { const t = i / sr, env = Math.sin(Math.PI * k / m); pcm[i] = 9000 * env * (Math.sin(2 * Math.PI * 140 * t) * 0.6 + Math.sin(2 * Math.PI * 280 * t) * 0.3 + Math.sin(2 * Math.PI * 700 * t) * 0.15); }
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.byteLength, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([head, Buffer.from(pcm.buffer)]);
}

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PUB = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(ROOT, 'public');
const PORT = +(process.env.PORT || 8080);
const REFRESH_HOURS = +(process.env.REFRESH_HOURS ?? 6);
const MAX_BYTES = 40 * 1024 * 1024;
const CACHE_MS = 60 * 60 * 1000;

// Public-data hosts only. Government domains, plus well-known open-data portals and
// statistical agencies. Keeps the proxy from becoming an open relay.
const ALLOW = [/\.gov$/i, /\.mil$/i, /\.us$/i, /^data\.[a-z0-9-]+\.(org|com|net)$/i, /^fred\.stlouisfed\.org$/i, /^api\.worldbank\.org$/i, /^opendata\.[a-z0-9.-]+$/i,
  /\.edu$/i, /(^|\.)arcgis\.com$/i, /^api\.us\.socrata\.com$/i, /^data\.geospatialhub\.org$/i, /^ourworldindata\.org$/i];
// Every portal host in the source registry is allowed too.
let registryHosts = new Set();
fs.readFile(path.join(PUB, 'sources/registry.json'), 'utf8').then(t => {
  registryHosts = new Set(JSON.parse(t).states.flatMap(s => s.portals.map(p => p.host || new URL(p.url).hostname)));
}).catch(() => {});
const allowed = host => registryHosts.has(host) || ALLOW.some(r => r.test(host));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const cache = new Map();

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
}

async function cachedFetch(url, accept) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const r = await fetch(url, { headers: { 'User-Agent': 'civiccharts/1.0 (public data visualizer)', Accept: accept || '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw Object.assign(new Error(`Upstream HTTP ${r.status}`), { status: 502 });
  const len = +r.headers.get('content-length');
  if (len > MAX_BYTES) throw Object.assign(new Error('File is larger than 40 MB'), { status: 413 });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('File is larger than 40 MB'), { status: 413 });
  const entry = { at: Date.now(), body: buf, type: r.headers.get('content-type') || 'text/plain' };
  cache.set(url, entry);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return entry;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/tts' || u.pathname === '/api/tts/status') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      if (process.env.TTS_FAKE) {
        if (u.pathname.endsWith('/status')) return send(res, 200, JSON.stringify({ enabled: true, sitekey: null, fake: true }), { 'Content-Type': 'application/json' });
        const { text = '' } = JSON.parse(raw.toString() || '{}');
        return send(res, 200, fakeVoice(String(text)), { 'Content-Type': 'audio/wav' });
      }
      // Same code as the live Worker, with the key from this machine's environment.
      const origin = req.headers.origin || `http://localhost:${PORT}`;
      const r = await worker.fetch(new Request(`http://localhost${u.pathname}`, { method: req.method, headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': req.socket.remoteAddress || '' }, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : raw }),
        { GOOGLE_TTS_KEY: process.env.GOOGLE_TTS_KEY, TTS_ORIGINS: `${origin}` }, { waitUntil() {} });
      return send(res, r.status, Buffer.from(await r.arrayBuffer()), { 'Content-Type': r.headers.get('content-type') || 'application/json' });
    }
    if (u.pathname === '/api/search') {
      const q = new URL('https://catalog.data.gov/search');
      for (const [k, v] of u.searchParams) q.searchParams.set(k, v);
      const r = await cachedFetch(q.toString(), 'application/json');
      return send(res, 200, r.body, { 'Content-Type': 'application/json' });
    }
    if (u.pathname === '/api/proxy') {
      const target = new URL(u.searchParams.get('url') || '');
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return send(res, 400, 'Bad URL');
      if (!allowed(target.hostname)) return send(res, 403, `Host not on the public-data allowlist: ${target.hostname}`);
      const r = await cachedFetch(target.toString());
      return send(res, 200, r.body, { 'Content-Type': r.type, 'Cache-Control': 'public, max-age=3600' });
    }
    // static files
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(PUB, p);
    if (!file.startsWith(PUB)) return send(res, 403, 'Forbidden');
    let body;
    try { body = await fs.readFile(file); }
    catch (e) {
      // Dataset pages (/federal-debt/) are generated in CI; locally, serve the app for them.
      if (e.code === 'ENOENT' && /^[\/\\][a-z0-9-]+[\/\\]index\.html$/.test(p)) body = await fs.readFile(path.join(PUB, 'index.html')); else throw e;
    }
    if (p.endsWith('/index.html')) body = Buffer.from(body.toString().replace('<!--INLINE_HEAD-->', '<script>window.PS_HAS_SERVER=true</script>'));
    send(res, 200, body, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': p.startsWith('/data/') ? 'no-cache' : 'public, max-age=300' });
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'Not found');
    send(res, e.status || 500, e.message);
  }
});

function refresh() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/refresh-data.mjs')], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: process.env.HTTPS_PROXY ? '1' : '' } });
  child.on('exit', code => console.log(`[refresh] finished with code ${code}`));
}
if (REFRESH_HOURS > 0) setInterval(refresh, REFRESH_HOURS * 3600e3).unref();

server.listen(PORT, () => console.log(`Civic Charts running at http://localhost:${PORT}  (snapshots refresh every ${REFRESH_HOURS || '∞'}h)`));
