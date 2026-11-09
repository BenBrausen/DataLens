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

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PUB = path.join(ROOT, 'public');
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
    let body = await fs.readFile(file);
    if (p === '/index.html') body = Buffer.from(body.toString().replace('<!--INLINE_HEAD-->', '<script>window.PS_HAS_SERVER=true</script>'));
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
