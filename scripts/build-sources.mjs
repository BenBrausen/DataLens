// Builds public/sources/registry.json: tiers, topics, federal + third-party
// sources, and every state's portals with a detected platform and dataset count.
//
// Platform detection, per portal (following redirects to moved domains):
//   socrata  -> Socrata discovery API reports datasets for the domain
//   ckan     -> /api/3/action/package_search answers
//   arcgis   -> ArcGIS Hub /api/search/v1 answers
//   website  -> reachable, but no searchable API (link out)
// A portal that can't be reached keeps its previous result, so a run from a
// restricted network never erases good data. Run weekly in CI:
//   NODE_USE_ENV_PROXY=1 node scripts/build-sources.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { TIERS, TOPICS, FEDERAL, THIRD_PARTY, DATASET_TAGS, EXTRA_STATE_PORTALS, ARCGIS_STATE_ORGS } from './sources/catalog.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/sources/registry.json');
const NOW = new Date().toISOString();
const STATES = [['AL','01','Alabama'],['AK','02','Alaska'],['AZ','04','Arizona'],['AR','05','Arkansas'],['CA','06','California'],['CO','08','Colorado'],['CT','09','Connecticut'],['DE','10','Delaware'],['DC','11','District of Columbia'],['FL','12','Florida'],['GA','13','Georgia'],['HI','15','Hawaii'],['ID','16','Idaho'],['IL','17','Illinois'],['IN','18','Indiana'],['IA','19','Iowa'],['KS','20','Kansas'],['KY','21','Kentucky'],['LA','22','Louisiana'],['ME','23','Maine'],['MD','24','Maryland'],['MA','25','Massachusetts'],['MI','26','Michigan'],['MN','27','Minnesota'],['MS','28','Mississippi'],['MO','29','Missouri'],['MT','30','Montana'],['NE','31','Nebraska'],['NV','32','Nevada'],['NH','33','New Hampshire'],['NJ','34','New Jersey'],['NM','35','New Mexico'],['NY','36','New York'],['NC','37','North Carolina'],['ND','38','North Dakota'],['OH','39','Ohio'],['OK','40','Oklahoma'],['OR','41','Oregon'],['PA','42','Pennsylvania'],['RI','44','Rhode Island'],['SC','45','South Carolina'],['SD','46','South Dakota'],['TN','47','Tennessee'],['TX','48','Texas'],['UT','49','Utah'],['VT','50','Vermont'],['VA','51','Virginia'],['WA','53','Washington'],['WV','54','West Virginia'],['WI','55','Wisconsin'],['WY','56','Wyoming']];

async function get(url, { json = true, timeout = 20000 } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'plainsight-source-check/1.0' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  return { ok: r.ok, status: r.status, url: r.url, body: r.ok ? (json ? await r.json().catch(() => null) : await r.text()) : null };
}

async function detect(portalUrl) {
  const host = new URL(portalUrl).hostname;
  // 1. Socrata: answered by the central discovery API, works from anywhere.
  try {
    const r = await get(`https://api.us.socrata.com/api/catalog/v1?domains=${host}&only=dataset&limit=1`);
    if (r.ok && r.body?.resultSetSize > 0) return { platform: 'socrata', host, datasets: r.body.resultSetSize, reachable: true };
  } catch { /* fall through */ }
  // 2. Follow the portal's own redirects (portals move).
  let finalHost = host, reachable = false;
  try {
    const r = await get(portalUrl, { json: false });
    reachable = r.status < 500;
    finalHost = new URL(r.url).hostname;
  } catch { /* unreachable from here */ }
  for (const h of [...new Set([finalHost, host])]) {
    try {
      const r = await get(`https://${h}/api/3/action/package_search?rows=0`);
      if (r.ok && r.body?.success) return { platform: 'ckan', host: h, datasets: r.body.result.count, reachable: true };
    } catch { }
    try {
      const r = await get(`https://${h}/api/search/v1/collections/dataset/items?limit=1`);
      if (r.ok && r.body?.type === 'FeatureCollection') return { platform: 'arcgis', host: h, datasets: r.body.numberMatched ?? null, reachable: true };
    } catch { }
  }
  return reachable ? { platform: 'website', host: finalHost, datasets: null, reachable: true } : { reachable: false, host };
}

