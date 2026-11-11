// Builds the deployable site in _site/: a copy of public/ plus, for every dataset,
// a page at /<id>/ with its own title, description, link-preview image, Google Dataset
// markup and crawlable text (summary, facts, how to read it, source, related charts).
// Also writes sitemap.xml and feed.xml (RSS of new data releases).
//
// Each page's text and image come from the real app via its render hook
// (?render=1), so pages say exactly what the charts say, claim check included.
//   node scripts/build-pages.mjs            (needs Playwright + Chromium)
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUB = path.join(ROOT, 'public'), SITE = path.join(ROOT, '_site');
const ORIGIN = 'https://civiccharts.com';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };

// 1. Start from an exact copy of public/, so a failure below still deploys the app.
await fs.rm(SITE, { recursive: true, force: true });
await fs.cp(PUB, SITE, { recursive: true });
const template = await fs.readFile(path.join(PUB, 'index.html'), 'utf8');
const catalog = JSON.parse(await fs.readFile(path.join(PUB, 'data/catalog.json'), 'utf8'));
const registry = JSON.parse(await fs.readFile(path.join(PUB, 'sources/registry.json'), 'utf8'));
let releases = []; try { releases = JSON.parse(await fs.readFile(path.join(PUB, 'data/releases.json'), 'utf8')); } catch { }
const topicName = id => registry.topics.find(t => t.id === id)?.name || 'More data';

// 2. Serve _site locally and read every chart through the render hook.
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, path.normalize(p)); if (!f.startsWith(SITE)) throw new Error('forbidden');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(await fs.readFile(f));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const infos = {};
for (const c of catalog) {
  try {
    await page.goto(`${base}/?d=${encodeURIComponent(c.id)}&render=1&size=link&format=image`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.CC_RENDER?.ready, null, { timeout: 60000 });
    const info = await page.evaluate(() => window.CC_RENDER.info);
    const png = await page.evaluate(() => window.CC_RENDER.image());
    await fs.mkdir(path.join(SITE, c.id), { recursive: true });
    await fs.writeFile(path.join(SITE, c.id, 'og.png'), Buffer.from(png.split(',')[1], 'base64'));
    infos[c.id] = info;
    console.log('page', c.id.padEnd(24), cut(info.headline, 70));
  } catch (e) { console.error('FAIL', c.id, e.message); }
}
await browser.close(); server.close();

