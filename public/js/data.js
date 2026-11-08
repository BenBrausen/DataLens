// Plainsight data layer: curated snapshots, live sources, data.gov catalog search,
// CSV import with type inference, and conversion into the three render shapes.
(function (PS) {
  // API_BASE: where /api/search and /api/proxy live (server.js on the same origin, or the
  // Cloudflare Worker in worker/ for static hosting). DATA_BASE: where snapshots are published.
  const API = window.PS_API_BASE ?? '';
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
  PS.defaultChart = ds => PS.RECOMMENDED[ds.id] || (ds.kind === 'events' ? (ds.geo ? 'bubblemap' : 'columns') : ds.kind === 'panel' ? (ds.geo ? 'choropleth' : ds.singleTime ? 'bars' : 'barrace') : 'line');

  // ---------- loading ----------
  const cache = new Map();
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

  PS.loadCatalog = async () => {
    try { const c = await fetchJSON(`${DATA}data/catalog.json`); PS._serverOk = !!window.PS_HAS_SERVER; return c; }
    catch { return window.PS_EMBED?.catalog || []; }
  };

  PS.loadDataset = async id => {
    if (cache.has(id)) return cache.get(id);
    let ds;
    try { ds = await fetchJSON(`${DATA}data/${id}.json`); }
    catch { ds = window.PS_EMBED?.datasets?.[id]; }
    if (!ds) throw new Error('Dataset not available offline: ' + id);
    ds = prepare(structuredClone(ds));
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
  PS.searchCatalog = async (q, after) => {
    const qs = new URLSearchParams({ q, per_page: '20', has_download: 'true' });
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
              landing: r.dcat?.landingPage || `https://catalog.data.gov/dataset/${r.slug}`, modified: r.dcat?.modified || r.last_harvested_date,
              files: files.sort((a, b) => score(b) - score(a)),
            };
          }).filter(r => r.files.length),
        };
      } catch (e) { lastErr = e; }
    }
    throw new Error('Catalog search needs the Plainsight server (CORS). ' + (lastErr?.message || ''));
  };
  const score = f => (/csv/.test(f.type) ? 2 : 0) + (/rows\.csv|export\.csv|\.csv/.test(f.url) ? 1 : 0);

  // Socrata exports can be huge; the resource API lets us cap rows.
  function rewriteUrl(url) {
    const m = /^(https?:\/\/[^/]+)\/api\/(?:v3\/)?views\/([a-z0-9]{4}-[a-z0-9]{4})\/(?:export|rows)\.csv/i.exec(url);
    return m ? `${m[1]}/resource/${m[2]}.csv?$limit=50000` : url;
  }
  PS.fetchRemoteText = async url => {
    url = rewriteUrl(url);
    const tries = [`${API}api/proxy?url=${encodeURIComponent(url)}`, url];
    let lastErr;
    for (const u of tries) {
      try { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
      catch (e) { lastErr = e; }
    }
    throw new Error(`Could not download (${lastErr?.message}). Many publishers block browser downloads; run the Plainsight server to proxy them.`);
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

  // Profiles each column: date | number | state | country | text
  PS.profile = function ({ header, rows }) {
    const sample = rows.slice(0, 500);
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
      else if (share(v => stateOf(v)) > 0.8 && !/^\d+$/.test(vals[0])) type = 'state';
      else if (share(v => countryOf(v)) > 0.7 && !/^\d+$/.test(vals[0])) type = 'country';
      else if (share(v => Number.isFinite(num(v))) > 0.9) type = 'number';
      const pct = vals.some(v => /%/.test(v)) || /percent|rate|pct|share/.test(lname);
      const usd = vals.some(v => /\$/.test(v)) || /dollar|price|cost|income|wage|usd|amount|spend/.test(lname);
      return { i, name, type, distinct, pct, usd };
    });
  };

  PS.guessMapping = cols => {
    const date = cols.find(c => c.type === 'date');
    const geo = cols.find(c => c.type === 'state' || c.type === 'country');
    const value = cols.filter(c => c.type === 'number' && c !== date).sort((a, b) => b.distinct - a.distinct)[0];
    const cat = geo || cols.find(c => c.type === 'text' && c.distinct > 1 && c.distinct <= 300);
    return { time: date?.i ?? -1, value: value?.i ?? -1, category: cat?.i ?? -1, agg: 'sum' };
  };

  // Builds a normalized dataset from a parsed table and a column mapping.
  PS.buildFromTable = function (table, cols, map, meta) {
    const { rows } = table;
    const vc = cols[map.value], cc = cols[map.category], tc = cols[map.time];
    if (!vc) throw new Error('Choose a numeric value column.');
    const unit = { label: vc.name, format: vc.pct ? 'pct' : vc.usd ? 'usd' : 'number', decimals: vc.pct ? 1 : 0 };
    const agg = (arr) => {
      if (!arr.length) return null;
      if (map.agg === 'count') return arr.length;
      const s = arr.reduce((a, b) => a + b, 0);
      return map.agg === 'mean' ? s / arr.length : map.agg === 'max' ? Math.max(...arr) : map.agg === 'min' ? Math.min(...arr) : s;
    };
    const geoType = cc?.type === 'state' ? 'us-states' : cc?.type === 'country' ? 'world' : null;
    const keyOf = v => {
      if (geoType === 'us-states') { const s = stateOf(v); return s ? { id: s[0], name: s[1] } : null; }
      if (geoType === 'world') { const id = countryOf(v); return id ? { id, name: String(v).trim() } : null; }
      const s = String(v).trim(); return s ? { id: s, name: s } : null;
    };
    const vals = r => num(r[map.value]);
    let skipped = 0;
    const base = { ...meta, unit, retrieved: new Date().toISOString(), howToRead: meta.howToRead || [], caveats: meta.caveats || [] };

    if (tc && cc) {
      const groups = new Map(), timeset = new Set();
      for (const r of rows) {
        const d = toDate(r[map.time]), k = keyOf(r[map.category]), v = vals(r);
        if (!d || !k || (!Number.isFinite(v) && map.agg !== 'count')) { skipped++; continue; }
        timeset.add(d);
        if (!groups.has(k.id)) groups.set(k.id, { ...k, by: new Map() });
        const g = groups.get(k.id);
        if (!g.by.has(d)) g.by.set(d, []);
        g.by.get(d).push(v);
      }
      const times = [...timeset].sort();
      const entities = [...groups.values()].map(g => ({ id: g.id, name: g.name, values: times.map(t => (g.by.has(t) ? agg(g.by.get(t)) : null)) }));
      return { ds: prepare({ ...base, kind: 'panel', geo: geoType, times, entities, frequency: guessFreq(times), lastObservation: times.at(-1) }), skipped };
    }
    if (tc) {
      const by = new Map();
      for (const r of rows) {
        const d = toDate(r[map.time]), v = vals(r);
        if (!d || (!Number.isFinite(v) && map.agg !== 'count')) { skipped++; continue; }
        if (!by.has(d)) by.set(d, []);
        by.get(d).push(v);
      }
      const points = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, a]) => [d, agg(a)]);
      return { ds: prepare({ ...base, kind: 'timeseries', series: [{ id: 'v', name: vc.name, points }], frequency: guessFreq(points.map(p => p[0])), lastObservation: points.at(-1)?.[0] }), skipped };
    }
    if (cc) {
      const by = new Map();
      for (const r of rows) {
        const k = keyOf(r[map.category]), v = vals(r);
        if (!k || (!Number.isFinite(v) && map.agg !== 'count')) { skipped++; continue; }
        if (!by.has(k.id)) by.set(k.id, { ...k, arr: [] });
        by.get(k.id).arr.push(v);
      }
      const t = (meta.asOf || new Date().toISOString()).slice(0, 10);
      const entities = [...by.values()].map(g => ({ id: g.id, name: g.name, values: [agg(g.arr)] }));
      return { ds: prepare({ ...base, kind: 'panel', geo: geoType, times: [t], entities, frequency: 'annual', lastObservation: t, singleTime: true }), skipped };
    }
    throw new Error('Pick a time column, a category column, or both.');
  };
  function guessFreq(times) {
    if (times.length < 2) return 'annual';
    const gap = (+PS.parseDate(times.at(-1)) - +PS.parseDate(times[0])) / (times.length - 1) / 864e5;
    return gap > 300 ? 'annual' : gap > 80 ? 'quarterly' : gap > 25 ? 'monthly' : gap > 5 ? 'weekly' : 'daily';
  }
})(window.PS);