function parseCsv(text) {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
}

let previous = {};
try { previous = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { }
const prevPortal = new Map((previous.states || []).flatMap(s => s.portals).map(p => [p.url, p]));

const starter = parseCsv(await fs.readFile(path.join(ROOT, 'scripts/sources/state-portals.csv'), 'utf8'));
const portalsByState = new Map(STATES.map(([, , n]) => [n, []]));
for (const r of starter) portalsByState.get(r.State)?.push({ url: r['Portal URL'], name: `${r.State} open data`, scope: r.Category === 'General' ? 'statewide' : 'specialized' });
for (const p of EXTRA_STATE_PORTALS) portalsByState.get(p.state)?.push({ url: p.url, name: p.name, scope: p.scope });
// Cities, counties and regional agencies (scripts/sources/local-portals.csv).
const abbrName = new Map(STATES.map(([ab, , n]) => [ab, n]));
for (const r of parseCsv(await fs.readFile(path.join(ROOT, 'scripts/sources/local-portals.csv'), 'utf8')))
  portalsByState.get(abbrName.get(r.State))?.push({ url: r.URL, name: r.Name, scope: 'local', level: r.Level, examples: r.Examples });

async function countOrg(orgId) {
  const qs = new URLSearchParams({ limit: '1', filter: `orgid='${orgId}' AND type IN ('Feature Service','Table','CSV')` });
  const r = await get(`https://hub.arcgis.com/api/search/v1/collections/dataset/items?${qs}`);
  return r.ok ? r.body.numberMatched ?? 0 : null;
}

const states = [];
let checked = 0, kept = 0;
for (const [code, fips, name] of STATES) {
  const portals = [];
  for (const p of portalsByState.get(name) || []) {
    const d = await detect(p.url);
    const prev = prevPortal.get(p.url);
    if (!d.reachable && prev?.platform) { portals.push(prev); kept++; continue; }
    checked++;
    portals.push({ ...p, platform: d.platform || 'unknown', host: d.host, datasets: d.datasets ?? null, checked: d.reachable ? NOW : prev?.checked ?? null });
    process.stdout.write(`${name.padEnd(15)} ${(d.platform || 'unreachable').padEnd(11)} ${String(d.datasets ?? '').padStart(6)}  ${d.host}\n`);
  }
  for (const o of ARCGIS_STATE_ORGS.filter(x => x.state === name)) {
    let n = null;
    try { n = await countOrg(o.orgId); } catch { }
    const prev = prevPortal.get(o.url);
    if (n == null && prev) { portals.push(prev); kept++; continue; }
    checked++;
    portals.push({ url: o.url, name: o.name, scope: 'agency', platform: n ? 'arcgis-org' : 'unknown', host: 'hub.arcgis.com', orgId: o.orgId, datasets: n, checked: n != null ? NOW : null });
    process.stdout.write(`${name.padEnd(15)} ${'arcgis-org'.padEnd(11)} ${String(n ?? '').padStart(6)}  ${o.name}\n`);
  }
  states.push({ code, fips, name, portals });
}

// Federal publishers on data.gov (live list) for "browse by source".
let catalogOrgs = previous.catalogOrgs || [];
try {
  const r = await get('https://catalog.data.gov/api/organizations');
  if (r.ok) catalogOrgs = r.body.organizations.filter(o => o.dataset_count > 0)
    .map(o => ({ slug: o.slug, name: o.name, type: o.organization_type, datasets: o.dataset_count }))
    .sort((a, b) => b.datasets - a.datasets);
} catch { }

const registry = { generated: NOW, tiers: TIERS, topics: TOPICS, federal: FEDERAL, thirdParty: THIRD_PARTY, datasetTags: DATASET_TAGS, states, catalogOrgs };
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(registry, null, 1));
const SEARCHABLE = ['socrata', 'ckan', 'arcgis', 'arcgis-org'];
const searchable = states.flatMap(s => s.portals).filter(p => SEARCHABLE.includes(p.platform));
console.log(`\n${searchable.length} searchable portals (${states.filter(s => s.portals.some(p => SEARCHABLE.includes(p.platform))).length} states); ${checked} checked, ${kept} kept from previous run; ${catalogOrgs.length} data.gov publishers.`);
