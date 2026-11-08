// Cloudflare Worker: gives the static (GitHub Pages) build data.gov search and CSV loading.
// Deploy: `npx wrangler deploy worker/proxy.js --name plainsight-proxy`, then set
// window.PS_API_BASE = 'https://plainsight-proxy.<you>.workers.dev/' in public/index.html.
const ALLOW = [/\.gov$/i, /\.mil$/i, /\.us$/i, /^data\.[a-z0-9-]+\.(org|com|net)$/i, /^fred\.stlouisfed\.org$/i, /^api\.worldbank\.org$/i, /^opendata\.[a-z0-9.-]+$/i];
const cors = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
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
      const up = await fetch(target, { headers: { 'User-Agent': 'plainsight/1.0 (public data visualizer)' } });
      if (!up.ok) return new Response(`Upstream HTTP ${up.status}`, { status: 502, headers: cors });
      if (+up.headers.get('content-length') > 40e6) return new Response('File is larger than 40 MB', { status: 413, headers: cors });
      res = new Response(up.body, { headers: { ...cors, 'Content-Type': up.headers.get('content-type') || 'text/plain', 'Cache-Control': 'public, max-age=3600' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};
