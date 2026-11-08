// Temporary: discovers the FBI Crime Data Explorer API's response shapes from CI,
// where the API_DATA_GOV_KEY secret exists. Prints structure and short excerpts only.
const key = process.env.API_DATA_GOV_KEY;
if (!key) { console.log('API_DATA_GOV_KEY is not set'); process.exit(1); }
const call = async p => { const r = await fetch(`https://api.usa.gov/crime/fbi/cde/${p}`, { headers: { 'X-Api-Key': key } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { } return { s: r.status, t, j }; };
const shape = (o, d = 0) => (o && typeof o === 'object' && d < 3 ? Object.fromEntries(Object.entries(o).slice(0, 6).map(([k, v]) => [k, typeof v === 'object' && v ? (Object.keys(v).length > 20 ? `{${Object.keys(v).length} keys, first ${Object.keys(v)[0]}, last ${Object.keys(v).at(-1)}}` : shape(v, d + 1)) : v])) : o);
// 1. full structure and time span for one state
const a = await call('summarized/state/CA/violent-crime?from=01-1985&to=12-2025');
console.log('### CA violent 1985-2025', a.s, JSON.stringify(shape(a.j)).slice(0, 2500));
// 2. which offense slugs exist
for (const off of ['property-crime', 'homicide', 'robbery', 'aggravated-assault', 'rape', 'burglary', 'larceny', 'motor-vehicle-theft', 'arson']) {
  const r = await call(`summarized/national/${off}?from=01-2023&to=12-2023`);
  const keys = r.j?.offenses?.rates ? Object.keys(r.j.offenses.rates) : [];
  console.log(`### offense ${off}: ${r.s} rates keys=${JSON.stringify(keys)} sample=${JSON.stringify(r.j?.offenses?.rates?.[keys[0]] || {}).slice(0, 120)}`);
}
// 3. earliest month with data, national
const n = await call('summarized/national/violent-crime?from=01-1979&to=12-2025');
const nr = n.j?.offenses?.rates?.['United States Offenses'] || {};
const ks = Object.keys(nr).sort((x, y) => x.slice(3) + x.slice(0, 2) < y.slice(3) + y.slice(0, 2) ? -1 : 1);
console.log(`### national span: ${n.s} months=${ks.length} first=${ks[0]} last=${ks.at(-1)} top-level=${JSON.stringify(Object.keys(n.j || {}))} offenses-keys=${JSON.stringify(Object.keys(n.j?.offenses || {}))}`);
console.log('### other blocks:', JSON.stringify(shape(Object.fromEntries(Object.entries(n.j || {}).filter(([k]) => k !== 'offenses')))).slice(0, 1500));