// 3. Write each dataset page.
const pageTitle = info => {
  const [val, dateRaw] = String(info.latestText || '').split(' · '), date = (dateRaw || '').replace(/^through /, '');
  const v = (val || '').replace(/^U\.S\.: /, 'U.S. '); // on map pages the value is the national figure; say so
  let t = v && !/\b(states|counties|countries|events)\b/.test(v) && date ? `${info.title}: ${v} (${date})` : date ? `${info.title} (${date})` : info.title;
  if (t.length > 62) t = date ? `${info.title} (${date})` : info.title;
  return `${t} | Civic Charts`;
};
const related = c => catalog.filter(x => x.id !== c.id && x.topic === c.topic && infos[x.id] && (!x.reframes || x.reframes[0] === x.id)).slice(0, 8);
function staticBody(c, info) {
  const facts = info.facts.slice(0, 5).map(f => `<li>${esc(f)}</li>`).join('');
  const read = info.howToRead.length ? `<div class="howto"><b>How to read it</b> ${info.howToRead.map(esc).join(' ')}</div>` : '';
  const src = info.source || {};
  const rel = related(c).map(x => `<li><a href="/${x.id}/">${esc(infos[x.id].title)}</a></li>`).join('');
  return `<div class="static-intro"><h2>${esc(info.title)}</h2><p class="headline">${esc(info.headline)}</p><ul class="facts">${facts}</ul>${read}
<p class="muted">Source: ${src.url ? `<a href="${esc(src.url)}" rel="noopener">${esc(src.publisher)}</a>` : esc(src.publisher)}${src.dataset ? ', ' + esc(src.dataset) : ''}. Updated automatically from the official data.</p>
${rel ? `<h2>More ${esc(topicName(c.topic).toLowerCase())} charts</h2><ul class="static-links">${rel}</ul>` : ''}<p><a href="/">All charts on Civic Charts</a></p></div>`;
}
function datasetLd(c, info) {
  const src = info.source || {};
  const desc = cut(`${info.description || ''} ${info.headline}`.trim(), 4900);
  return {
    '@context': 'https://schema.org', '@type': 'Dataset', name: info.title, description: desc.length >= 50 ? desc : `${desc} Charted from official data by Civic Charts.`,
    url: `${ORIGIN}/${c.id}/`, isAccessibleForFree: true, keywords: [topicName(c.topic), src.publisher, 'open data', 'chart'].filter(Boolean),
    creator: { '@type': 'Organization', name: src.publisher }, ...(src.url ? { isBasedOn: src.url } : {}),
    includedInDataCatalog: { '@type': 'DataCatalog', name: 'Civic Charts', url: ORIGIN + '/' },
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${ORIGIN}/data/${c.id}.json` }],
    ...(c.firstObservation && c.lastObservation ? { temporalCoverage: `${String(c.firstObservation).slice(0, 10)}/${String(c.lastObservation).slice(0, 10)}` } : {}),
    spatialCoverage: c.geo === 'world' ? 'World' : 'United States', dateModified: String(info.retrieved || '').slice(0, 10) || undefined,
  };
}
function withHead(html, { title, desc, url, image, imageW, imageH, alt, ld, pageD }) {
  const set = (re, tag) => { if (!re.test(html)) throw new Error('template changed: ' + re); html = html.replace(re, tag); };
  set(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(url)}">`);
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title.replace(/ \| Civic Charts$/, ''))}">`);
  set(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
  set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(image)}">`);
  set(/<meta property="og:image:width" content="[^"]*">/, `<meta property="og:image:width" content="${imageW}">`);
  set(/<meta property="og:image:height" content="[^"]*">/, `<meta property="og:image:height" content="${imageH}">`);
  set(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(cut(alt, 400))}">`);
  const extra = `<link rel="alternate" type="application/rss+xml" title="Civic Charts: new data releases" href="${ORIGIN}/feed.xml">\n`
    + (ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n` : '')
    + (pageD ? `<script>window.CC_PAGE = { d: ${JSON.stringify(pageD)} };</script>\n` : '');
  return html.replace('</head>', extra + '</head>');
}
for (const c of catalog) {
  const info = infos[c.id]; if (!info) continue;
  let html = withHead(template, {
    title: pageTitle(info), desc: cut(`${info.headline} Source: ${info.source?.publisher}.`, 158), url: `${ORIGIN}/${c.id}/`,
    image: `${ORIGIN}/${c.id}/og.png`, imageW: info.width, imageH: info.height, alt: info.altText, ld: datasetLd(c, info), pageD: c.id,
  });
  html = html.replace('<aside class="panel insight" id="insight"></aside>', `<aside class="panel insight" id="insight">${staticBody(c, info)}</aside>`);
  await fs.writeFile(path.join(SITE, c.id, 'index.html'), html);
}

// 4. Homepage: crawlable list of every chart, grouped by topic (the app replaces it on load).
const byTopic = {};
for (const c of catalog) if (infos[c.id]) (byTopic[topicName(c.topic)] ||= []).push(c);
const list = Object.entries(byTopic).map(([t, cs]) => `<h2>${esc(t)}</h2><ul class="static-links">${cs.map(c => `<li><a href="/${c.id}/">${esc(infos[c.id].title)}</a></li>`).join('')}</ul>`).join('');
let home = template.replace('</head>', `<link rel="alternate" type="application/rss+xml" title="Civic Charts: new data releases" href="${ORIGIN}/feed.xml">\n</head>`);
home = home.replace('<aside class="panel insight" id="insight"></aside>', `<aside class="panel insight" id="insight"><div class="static-intro"><h2>Charts from official public data</h2>${list}</div></aside>`);
await fs.writeFile(path.join(SITE, 'index.html'), home);

// 5. Sitemap with every page.
const day = t => String(t || '').slice(0, 10);
const urls = [`  <url><loc>${ORIGIN}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  ...catalog.filter(c => infos[c.id]).map(c => `  <url><loc>${ORIGIN}/${c.id}/</loc>${day(c.released || c.retrieved) ? `<lastmod>${day(c.released || c.retrieved)}</lastmod>` : ''}<changefreq>${['weekly', 'real-time'].includes(c.frequency) ? 'daily' : 'weekly'}</changefreq></url>`)];
await fs.writeFile(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

// 6. RSS feed of new releases. The newest release of each dataset carries its current headline.
const seen = new Set();
const items = releases.slice(0, 50).map(r => {
  const info = infos[r.id], first = !seen.has(r.id); seen.add(r.id);
  const desc = first && info ? `${info.headline} Source: ${info.source?.publisher}.` : `New ${r.publisher || 'official'} data for ${r.title}, through ${day(r.lastObservation)}.`;
  return `  <item><title>${esc(`New data: ${info?.title || r.title}`)}</title><link>${ORIGIN}/${r.id}/</link><guid isPermaLink="false">${esc(r.id + '@' + r.released)}</guid><pubDate>${new Date(r.released).toUTCString()}</pubDate><description>${esc(desc)}</description></item>`;
});
await fs.writeFile(path.join(SITE, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>Civic Charts: new data releases</title><link>${ORIGIN}/</link>
  <atom:link href="${ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>New official public data as it's released, charted with the source cited.</description><language>en-us</language>
${items.join('\n')}
</channel></rss>
`);
console.log(`\n${Object.keys(infos).length} of ${catalog.length} dataset pages, sitemap with ${urls.length} URLs, feed with ${items.length} releases.`);
