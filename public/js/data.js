// Plainsight data layer: curated snapshots, live sources, data.gov catalog search,
// CSV import with type inference, and conversion into the three render shapes.
(function (PS) {
  // API_BASE: where /api/search and /api/proxy live (server.js on the same origin, or the
  // Cloudflare Worker in worker/ for static hosting). DATA_BASE: where snapshots are published.
  // Same-origin server.js when present; otherwise (GitHub Pages, single-file build)
  // the Cloudflare Worker in worker/proxy.js, set as PS_PROXY in index.html.
  const API = window.PS_API_BASE ?? (window.PS_HAS_SERVER ? '' : (window.PS_PROXY || ''));
  const DATA = window.PS_DATA_BASE ?? '';
  const hasServer = () => PS._serverOk === true;

  PS.CHARTS = {
    line: { name: 'Line', kinds: ['timeseries', 'panel'], icon: 'M3 17l5-6 4 3 7-9', desc: 'Change over time, drawn as it happens' },
    area: { name: 'Area', kinds: ['timeseries'], icon: 'M3 18l5-7 4 3 7-9v13z', desc: 'Emphasizes volume, like a total that accumulates' },
    bignumber: { name: 'Big number', kinds: ['timeseries'], icon: 'M5 6h3v12M12 6h6l-6 12', desc: 'One headline figure that counts up' },
    columns: { name: 'Columns', kinds: ['timeseries', 'events'], icon: 'M5 18V10M10 18V6M15 18v-5M20 18V8', desc: 'Yearly averages (or daily counts) as columns' },
    barrace: { name: 'Bar race', kinds: ['panel'], icon: 'M4 6h14M4 11h10M4 16h6', desc: 'Rankings that shift over time' },
    bars: { name: 'Ranked bars', kinds: ['panel'], icon: 'M4 6h16M4 11h11M4 16h7', desc: 'Compare places at one moment' },
    choropleth: { name: 'Map', kinds: ['panel'], geo: true, icon: 'M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z', desc: 'Shaded map that evolves over time' },
    bubblemap: { name: 'Bubble map', kinds: ['events'], icon: 'M7 9a2 2 0 1 0 0 .1M15 14a4 4 0 1 0 0 .1', desc: 'Events appear where and when they happened' },
  };
  PS.RECOMMENDED = { 'federal-debt': 'area', 'federal-debt-real': 'area', 'state-population': 'barrace', 'world-gdp': 'barrace',
    'life-expectancy': 'choropleth', 'state-unemployment': 'choropleth', 'overdose-deaths': 'choropleth', 'overdose-rate': 'choropleth', earthquakes: 'bubblemap' };

  PS.chartsFor = ds => Object.entries(PS.CHARTS)
    .filter(([id, c]) => c.kinds.includes(ds.kind) && (!c.geo || ds.geo) && !(ds.singleTime && ['line', 'barrace'].includes(id)))
    .map(([id, c]) => ({ id, ...c }));
  PS.defaultChart = ds => PS.RECOMMENDED[ds.id] || ds.defaultChart || (ds.kind === 'events' ? (ds.geo ? 'bubblemap' : 'columns') : ds.kind === 'panel' ? (ds.geo ? 'choropleth' : ds.singleTime ? 'bars' : 'barrace') : 'line');

  // ---------- loading ----------
  const cache = new Map();
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

  PS.loadCatalog = async () => {
    let c;
    try { c = await fetchJSON(`${DATA}data/catalog.json`); PS._serverOk = !!window.PS_HAS_SERVER; }
    catch { c = window.PS_EMBED?.catalog || []; }
    try { PS.REGISTRY = await fetchJSON(`${DATA}sources/registry.json`); }
    catch { PS.REGISTRY = window.PS_EMBED?.registry || null; }
    return (PS.CATALOG = c);
  };

  PS.loadDataset = async id => {
    if (cache.has(id)) return cache.get(id);
    let ds;
    try { ds = await fetchJSON(`${DATA}data/${id}.json`); }
    catch { ds = window.PS_EMBED?.datasets?.[id]; }
    if (!ds) throw new Error('Dataset not available offline: ' + id);
    ds = prepare(structuredClone(ds));
    const c = PS.CATALOG?.find(x => x.id === id);
    if (c) Object.assign(ds, { tier: c.tier, topic: c.topic, sourceId: c.sourceId });
    cache.set(id, ds);
    return ds;
  };

  // Live refresh straight from the publisher when the browser can reach it (CORS-enabled feeds).
  PS.LIVE = {
    earthquakes: async () => {
      const j = await fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson');
      const base = await PS.loadDataset('earthquakes');
      const events = j.features.filter(f => f.properties.mag != null).map(f => ({
        t: new Date(f.properties.time).toISOString(), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], value: f.properties.mag, label: f.properties.place,
      })).sort((a, b) => a.t.localeCompare(b.t));
      const ds = prepare({ ...stripPrepared(base), events, retrieved: new Date().toISOString(), lastObservation: events.at(-1)?.t });
      cache.set('earthquakes', ds);
      return ds;
    },
  };
  const stripPrepared = ds => { const { _tms, _series, _events, ...rest } = ds; return rest; };

  // Adds numeric time fields used by the renderers.
  function prepare(ds) {
    if (ds.kind === 'timeseries') {
      ds.series.forEach(s => { s.pts = s.points.map(([d, v]) => ({ t: +PS.parseDate(d), v })); });
    } else if (ds.kind === 'panel') {
      ds._tms = ds.times.map(d => +PS.parseDate(d));
    } else if (ds.kind === 'events') {
      ds.events.forEach(e => { e.tm = +new Date(e.t); });
    }
    return ds;
  }
  PS.prepare = prepare;

  // ---------- data.gov catalog ----------
  PS.searchCatalog = async (q, after, org) => {
    const qs = new URLSearchParams({ q, per_page: '20', has_download: 'true' });
    if (org) qs.set('org_slug', org);
    if (after) qs.set('after', after);
    const urls = [`${API}api/search?${qs}`, `https://catalog.data.gov/search?${qs}`];
    let lastErr;
    for (const u of urls) {
      try {
        const j = await fetchJSON(u);
        return {
          after: j.after,
          results: (j.results || []).map(r => {
            const dist = (r.dcat?.distribution || []);
            const files = dist.map(d => ({ url: d.downloadURL || d.accessURL, type: (d.mediaType || d.format || '').toLowerCase(), title: d.title }))
              .filter(d => d.url && /csv|json|text\/plain/.test(d.type + d.url.toLowerCase()));
            return {
              id: r.slug || r.identifier, title: r.title, description: (r.description || '').slice(0, 400),
              publisher: r.organization?.name || r.publisher || 'Unknown publisher', orgType: r.organization?.organization_type || '',
              tier: ORGTYPE_TIER[r.organization?.organization_type] || 'federal', platform: 'data.gov',
              state: r.organization?.organization_type === 'State Government' ? (PS.STATE_LIST.find(x => (r.organization.name || '').includes(x[2]))?.[2] || null) : null,
              landing: r.dcat?.landingPage || `https://catalog.data.gov/dataset/${r.slug}`, modified: r.dcat?.modified || r.last_harvested_date,
              files: files.sort((a, b) => score(b) - score(a)),
            };
          }).filter(r => r.files.length),
        };
      } catch (e) { lastErr = e; }
    }
    throw new Error('Catalog search needs the Plainsight server (CORS). ' + (lastErr?.message || ''));
  };
  const ORGTYPE_TIER = { 'Federal Government': 'federal', 'State Government': 'state', 'City Government': 'local', 'County Government': 'local', University: 'academic' };
  const score = f => (/csv/.test(f.type) ? 2 : 0) + (/rows\.csv|export\.csv|\.csv/.test(f.url) ? 1 : 0);

  // Socrata exports can be huge; the resource API lets us cap rows.
  function rewriteUrl(url) {
    const m = /^(https?:\/\/[^/]+)\/api\/(?:v3\/)?views\/([a-z0-9]{4}-[a-z0-9]{4})\/(?:export|rows)\.csv/i.exec(url);
    return m ? `${m[1]}/resource/${m[2]}.csv?$limit=50000` : url;
  }
  // Downloads at most maxBytes, cutting at the last full line, so a 160 MB GIS
  // export never freezes the tab. Tries the publisher directly first (Socrata,
  // CKAN and ArcGIS allow it), then the Plainsight proxy.
  async function readCapped(r, maxBytes) {
    const reader = r.body.getReader(), chunks = [];
    let n = 0, truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length;
      if (n >= maxBytes) { truncated = true; reader.cancel(); break; }
    }
    let text = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : await new Blob(chunks).arrayBuffer());
    if (truncated) text = text.slice(0, text.lastIndexOf('\n'));
    return { text, truncated };
  }
  PS.fetchRemote = async (url, maxBytes = 30e6) => {
    url = rewriteUrl(url);
    const tries = [url, `${API}api/proxy?url=${encodeURIComponent(url)}`];
    let lastErr;
    for (const u of tries) {
      try { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await readCapped(r, maxBytes); }
      catch (e) { lastErr = e; }
    }
    throw new Error(`Could not download (${lastErr?.message}). This publisher blocks browser downloads; run the Plainsight server or proxy to load it.`);
  };
  PS.fetchRemoteText = async url => (await PS.fetchRemote(url)).text;

  // ---------- state & local portals ----------
  PS.SEARCHABLE = ['socrata', 'ckan', 'arcgis', 'arcgis-org'];
  PS.statePortals = code => (PS.REGISTRY?.states.find(s => s.code === code)?.portals || []);
  const stateOfHost = host => PS.REGISTRY?.states.find(s => s.portals.some(p => p.host === host));
  // City/county portals are "local" tier; everything else in a state's list is "state".
  const portalOf = host => PS.REGISTRY?.states.flatMap(s => s.portals).find(p => p.host === host);
  const tierOf = host => (portalOf(host)?.scope === 'local' ? 'local' : 'state');
  const fallbackPublisher = (host, st) => { const p = portalOf(host); return p?.scope === 'local' ? p.name : st ? `State of ${st.name}` : host; };
  const orgIndex = () => new Map((PS.REGISTRY?.states || []).flatMap(s => s.portals.filter(p => p.orgId).map(p => [p.orgId, { state: s.name, name: p.name }])));
  const arcgisDownload = (id, type) => (type === 'CSV' ? `https://www.arcgis.com/sharing/rest/content/items/${id}/data` : `https://hub.arcgis.com/api/download/v1/items/${id}/csv?redirect=true&layers=0`);

  const ADAPTERS = {
    async socrata(portals, q) {
      const qs = new URLSearchParams({ domains: portals.map(p => p.host).join(','), only: 'dataset', limit: '40' });
      if (q) qs.set('q', q);
      const j = await fetchJSON(`https://api.us.socrata.com/api/catalog/v1?${qs}`);
      return j.results.map(r => {
        const host = r.metadata.domain, st = stateOfHost(host);
        return {
          id: r.resource.id, title: r.resource.name, description: (r.resource.description || '').slice(0, 400),
          publisher: r.resource.attribution || fallbackPublisher(host, st), state: st?.name, host, platform: 'socrata', tier: tierOf(host),
          topic: r.classification?.domain_category || '', modified: r.resource.updatedAt, landing: r.permalink || `https://${host}/d/${r.resource.id}`,
          files: [{ url: `https://${host}/resource/${r.resource.id}.csv?$limit=50000`, type: 'text/csv' }],
        };
      });
    },
    async ckan(portals, q) {
      const all = await Promise.all(portals.map(async p => {
        const j = await fetchJSON(`https://${p.host}/api/3/action/package_search?${new URLSearchParams({ q: q || '*:*', rows: '20', fq: 'res_format:CSV' })}`);
        const st = stateOfHost(p.host);
        return j.result.results.map(r => ({
          id: r.id, title: r.title, description: (r.notes || '').slice(0, 400), publisher: r.organization?.title || fallbackPublisher(p.host, st),
          state: st?.name, host: p.host, platform: 'ckan', tier: tierOf(p.host), modified: r.metadata_modified, landing: `https://${p.host}/dataset/${r.name}`,
          files: (r.resources || []).filter(x => /csv/i.test(x.format || '') && x.url).map(x => ({ url: x.url, type: 'text/csv', title: x.name })),
        })).filter(r => r.files.length);
      }));
      return all.flat();
    },
    async arcgis(portals, q) {
      const all = await Promise.all(portals.map(async p => {
        const qs = new URLSearchParams({ limit: '20', filter: "type IN ('Feature Service','Table','CSV')" }); if (q) qs.set('q', q);
        const j = await fetchJSON(`https://${p.host}/api/search/v1/collections/dataset/items?${qs}`);
        const st = stateOfHost(p.host);
        return (j.features || []).filter(f => ['Feature Service', 'Table', 'CSV'].includes(f.properties.type)).map(f => {
          const pr = f.properties;
          const url = pr.type === 'CSV' ? `https://www.arcgis.com/sharing/rest/content/items/${f.id}/data` : `https://hub.arcgis.com/api/download/v1/items/${f.id}/csv?redirect=true&layers=0`;
          return {
            id: f.id, title: pr.title, description: String(pr.snippet || pr.description || '').replace(/<[^>]+>/g, ' ').slice(0, 400),
            publisher: pr.source || fallbackPublisher(p.host, st), state: st?.name, host: p.host, platform: 'arcgis', tier: tierOf(p.host),
            modified: pr.modified ? new Date(pr.modified).toISOString() : null, landing: `https://${p.host}/datasets/${f.id}`,
            files: [{ url, type: 'text/csv' }],
          };
        });
      }));
      return all.flat();
    },
  };

  // State agencies on ArcGIS Online: one central search across all their organizations.
  ADAPTERS['arcgis-org'] = async (portals, q) => {
    const idx = orgIndex();
    const ids = [...new Set(portals.map(p => p.orgId))];
    const qs = new URLSearchParams({ limit: '40', filter: `orgid IN (${ids.map(x => `'${x}'`).join(',')}) AND type IN ('Feature Service','Table','CSV')` });
    if (q) qs.set('q', q);
    const j = await fetchJSON(`https://hub.arcgis.com/api/search/v1/collections/dataset/items?${qs}`);
    return (j.features || []).map(f => {
      const pr = f.properties, org = idx.get(pr.orgId) || {};
      return {
        id: f.id, title: pr.title, description: String(pr.snippet || pr.description || '').replace(/<[^>]+>/g, ' ').slice(0, 400),
        publisher: pr.source || org.name || 'State agency', state: org.state, host: 'hub.arcgis.com', platform: 'arcgis-org', tier: 'state',
        modified: pr.modified ? new Date(pr.modified).toISOString() : null, landing: `https://hub.arcgis.com/datasets/${f.id}`,
        files: [{ url: arcgisDownload(f.id, pr.type), type: 'text/csv' }],
      };
    });
  };

  // Agency GIS accounts publish scratch layers ("testpoints4", "Copy of …"); keep them out of results.
  const JUNK = /^(test|copy of|untitled|sample|template|draft)\b|\btest\d*$|^testpoints|_test\b|\bdo not use\b/i;
  // Searches the portals of one state (code) or of every state (null). Results
  // from different portals are interleaved so no single portal floods the list.
  PS.searchPortals = async (code, q) => {
    const portals = (code ? PS.statePortals(code) : PS.REGISTRY?.states.flatMap(s => s.portals) || []).filter(p => PS.SEARCHABLE.includes(p.platform));
    if (!portals.length) return { results: [], errors: [], portals: 0 };
    const groups = {}; portals.forEach(p => (groups[p.platform] ||= []).push(p));
    const errors = [];
    const lists = await Promise.all(Object.entries(groups).map(([plat, ps]) => {
      // Socrata and ArcGIS-org search every state in one call; CKAN and ArcGIS sites only one state at a time.
      if (!['socrata', 'arcgis-org'].includes(plat) && !code) return [];
      return ADAPTERS[plat](ps, q).catch(e => { errors.push(`${ps.map(p => p.host).join(', ')}: ${e.message}`); return []; });
    }));
    const byHost = {};
    lists.flat().filter(r => !JUNK.test((r.title || '').trim())).forEach(r => (byHost[r.host + '|' + (r.state || '')] ||= []).push(r));
    const queues = Object.values(byHost), results = [];
    while (queues.some(qq => qq.length)) queues.forEach(qq => qq.length && results.push(qq.shift()));
    return { results, errors, portals: portals.length };
  };

  // ---------- CSV ----------
  PS.parseCSV = function (text) {
    const delim = (text.slice(0, 2000).match(/\t/g) || []).length > (text.slice(0, 2000).match(/,/g) || []).length ? '\t' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const clean = rows.filter(r => r.some(c => c.trim() !== ''));
    const header = clean[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    return { header, rows: clean.slice(1) };
  };

  const STATE_LIST = [['AL','01','Alabama'],['AK','02','Alaska'],['AZ','04','Arizona'],['AR','05','Arkansas'],['CA','06','California'],['CO','08','Colorado'],['CT','09','Connecticut'],['DE','10','Delaware'],['DC','11','District of Columbia'],['FL','12','Florida'],['GA','13','Georgia'],['HI','15','Hawaii'],['ID','16','Idaho'],['IL','17','Illinois'],['IN','18','Indiana'],['IA','19','Iowa'],['KS','20','Kansas'],['KY','21','Kentucky'],['LA','22','Louisiana'],['ME','23','Maine'],['MD','24','Maryland'],['MA','25','Massachusetts'],['MI','26','Michigan'],['MN','27','Minnesota'],['MS','28','Mississippi'],['MO','29','Missouri'],['MT','30','Montana'],['NE','31','Nebraska'],['NV','32','Nevada'],['NH','33','New Hampshire'],['NJ','34','New Jersey'],['NM','35','New Mexico'],['NY','36','New York'],['NC','37','North Carolina'],['ND','38','North Dakota'],['OH','39','Ohio'],['OK','40','Oklahoma'],['OR','41','Oregon'],['PA','42','Pennsylvania'],['RI','44','Rhode Island'],['SC','45','South Carolina'],['SD','46','South Dakota'],['TN','47','Tennessee'],['TX','48','Texas'],['UT','49','Utah'],['VT','50','Vermont'],['VA','51','Virginia'],['WA','53','Washington'],['WV','54','West Virginia'],['WI','55','Wisconsin'],['WY','56','Wyoming']];
  const STATE_LOOKUP = new Map();
  STATE_LIST.forEach(([ab, f, n]) => { STATE_LOOKUP.set(ab.toLowerCase(), [f, n]); STATE_LOOKUP.set(n.toLowerCase(), [f, n]); STATE_LOOKUP.set(f, [f, n]); STATE_LOOKUP.set(String(+f), [f, n]); });
  PS.STATE_LIST = STATE_LIST;
  const stateOf = v => STATE_LOOKUP.get(String(v).trim().toLowerCase().replace(/^state of /, ''));
  const countryOf = v => {
    const s = String(v).trim(); const G = window.PS_GEO;
    return G.iso3ToNum[s.toUpperCase()] || G.countryNameToNum[s.toLowerCase()];
  };

  const num = v => {
    if (v == null) return NaN;
    const s = String(v).trim().replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    return s === '' ? NaN : Number(s);
  };
  function toDate(v) {
    const s = String(v).trim();
    if (/^(1[6-9]|20)\d{2}$/.test(s)) return `${s}-12-31`;
    if (/^\d{4}-\d{1,2}(-\d{1,2})?([T ].*)?$/.test(s)) return s.length > 10 ? new Date(s).toISOString() : s;
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = /^([A-Za-z]{3,9})\.? (\d{4})$/.exec(s);
    if (m) { const i = PS.MONTHS_LONG.findIndex(x => x.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3))); if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}-01`; }
    m = /^(\d{4})\s*-?\s*Q([1-4])$/i.exec(s);
    if (m) return `${m[1]}-${String((+m[2] - 1) * 3 + 1).padStart(2, '0')}-01`;
    return null;
  }

  // ---------- counties ----------
  // Name lookup per state, built from the county map. Matches "Albany", "Albany County",
  // "ALBANY CO.", "St. Louis city", "Orleans Parish", "Anchorage Municipality".
  const normCounty = v => String(v).toLowerCase().replace(/\./g, '').replace(/\bsaint\b/g, 'st').replace(/\s+(county|co|parish|borough|census area|municipality|city and borough)$/, '').replace(/[^a-z0-9 ]/g, '').trim();
  let COUNTY_IDX = null;
  function countyIndex() {
    if (COUNTY_IDX) return COUNTY_IDX;
    const C = window.PS_GEO_COUNTIES; if (!C) return null;
    COUNTY_IDX = { byState: new Map(), cities: new Map(), ids: new Set(), names: new Map() };
    const abbr = new Map(STATE_LIST.map(([a, f]) => [f, a]));
    for (const g of C.objects.counties.geometries) {
      const id = String(g.id), st = id.slice(0, 2), n = normCounty(g.properties.name);
      COUNTY_IDX.ids.add(id);
      // Independent cities (St. Louis city, Baltimore city, most of Virginia's) have
      // county codes of 500+ and share names with real counties.
      const isCity = +id.slice(2) >= 500;
      COUNTY_IDX.names.set(id, `${g.properties.name}${isCity ? ' city' : st === '22' ? ' Parish' : st === '02' ? '' : ' County'}, ${abbr.get(st) || ''}`);
      const bucket = isCity ? COUNTY_IDX.cities : COUNTY_IDX.byState;
      if (!bucket.has(st)) bucket.set(st, new Map());
      bucket.get(st).set(n, id);
    }
    return COUNTY_IDX;
  }
  PS.countyName = id => countyIndex()?.names.get(id) || id;
  const countyFips = v => { const s = String(v).trim(); if (!/^\d{4,5}$/.test(s)) return null; const id = s.padStart(5, '0'); return countyIndex()?.ids.has(id) ? id : null; };
  function countyByName(v, stateFips) {
    const idx = countyIndex(); if (!idx) return null;
    const raw = String(v).trim(), city = / city$/i.test(raw);
    const n = normCounty(city ? raw.replace(/ city$/i, '') : raw);
    const order = city ? [idx.cities, idx.byState] : [idx.byState, idx.cities];
    for (const bucket of order) {
      if (stateFips) { const id = bucket.get(stateFips)?.get(n); if (id) return id; continue; }
      for (const m of bucket.values()) if (m.has(n)) return m.get(n);
    }
    return null;
  }
  PS.needsCountyMap = header => header.some(h => /county|parish|borough|fips|geoid|area/i.test(h));

  // Judged on distinct values: a file can hold one state row per month and dozens of
  // county rows, and it's the county names that matter.
  function isCountyCol(name, distinct, stateFips) {
    if (!distinct.length || distinct.length > 4000) return false;
    const share = f => distinct.filter(f).length / distinct.length;
    const looks = /county|parish|borough/i.test(name) || share(v => /\b(county|parish|borough)$/i.test(String(v).trim())) > 0.3;
    return looks && share(v => countyByName(v, stateFips)) > 0.3;
  }
  // Profiles each column: date | number | state | country | county | countyfips | text
  PS.profile = function ({ header, rows }, ctx = {}) {
    // Sample evenly across the file: many files are sorted (totals first), so the
    // first rows alone can hide most of a column's values.
    const step = Math.max(1, Math.floor(rows.length / 2000));
    const sample = rows.filter((_, i) => i % step === 0).slice(0, 2000);
    return header.map((name, i) => {
      const vals = sample.map(r => r[i]).filter(v => v != null && String(v).trim() !== '');
      const n = vals.length || 1;
      const share = f => vals.filter(f).length / n;
      const distinct = new Set(vals).size;
      const lname = name.toLowerCase();
      const isYearish = /year|yr|date|period|month|time|week|quarter/.test(lname);
      let type = 'text';
      const allInts = share(v => /^-?\d+$/.test(String(v).trim())) > 0.95;
      if (share(v => toDate(v)) > 0.9 && (!allInts || isYearish)) type = 'date';
      else if (/fips|geoid|county.?(code|id)|cnty/i.test(name) && share(v => countyFips(v)) > 0.8) type = 'countyfips';
      else if (share(v => stateOf(v)) > 0.8 && !/^\d+$/.test(vals[0])) type = 'state';
      else if (isCountyCol(name, [...new Set(vals)], ctx.stateFips)) type = 'county';
      else if (share(v => countryOf(v)) > 0.7 && !/^\d+$/.test(vals[0])) type = 'country';
      else if (share(v => Number.isFinite(num(v))) > 0.9) type = 'number';
      const pct = vals.some(v => /%/.test(v)) || /percent|rate|pct|share/.test(lname);
      const usd = vals.some(v => /\$/.test(v)) || /dollar|price|cost|income|wage|usd|amount|spend/.test(lname);
      const isMonth = /^month$|month_?(num|number)?$/i.test(name) && share(v => (+v >= 1 && +v <= 12) || PS.MONTHS_LONG.some(m => m.toLowerCase().startsWith(String(v).toLowerCase().slice(0, 3)))) > 0.95;
      const values = distinct <= 12 ? [...new Set(vals)].map(v => [v, vals.filter(x => x === v).length]).sort((a, b) => b[1] - a[1]).map(x => x[0]) : null;
      return { i, name, type: isMonth ? 'month' : type, distinct, pct, usd, values };
    });
  };

  PS.guessMapping = (cols, table) => {
    const date = cols.find(c => c.type === 'date');
    const month = date && /year|yr/i.test(date.name) ? cols.find(c => c.type === 'month') : null;
    // The most detailed geography wins: counties over states.
    const geo = cols.find(c => c.type === 'countyfips') || cols.find(c => c.type === 'county') || cols.find(c => c.type === 'state' || c.type === 'country');
    const stateCol = cols.find(c => c.type === 'state');
    const value = cols.filter(c => c.type === 'number' && c !== date).sort((a, b) => (b.pct - a.pct) || (b.distinct - a.distinct))[0];
    // The most detailed text column is usually the "place" or "category".
    const cat = geo || cols.filter(c => c.type === 'text' && c.distinct > 1 && c.distinct <= 300).sort((a, b) => b.distinct - a.distinct)[0];
    // A low-cardinality "level" column (area_type = State/County/Metro) means the
    // file mixes totals with their parts. Default to the level with the most rows.
    const level = cols.find(c => c !== cat && c.type === 'text' && c.values && c.values.length >= 2 && c.values.length <= 8 && /type|level|geo|area|category|class/i.test(c.name));
    // With a county column, keep the county rows; otherwise the level with the most rows.
    const levelVal = level ? (['county', 'countyfips'].includes(cat?.type) && level.values.find(v => /county/i.test(v))) || level.values[0] : '';
    return { time: date?.i ?? -1, month: month?.i ?? -1, value: value?.i ?? -1, category: cat?.i ?? -1, agg: value?.pct ? 'mean' : 'sum', stateCol: stateCol?.i ?? -1,
      filterCol: level ? level.i : -1, filterVal: levelVal };
  };

  // Builds a normalized dataset from a parsed table and a column mapping.
  PS.buildFromTable = function (table, cols, map, meta) {
    let { rows } = table;
    if (map.filterCol >= 0 && map.filterVal !== '') rows = rows.filter(r => r[map.filterCol] === map.filterVal);
    const monthIdx = v => { const n = +v; if (n >= 1 && n <= 12) return n; const i = PS.MONTHS_LONG.findIndex(m => m.toLowerCase().startsWith(String(v).toLowerCase().slice(0, 3))); return i >= 0 ? i + 1 : null; };
    const timeOf = r => {
      if (map.month >= 0) { const y = String(r[map.time]).trim().slice(0, 4), m = monthIdx(r[map.month]); return /^\d{4}$/.test(y) && m ? `${y}-${String(m).padStart(2, '0')}-01` : null; }
      return toDate(r[map.time]);
    };
    let dupes = 0;
    const vc = cols[map.value], cc = cols[map.category], tc = cols[map.time];
    if (!vc) throw new Error('Choose a numeric value column.');
    // "unemployment_rate" -> "Unemployment rate"
    const pretty = n => { const t = String(n).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim(); return /[a-z]/.test(t) && t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
    const unit = { label: pretty(vc.name), format: vc.pct ? 'pct' : vc.usd ? 'usd' : 'number', decimals: vc.pct ? 1 : 0 };
    const agg = (arr) => {
      if (!arr.length) return null;
      if (map.agg === 'count') return arr.length;
      const s = arr.reduce((a, b) => a + b, 0);
      return map.agg === 'mean' ? s / arr.length : map.agg === 'max' ? Math.max(...arr) : map.agg === 'min' ? Math.min(...arr) : s;
    };
    const geoType = cc?.type === 'state' ? 'us-states' : cc?.type === 'country' ? 'world' : ['county', 'countyfips'].includes(cc?.type) ? 'us-counties' : null;
    const metaState = meta.stateFips || (meta.state && stateOf(meta.state)?.[0]) || null;
    const keyOf = (v, r) => {
      if (cc?.type === 'countyfips') { const id = countyFips(v); if (!id) return null; const nm = PS.countyName(id); return { id, name: nm, short: nm.replace(/, [A-Z]{2}$/, '') }; }
      if (cc?.type === 'county') {
        const st = map.stateCol >= 0 ? stateOf(r[map.stateCol])?.[0] : metaState;
        const id = countyByName(v, st);
        return id ? { id, name: String(v).trim(), short: String(v).trim() } : null;
      }
      if (geoType === 'us-states') { const s = stateOf(v); return s ? { id: s[0], name: s[1] } : null; }
      if (geoType === 'world') { const id = countryOf(v); return id ? { id, name: String(v).trim() } : null; }
      const s = String(v).trim(); return s ? { id: s, name: s } : null;
    };
    const vals = r => num(r[map.value]);
    let skipped = 0;
    const base = { ...meta, unit, retrieved: new Date().toISOString(), howToRead: meta.howToRead || [], caveats: [...(meta.caveats || [])] };
    if (map.filterCol >= 0 && map.filterVal !== '') base.caveats.push(`Only rows where ${cols[map.filterCol].name} is "${map.filterVal}" are shown.`);
    // Set after grouping (below); read by the trust check.
    const flagDupes = ds => { if (dupes && ['sum', 'mean'].includes(map.agg)) { ds.aggWarning = { rows: dupes, agg: map.agg }; } return ds; };

    if (tc && cc) {
      const groups = new Map(), timeset = new Set();
      for (const r of rows) {
        const d = timeOf(r), k = keyOf(r[map.category], r), v = vals(r);
        if (!d || !k || (!Number.isFinite(v) && map.agg !== 'count')) { skipped++; continue; }
        timeset.add(d);
        if (!groups.has(k.id)) groups.set(k.id, { ...k, by: new Map() });
        const g = groups.get(k.id);
        if (!g.by.has(d)) g.by.set(d, []); else dupes++;
        g.by.get(d).push(v);
      }
      const times = [...timeset].sort();
      const entities = [...groups.values()].map(g => ({ id: g.id, name: g.name, values: times.map(t => (g.by.has(t) ? agg(g.by.get(t)) : null)) }));
      return { ds: flagDupes(prepare({ ...base, kind: 'panel', geo: geoType, times, entities, frequency: guessFreq(times), lastObservation: times.at(-1) })), skipped };
    }
    if (tc) {
      const by = new Map();
      for (const r of rows) {
        const d = timeOf(r), v = vals(r);
        if (!d || (!Number.isFinite(v) && map.agg !== 'count')) { skipped++; continue; }
        if (!by.has(d)) by.set(d, []); else dupes++;
        by.get(d).push(v);
      }
      const points = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, a]) => [d, agg(a)]);
      return { ds: flagDupes(prepare({ ...base, kind: 'timeseries', series: [{ id: 'v', name: vc.name, points }], frequency: guessFreq(points.map(p => p[0])), lastObservation: points.at(-1)?.[0] })), skipped };
    }
    if (cc) {
      const by = new Map();
      for (const r of rows) {
        const k = keyOf(r[map.category], r), v = vals(r);
        if (!k || (!Number.isFinite(v) && map.agg !== 'count')) { skipped++; continue; }
        if (!by.has(k.id)) by.set(k.id, { ...k, arr: [] }); else dupes++;
        by.get(k.id).arr.push(v);
      }
      const t = (meta.asOf || new Date().toISOString()).slice(0, 10);
      const entities = [...by.values()].map(g => ({ id: g.id, name: g.name, values: [agg(g.arr)] }));
      return { ds: flagDupes(prepare({ ...base, kind: 'panel', geo: geoType, times: [t], entities, frequency: 'annual', lastObservation: t, singleTime: true })), skipped };
    }
    throw new Error('Pick a time column, a category column, or both.');
  };
  function guessFreq(times) {
    if (times.length < 2) return 'annual';
    const gap = (+PS.parseDate(times.at(-1)) - +PS.parseDate(times[0])) / (times.length - 1) / 864e5;
    return gap > 300 ? 'annual' : gap > 80 ? 'quarterly' : gap > 25 ? 'monthly' : gap > 5 ? 'weekly' : 'daily';
  }
})(window.PS);
