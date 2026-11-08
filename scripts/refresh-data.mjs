// Pulls every curated dataset from its official source, normalizes it into
// Plainsight's three shapes (timeseries | panel | events), and writes
// public/data/<id>.json plus public/data/catalog.json.
//
// Run on a schedule (cron / GitHub Action) to keep everything current:
//   NODE_USE_ENV_PROXY=1 node scripts/refresh-data.mjs
// A single failing source never blocks the others; the previous snapshot is kept.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const isoCountries = require('i18n-iso-countries');

import { DATASET_TAGS, THIRD_PARTY, FEDERAL, TIERS } from './sources/catalog.mjs';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/data');
const NOW = new Date().toISOString();

// ---------- state reference ----------
export const STATES = [
  ['AL','01','Alabama'],['AK','02','Alaska'],['AZ','04','Arizona'],['AR','05','Arkansas'],['CA','06','California'],
  ['CO','08','Colorado'],['CT','09','Connecticut'],['DE','10','Delaware'],['DC','11','District of Columbia'],['FL','12','Florida'],
  ['GA','13','Georgia'],['HI','15','Hawaii'],['ID','16','Idaho'],['IL','17','Illinois'],['IN','18','Indiana'],['IA','19','Iowa'],
  ['KS','20','Kansas'],['KY','21','Kentucky'],['LA','22','Louisiana'],['ME','23','Maine'],['MD','24','Maryland'],
  ['MA','25','Massachusetts'],['MI','26','Michigan'],['MN','27','Minnesota'],['MS','28','Mississippi'],['MO','29','Missouri'],
  ['MT','30','Montana'],['NE','31','Nebraska'],['NV','32','Nevada'],['NH','33','New Hampshire'],['NJ','34','New Jersey'],
  ['NM','35','New Mexico'],['NY','36','New York'],['NC','37','North Carolina'],['ND','38','North Dakota'],['OH','39','Ohio'],
  ['OK','40','Oklahoma'],['OR','41','Oregon'],['PA','42','Pennsylvania'],['RI','44','Rhode Island'],['SC','45','South Carolina'],
  ['SD','46','South Dakota'],['TN','47','Tennessee'],['TX','48','Texas'],['UT','49','Utah'],['VT','50','Vermont'],
  ['VA','51','Virginia'],['WA','53','Washington'],['WV','54','West Virginia'],['WI','55','Wisconsin'],['WY','56','Wyoming'],
];

// ---------- helpers ----------
async function get(url, type = 'json', tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'plainsight-data-refresh/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      if (type === 'latin1') return new TextDecoder('latin1').decode(await r.arrayBuffer());
      return type === 'json' ? await r.json() : await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

// FRED graph CSV: no API key required, supports many ids per request.
// FRED returns a zip (one CSV per frequency) when series frequencies differ,
// so mixed requests fall back to one request per series.
async function fred(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 12) {
    const chunk = ids.slice(i, i + 12);
    let text = '';
    try { text = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${chunk.join(',')}`, 'text', chunk.length > 1 ? 1 : 3); }
    catch (e) { if (chunk.length === 1) { console.warn(`  (FRED has no series ${chunk[0]}; skipped)`); out[chunk[0]] = []; continue; } }
    if (text.startsWith('PK') || !text.startsWith('observation_date')) {
      if (chunk.length === 1) { console.warn(`  (FRED returned no CSV for ${chunk[0]}; skipped)`); out[chunk[0]] = []; continue; }
      for (const id of chunk) Object.assign(out, await fred([id]));
      continue;
    }
    const rows = parseCSV(text);
    const head = rows[0];
    for (let c = 1; c < head.length; c++) out[head[c]] = [];
    for (const r of rows.slice(1)) {
      for (let c = 1; c < head.length; c++) {
        const v = parseFloat(r[c]);
        if (Number.isFinite(v)) out[head[c]].push([r[0], v]);
      }
    }
  }
  return out;
}

const fredUrl = id => `https://fred.stlouisfed.org/series/${id}`;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function yoy(points, lag) {
  const out = [];
  for (let i = lag; i < points.length; i++) {
    out.push([points[i][0], round((points[i][1] / points[i - lag][1] - 1) * 100, 2)]);
  }
  return out;
}

// Deflate nominal values into constant dollars of the latest CPI month.
function deflate(points, cpi) {
  const cpiByMonth = new Map(cpi.map(([d, v]) => [d.slice(0, 7), v]));
  const latest = cpi[cpi.length - 1][1];
  return points.map(([d, v]) => {
    let c = cpiByMonth.get(d.slice(0, 7));
    if (c == null) return null;
    return [d, round(v * latest / c, 2)];
  }).filter(Boolean);
}

function ts(meta, series) {
  const all = series.flatMap(s => s.points);
  return { ...meta, kind: 'timeseries', retrieved: NOW,
    lastObservation: all.reduce((m, p) => (p[0] > m ? p[0] : m), ''), series };
}

function panel(meta, times, entities) {
  return { ...meta, kind: 'panel', retrieved: NOW, lastObservation: times[times.length - 1], times, entities };
}

// ---------- dataset builders ----------
const builders = {};

builders['us-unemployment'] = async () => {
  const d = await fred(['UNRATE', 'U6RATE']);
  return ts({
    id: 'us-unemployment', title: 'U.S. unemployment rate', category: 'Economy', frequency: 'monthly',
    unit: { label: 'Unemployment rate', format: 'pct', decimals: 1 },
    description: 'Share of the labor force that is jobless and actively looking for work, seasonally adjusted.',
    source: { publisher: 'U.S. Bureau of Labor Statistics', dataset: 'Current Population Survey (LNS14000000)', url: 'https://www.bls.gov/cps/', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['The headline rate (U-3) only counts people actively searching for work in the past four weeks.',
      'U-6 adds discouraged workers and part-timers who want full-time work, so it always runs higher.'],
    caveats: ['People who stop looking for work leave the labor force and are not counted as unemployed, which can push the headline rate down even when the job market is weak.'],
    defaultSeries: ['UNRATE'],
  }, [
    { id: 'UNRATE', name: 'Unemployment rate (U-3)', points: d.UNRATE },
    { id: 'U6RATE', name: 'Broader rate (U-6)', points: d.U6RATE },
  ]);
};

builders['us-inflation'] = async () => {
  const d = await fred(['CPIAUCSL', 'CPILFESL']);
  return ts({
    id: 'us-inflation', title: 'U.S. inflation rate', category: 'Economy', frequency: 'monthly',
    unit: { label: 'Year-over-year change in prices', format: 'pct', decimals: 1 },
    description: 'How much consumer prices rose compared with the same month a year earlier (CPI-U, seasonally adjusted).',
    source: { publisher: 'U.S. Bureau of Labor Statistics', dataset: 'Consumer Price Index for All Urban Consumers (CPI-U)', url: 'https://www.bls.gov/cpi/', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['This is the rate prices are rising, not the price level. Falling inflation means prices are rising more slowly, not that they are falling.',
      '"Core" inflation removes food and energy, which swing a lot month to month.'],
    caveats: ['CPI tracks a basket of goods for urban consumers; individual households can experience very different inflation.'],
    defaultSeries: ['CPIAUCSL'],
    zeroLine: true,
  }, [
    { id: 'CPIAUCSL', name: 'All items', points: yoy(d.CPIAUCSL, 12) },
    { id: 'CPILFESL', name: 'Core (ex. food & energy)', points: yoy(d.CPILFESL, 12) },
  ]);
};

builders['mortgage-rate'] = async () => {
  const d = await fred(['MORTGAGE30US', 'MORTGAGE15US']);
  return ts({
    id: 'mortgage-rate', title: '30-year mortgage rate', category: 'Housing', frequency: 'weekly',
    unit: { label: 'Average rate', format: 'pct', decimals: 2 },
    description: 'Average rate on a 30-year fixed-rate mortgage in the U.S., surveyed weekly.',
    source: { publisher: 'Freddie Mac', dataset: 'Primary Mortgage Market Survey', url: 'https://www.freddiemac.com/pmms', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['Rates are averages for borrowers with strong credit and 20% down; most people are quoted something different.'],
    caveats: ['A lower rate does not always mean cheaper housing; home prices often rise when rates fall.'],
    defaultSeries: ['MORTGAGE30US'],
  }, [
    { id: 'MORTGAGE30US', name: '30-year fixed', points: d.MORTGAGE30US },
    { id: 'MORTGAGE15US', name: '15-year fixed', points: d.MORTGAGE15US },
  ]);
};

builders['gas-price'] = async () => {
  const d = await fred(['GASREGW', 'CPIAUCSL']);
  const base = {
    category: 'Energy', frequency: 'weekly',
    source: { publisher: 'U.S. Energy Information Administration', dataset: 'Weekly Retail Gasoline Prices, Regular, All Formulations', url: 'https://www.eia.gov/petroleum/gasdiesel/', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['National average of regular gasoline prices, including taxes.'],
    reframes: ['gas-price', 'gas-price-real'],
  };
  return [
    ts({ ...base, id: 'gas-price', title: 'U.S. gas price', lens: 'Nominal dollars',
      unit: { label: 'Dollars per gallon', format: 'usd', decimals: 2 },
      description: 'Average retail price of a gallon of regular gasoline in the U.S.',
      caveats: ['Prices are in dollars of each year. A $3 gallon in 2008 cost more in today\'s money than a $3 gallon today.'],
    }, [{ id: 'GASREGW', name: 'Regular gasoline', points: d.GASREGW }]),
    ts({ ...base, id: 'gas-price-real', title: 'U.S. gas price, adjusted for inflation', lens: 'Today\'s dollars',
      unit: { label: `Dollars per gallon (${d.CPIAUCSL.at(-1)[0].slice(0, 7)} dollars)`, format: 'usd', decimals: 2 },
      description: 'Average retail price of regular gasoline, converted into today\'s dollars using CPI-U.',
      caveats: ['Adjusted with the all-items CPI computed by Plainsight; the source publishes nominal prices only.'],
    }, [{ id: 'GASREGW_REAL', name: 'Regular gasoline (inflation-adjusted)', points: deflate(d.GASREGW, d.CPIAUCSL) }]),
  ];
};

builders['home-price'] = async () => {
  const d = await fred(['MSPUS', 'CPIAUCSL']);
  const base = { category: 'Housing', frequency: 'quarterly',
    source: { publisher: 'U.S. Census Bureau and HUD', dataset: 'Median Sales Price of Houses Sold for the United States (MSPUS)', url: 'https://www.census.gov/construction/nrs/', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['This is the median price of newly built single-family homes sold, not all homes.'],
    reframes: ['home-price', 'home-price-real'] };
  return [
    ts({ ...base, id: 'home-price', title: 'Median price of new U.S. homes', lens: 'Nominal dollars',
      unit: { label: 'Median sales price', format: 'usd', decimals: 0 },
      description: 'Median sales price of new houses sold in the United States.',
      caveats: ['Not adjusted for inflation, and the mix of homes being built changes over time (bigger homes push the median up).'] },
      [{ id: 'MSPUS', name: 'Median sales price', points: d.MSPUS }]),
    ts({ ...base, id: 'home-price-real', title: 'Median price of new U.S. homes, adjusted for inflation', lens: 'Today\'s dollars',
      unit: { label: 'Median sales price (today\'s dollars)', format: 'usd', decimals: 0 },
      description: 'Median sales price of new houses converted into today\'s dollars with CPI-U.',
      caveats: ['Inflation adjustment computed by Plainsight using CPI-U.'] },
      [{ id: 'MSPUS_REAL', name: 'Median sales price (inflation-adjusted)', points: deflate(d.MSPUS, d.CPIAUCSL) }]),
  ];
};

builders['federal-debt'] = async () => {
  // Treasury "Debt to the Penny": daily since 1993. Keep the last record of each month.
  let rows = [], page = 1;
  while (true) {
    const j = await get(`https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&sort=record_date&page[size]=10000&page[number]=${page}`);
    rows = rows.concat(j.data);
    if (page >= j.meta['total-pages']) break;
    page++;
  }
  const byMonth = new Map();
  for (const r of rows) byMonth.set(r.record_date.slice(0, 7), [r.record_date, round(parseFloat(r.tot_pub_debt_out_amt) / 1e12, 4)]);
  const nominal = [...byMonth.values()];
  const d = await fred(['GFDEGDQ188S', 'CPIAUCSL']);
  const base = { category: 'Government', reframes: ['federal-debt', 'federal-debt-gdp', 'federal-debt-real'] };
  return [
    ts({ ...base, id: 'federal-debt', title: 'U.S. national debt', lens: 'Nominal dollars', frequency: 'monthly',
      unit: { label: 'Total public debt outstanding', format: 'usdT', decimals: 2 },
      description: 'Total public debt outstanding of the U.S. government, end of each month.',
      source: { publisher: 'U.S. Department of the Treasury', dataset: 'Debt to the Penny', url: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/' },
      howToRead: ['Includes debt held by the public and money the government owes to its own trust funds (like Social Security).'],
      caveats: ['A growing economy and inflation make nominal debt rise almost every year. Debt as a share of GDP is the measure economists use to judge whether it is getting harder to carry.'] },
      [{ id: 'DEBT', name: 'Total public debt', points: nominal }]),
    ts({ ...base, id: 'federal-debt-gdp', title: 'U.S. national debt as a share of GDP', lens: 'Share of the economy', frequency: 'quarterly',
      unit: { label: 'Debt as % of GDP', format: 'pct', decimals: 0 },
      description: 'Total public debt divided by the size of the U.S. economy (gross domestic product).',
      source: { publisher: 'U.S. Office of Management and Budget', dataset: 'Total Public Debt as Percent of GDP (GFDEGDQ188S)', url: fredUrl('GFDEGDQ188S'), via: 'FRED, Federal Reserve Bank of St. Louis' },
      howToRead: ['Above 100% means the debt is larger than one full year of everything the U.S. economy produces.'],
      caveats: ['GDP collapsed briefly in 2020, which spiked the ratio even before new borrowing showed up.'] },
      [{ id: 'GFDEGDQ188S', name: 'Debt as % of GDP', points: d.GFDEGDQ188S }]),
    ts({ ...base, id: 'federal-debt-real', title: 'U.S. national debt, adjusted for inflation', lens: 'Today\'s dollars', frequency: 'monthly',
      unit: { label: 'Total public debt (today\'s dollars)', format: 'usdT', decimals: 2 },
      description: 'Total public debt converted into today\'s dollars with CPI-U.',
      source: { publisher: 'U.S. Department of the Treasury', dataset: 'Debt to the Penny, deflated by BLS CPI-U', url: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/' },
      howToRead: ['Removes the effect of rising prices so years can be compared directly.'],
      caveats: ['Inflation adjustment computed by Plainsight with CPI-U.'] },
      [{ id: 'DEBT_REAL', name: 'Total public debt (inflation-adjusted)', points: deflate(nominal, d.CPIAUCSL) }]),
  ];
};

builders['state-unemployment'] = async () => {
  const d = await fred([...STATES.map(s => s[0] + 'UR'), 'UNRATE']);
  const times = d.CAUR.map(p => p[0]);
  const us = new Map(d.UNRATE.map(p => [p[0], p[1]]));
  const entities = STATES.map(([ab, fips, name]) => {
    const m = new Map(d[ab + 'UR'].map(p => [p[0], p[1]]));
    return { id: fips, code: ab, name, values: times.map(t => m.get(t) ?? null) };
  });
  return panel({ id: 'state-unemployment', title: 'Unemployment rate by state', category: 'Economy', frequency: 'monthly', geo: 'us-states',
    unit: { label: 'Unemployment rate', format: 'pct', decimals: 1 },
    description: 'Seasonally adjusted unemployment rate for each state and D.C.',
    source: { publisher: 'U.S. Bureau of Labor Statistics', dataset: 'Local Area Unemployment Statistics (LAUS)', url: 'https://www.bls.gov/lau/', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['State rates are modeled estimates and are revised every year in March.'],
    caveats: ['Small states have larger margins of error; month-to-month moves of a few tenths of a point are often noise.'],
    isRate: true, national: { name: 'United States', values: times.map(t => us.get(t) ?? null) } }, times, entities);
};

let popCache;
async function statePopulation() {
  if (popCache) return popCache;
  const d = await fred(STATES.map(s => s[0] + 'POP'));
  popCache = d; return d;
}

builders['state-population'] = async () => {
  const d = await statePopulation();
  const times = d.CAPOP.map(p => p[0]);
  const entities = STATES.map(([ab, fips, name]) => {
    const m = new Map(d[ab + 'POP'].map(p => [p[0], p[1] * 1000]));
    return { id: fips, code: ab, name, values: times.map(t => m.get(t) ?? null) };
  });
  return panel({ id: 'state-population', title: 'Population by state', category: 'People', frequency: 'annual', geo: 'us-states',
    unit: { label: 'Resident population', format: 'number', decimals: 0 },
    description: 'Resident population of each state and D.C., annual estimates (decennial counts in census years).',
    source: { publisher: 'U.S. Census Bureau', dataset: 'Annual Resident Population Estimates', url: 'https://www.census.gov/programs-surveys/popest.html', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['Between censuses these are estimates built from births, deaths and migration records.'],
    caveats: ['Estimates are revised after each decennial census, so older numbers may change.'],
    national: { name: 'United States (50 states + DC)', values: times.map((_, i) => entities.reduce((a, e) => a + (e.values[i] ?? 0), 0)) } }, times, entities);
};

builders['overdose-deaths'] = async () => {
  const rows = await get('https://data.cdc.gov/resource/xkb8-kh2a.json?$limit=50000&indicator=Number%20of%20Drug%20Overdose%20Deaths&month=December&$select=state,year,data_value,predicted_value,percent_complete');
  const years = [...new Set(rows.map(r => +r.year))].sort();
  const pop = await statePopulation();
  const times = years.map(y => `${y}-12-31`);
  const counts = [], rates = [];
  for (const [ab, fips, name] of STATES) {
    const m = new Map(rows.filter(r => r.state === ab).map(r => [+r.year, parseFloat(r.data_value)]));
    const pm = new Map(pop[ab + 'POP'].map(p => [+p[0].slice(0, 4), p[1] * 1000]));
    const lastPop = pop[ab + 'POP'].at(-1)[1] * 1000;
    const cv = years.map(y => m.get(y) ?? null);
    counts.push({ id: fips, code: ab, name, values: cv });
    rates.push({ id: fips, code: ab, name, values: years.map((y, i) => cv[i] == null ? null : round(cv[i] / (pm.get(y) ?? lastPop) * 1e5, 1)) });
  }
  const base = { category: 'Health', frequency: 'annual', geo: 'us-states', reframes: ['overdose-deaths', 'overdose-rate'],
    source: { publisher: 'CDC National Center for Health Statistics', dataset: 'VSRR Provisional Drug Overdose Death Counts', url: 'https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm' },
    howToRead: ['Each year is the 12 months ending in December, by the state where the death occurred.'] };
  return [
    panel({ ...base, id: 'overdose-deaths', title: 'Drug overdose deaths by state', lens: 'Total deaths',
      unit: { label: 'Overdose deaths (12 months)', format: 'number', decimals: 0 },
      description: 'Reported drug overdose deaths in each state for the 12 months ending in December.',
      caveats: ['Totals mostly track population size. Compare states using the per-100,000 rate instead.', 'Recent months are provisional and are usually revised upward.'],
      isCount: true }, times, counts),
    panel({ ...base, id: 'overdose-rate', title: 'Drug overdose death rate by state', lens: 'Per 100,000 people',
      unit: { label: 'Deaths per 100,000 residents', format: 'number', decimals: 1 },
      description: 'Reported drug overdose deaths per 100,000 residents, 12 months ending in December.',
      caveats: ['Rate computed by Plainsight using Census population estimates. It is not age-adjusted, unlike CDC\'s official rates.', 'Recent months are provisional and are usually revised upward.'],
      isRate: true }, times, rates),
  ];
};

builders['earthquakes'] = async () => {
  const j = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson');
  const events = j.features.map(f => ({
    t: new Date(f.properties.time).toISOString(), lon: round(f.geometry.coordinates[0], 3), lat: round(f.geometry.coordinates[1], 3),
    value: f.properties.mag, label: f.properties.place,
  })).filter(e => e.value != null).sort((a, b) => a.t.localeCompare(b.t));
  return { id: 'earthquakes', title: 'Earthquakes in the past 30 days', category: 'Environment', kind: 'events', geo: 'world', frequency: 'real-time',
    unit: { label: 'Magnitude', format: 'number', decimals: 1 },
    description: 'Every earthquake of magnitude 2.5 or greater recorded worldwide in the last 30 days.',
    source: { publisher: 'U.S. Geological Survey', dataset: 'Earthquake Hazards Program real-time feed (M2.5+, past 30 days)', url: 'https://earthquake.usgs.gov/earthquakes/feed/' },
    howToRead: ['Magnitude is logarithmic: each whole number up releases about 32 times more energy.'],
    caveats: ['Small quakes are detected far more often near dense sensor networks (like the U.S.), so the map over-represents those regions at low magnitudes.'],
    retrieved: NOW, lastObservation: events.at(-1)?.t, events };
};

async function worldBank(indicator, from = 1960) {
  const [countries, data] = await Promise.all([
    get('https://api.worldbank.org/v2/country?format=json&per_page=400'),
    get(`https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&date=${from}:2030`),
  ]);
  const real = new Map(countries[1].filter(c => c.region.value !== 'Aggregates').map(c => [c.id, c.name]));
  const rows = data[1].filter(r => real.has(r.countryiso3code) && r.value != null);
  const years = [...new Set(rows.map(r => +r.date))].sort((a, b) => a - b);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.countryiso3code)) by.set(r.countryiso3code, new Map());
    by.get(r.countryiso3code).set(+r.date, r.value);
  }
  const entities = [...by.entries()].map(([iso3, m]) => ({
    id: isoCountries.alpha3ToNumeric(iso3) || iso3, code: iso3, name: real.get(iso3),
    values: years.map(y => m.has(y) ? round(m.get(y), 3) : null),
  }));
  // Drop the trailing year if fewer than half the countries have reported yet.
  while (years.length && entities.filter(e => e.values.at(-1) != null).length < entities.length * 0.5) {
    years.pop(); entities.forEach(e => e.values.pop());
  }
  return { times: years.map(y => `${y}-12-31`), entities };
}

builders['world-gdp'] = async () => {
  const { times, entities } = await worldBank('NY.GDP.MKTP.CD');
  return panel({ id: 'world-gdp', title: 'GDP by country', category: 'World', frequency: 'annual', geo: 'world',
    unit: { label: 'Gross domestic product (current US$)', format: 'usdB', decimals: 0 },
    description: 'Total value of goods and services produced in each country, converted to U.S. dollars at market exchange rates.',
    source: { publisher: 'World Bank', dataset: 'World Development Indicators (NY.GDP.MKTP.CD)', url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD' },
    howToRead: ['Values are in each year\'s dollars, so everyone grows over time partly because of inflation.'],
    caveats: ['Market exchange rates understate economies where everyday goods are cheap (China, India). Purchasing-power comparisons tell a different story.', 'GDP measures the size of an economy, not how well off its people are; divide by population for that.'] }, times, entities);
};

builders['life-expectancy'] = async () => {
  const { times, entities } = await worldBank('SP.DYN.LE00.IN');
  return panel({ id: 'life-expectancy', title: 'Life expectancy by country', category: 'World', frequency: 'annual', geo: 'world',
    unit: { label: 'Life expectancy at birth (years)', format: 'number', decimals: 1 },
    description: 'How many years a newborn would live if current death rates stayed the same for their whole life.',
    source: { publisher: 'World Bank', dataset: 'World Development Indicators (SP.DYN.LE00.IN), from UN Population Division', url: 'https://data.worldbank.org/indicator/SP.DYN.LE00.IN' },
    howToRead: ['Low life expectancy in the past was driven mostly by child deaths, not people dying at 40.'],
    caveats: ['It is a snapshot of death rates in a given year, so shocks like COVID-19 dip it temporarily.'], isRate: true }, times, entities);
};


// Generic builder for a FRED series published for every state.
async function fredStatePanel(meta, idFor, nationalId, transform = v => v) {
  const ids = STATES.map(s => idFor(s[0]));
  const d = await fred(nationalId ? [...ids, nationalId] : ids);
  const times = [...new Set(ids.flatMap(id => (d[id] || []).map(p => p[0])))].sort();
  const entities = STATES.map(([ab, fips, name]) => {
    const m = new Map((d[idFor(ab)] || []).map(p => [p[0], transform(p[1])]));
    return { id: fips, code: ab, name, values: times.map(t => m.get(t) ?? null) };
  });
  const out = { ...meta, geo: 'us-states' };
  if (nationalId) { const m = new Map(d[nationalId].map(p => [p[0], transform(p[1])])); out.national = { name: 'United States', values: times.map(t => m.get(t) ?? null) }; }
  return panel(out, times, entities);
}

builders['state-income'] = () => fredStatePanel({
  id: 'state-income', title: 'Median household income by state', category: 'Economy', frequency: 'annual',
  unit: { label: 'Median household income (inflation-adjusted)', format: 'usd', decimals: 0 },
  description: 'Income of the household in the middle of each state\'s distribution, adjusted for inflation by the Census Bureau.',
  source: { publisher: 'U.S. Census Bureau', dataset: 'Current Population Survey, Annual Social and Economic Supplement', url: 'https://www.census.gov/topics/income-poverty/income.html', via: 'FRED, Federal Reserve Bank of St. Louis' },
  howToRead: ['Median means half of households earn more and half earn less, so a few very high earners do not skew it.'],
  caveats: ['State estimates come from a survey sample and have wide margins of error; differences of a few thousand dollars between states are often not meaningful.', 'Not adjusted for cost of living, which varies a lot between states.'],
}, ab => `MEHOINUS${ab}A672N`, 'MEHOINUSA672N');

builders['state-income-pc'] = () => fredStatePanel({
  id: 'state-income-pc', title: 'Personal income per person by state', category: 'Economy', frequency: 'annual',
  unit: { label: 'Per capita personal income', format: 'usd', decimals: 0 },
  description: 'All income received by a state\'s residents (wages, benefits, investment income) divided by its population.',
  source: { publisher: 'U.S. Bureau of Economic Analysis', dataset: 'State Annual Personal Income (SAINC)', url: 'https://www.bea.gov/data/income-saving/personal-income-by-state', via: 'FRED, Federal Reserve Bank of St. Louis' },
  howToRead: ['An average, so high earners pull it up. Median household income better describes a typical family.'],
  caveats: ['In current dollars, not adjusted for inflation or cost of living.'],
}, ab => `${ab}PCPI`, 'A792RC0A052NBEA');

builders['state-hpi'] = () => fredStatePanel({
  id: 'state-hpi', title: 'Home price growth by state', category: 'Housing', frequency: 'quarterly',
  unit: { label: 'House price index (1980 = 100)', format: 'number', decimals: 0 },
  description: 'How much home prices have grown in each state since 1980, from repeat sales of the same houses.',
  source: { publisher: 'Federal Housing Finance Agency', dataset: 'All-Transactions House Price Index', url: 'https://www.fhfa.gov/data/hpi', via: 'FRED, Federal Reserve Bank of St. Louis' },
  howToRead: ['Each state starts at 100 in 1980, so 500 means prices are five times their 1980 level. It compares growth, not price levels: a state at 400 is not more expensive than one at 300.'],
  caveats: ['Not adjusted for inflation.'],
}, ab => `${ab}STHPI`, 'USSTHPI');

builders['state-min-wage'] = () => fredStatePanel({
  id: 'state-min-wage', title: 'Minimum wage by state', category: 'Economy', frequency: 'annual',
  unit: { label: 'State minimum hourly wage', format: 'usd', decimals: 2 },
  description: 'The minimum hourly wage set by each state\'s law.',
  source: { publisher: 'U.S. Department of Labor', dataset: 'State Minimum Wage Rates', url: 'https://www.dol.gov/agencies/whd/minimum-wage/state', via: 'FRED, Federal Reserve Bank of St. Louis' },
  howToRead: ['Where a state\'s minimum is below $7.25 or it has none, the federal minimum of $7.25 applies to most workers.', 'Many cities and counties set higher local minimums.'],
  caveats: ['States with no minimum wage law of their own show as no data.', 'Nominal dollars, not adjusted for inflation.'],
}, ab => `STTMINWG${ab}`, 'FEDMINNFRWG');

builders['state-home-values'] = async () => {
  const text = await get('https://files.zillowstatic.com/research/public_csvs/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv', 'text');
  const rows = parseCSV(text), head = rows[0];
  const dateCols = head.map((h, i) => [h, i]).filter(([h]) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  const byName = new Map(rows.slice(1).map(r => [r[head.indexOf('RegionName')], r]));
  const entities = STATES.map(([ab, fips, name]) => {
    const r = byName.get(name);
    return { id: fips, code: ab, name, values: dateCols.map(([, i]) => (r && r[i] !== '' ? round(parseFloat(r[i]), 0) : null)) };
  });
  return panel({ id: 'state-home-values', title: 'Typical home value by state', category: 'Housing', frequency: 'monthly', geo: 'us-states',
    unit: { label: 'Typical home value (ZHVI)', format: 'usd', decimals: 0 },
    description: 'Zillow\'s estimate of the typical value of homes in each state (the middle third of the market), seasonally adjusted.',
    source: { publisher: 'Zillow Research', dataset: 'Zillow Home Value Index (ZHVI), all homes, mid-tier', url: 'https://www.zillow.com/research/data/' },
    howToRead: ['This is a model estimate of what homes are worth, including homes that did not sell, not a record of sale prices.'],
    caveats: ['Not adjusted for inflation.'] }, dateCols.map(([h]) => h), entities);
};

builders['consumer-sentiment'] = async () => {
  const d = await fred(['UMCSENT']);
  return ts({ id: 'consumer-sentiment', title: 'U.S. consumer sentiment', category: 'Economy', frequency: 'monthly',
    unit: { label: 'Index of Consumer Sentiment (1966 = 100)', format: 'number', decimals: 1 },
    description: 'How Americans feel about their finances and the economy, from a monthly survey.',
    source: { publisher: 'University of Michigan', dataset: 'Surveys of Consumers, Index of Consumer Sentiment', url: 'https://www.sca.isr.umich.edu/', via: 'FRED, Federal Reserve Bank of St. Louis' },
    howToRead: ['Measures feelings, not spending. Sentiment and actual spending often move apart.'],
    caveats: ['Survey of roughly 600-1,000 people a month; moves of 2-3 points can be noise.', 'The survey changed from phone to online interviews in 2024, which may affect comparisons with earlier years.'] },
    [{ id: 'UMCSENT', name: 'Consumer sentiment', points: d.UMCSENT }]);
};

builders['job-postings'] = async () => {
  const text = await get('https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/aggregate_job_postings_US.csv', 'text');
  const rows = parseCSV(text), head = rows[0];
  const iv = head.indexOf('indeed_job_postings_index_SA'), ivar = head.indexOf('variable');
  const pts = rows.slice(1).filter(r => r[ivar] === 'total postings').map(r => [r[0], parseFloat(r[iv])]).filter(p => Number.isFinite(p[1]));
  const weekly = pts.filter((_, i) => i % 7 === 0 || i === pts.length - 1);
  return ts({ id: 'job-postings', title: 'Job postings on Indeed', category: 'Economy', frequency: 'weekly',
    unit: { label: 'Job postings index (Feb 1, 2020 = 100)', format: 'number', decimals: 1 },
    description: 'Daily count of U.S. job postings on Indeed relative to before the pandemic, seasonally adjusted.',
    source: { publisher: 'Indeed Hiring Lab', dataset: 'Job Postings Tracker (aggregate, U.S.)', url: 'https://github.com/hiring-lab/job_postings_tracker' },
    howToRead: ['Above 100 means more postings than just before the pandemic; below 100 means fewer.'],
    caveats: ['Postings on one website, not total U.S. job openings. The official measure is the BLS Job Openings and Labor Turnover Survey (JOLTS).'] },
    [{ id: 'POSTINGS', name: 'Job postings', points: weekly }]);
};

builders['world-co2'] = async () => {
  const text = await get('https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full&useColumnShortNames=true', 'text');
  const rows = parseCSV(text).slice(1).filter(r => /^[A-Z]{3}$/.test(r[1]) && +r[2] >= 1950);
  const years = [...new Set(rows.map(r => +r[2]))].sort((a, b) => a - b);
  const by = new Map();
  for (const [name, code, y, v] of rows) { if (!by.has(code)) by.set(code, { name, m: new Map() }); by.get(code).m.set(+y, parseFloat(v)); }
  const entities = [...by.entries()].map(([code, { name, m }]) => ({ id: isoCountries.alpha3ToNumeric(code) || code, code, name, values: years.map(y => (m.has(y) ? round(m.get(y), 2) : null)) }));
  return panel({ id: 'world-co2', title: 'CO₂ emissions per person by country', category: 'World', frequency: 'annual', geo: 'world',
    unit: { label: 'Tonnes of CO₂ per person', format: 'number', decimals: 1 },
    description: 'Carbon dioxide emitted from fossil fuels and industry in each country, divided by its population.',
    source: { publisher: 'Our World in Data', dataset: 'CO₂ emissions per capita, based on the Global Carbon Budget', url: 'https://ourworldindata.org/co2-emissions' },
    howToRead: ['Counts emissions where goods are produced, not where they are consumed. Countries that import many goods look cleaner than their consumption implies.'],
    caveats: ['Excludes emissions from land-use change such as deforestation.'], isRate: true }, years.map(y => `${y}-12-31`), entities);
};

// ---------- county level ----------
const ABBR = Object.fromEntries(STATES.map(([ab, fips]) => [fips, ab]));
const COUNTY_CAVEAT = 'Connecticut replaced its counties with planning regions in 2022, so it appears as no data on the county map.';

let censusCounties;
async function censusCountyFile() {
  if (censusCounties) return censusCounties;
  // Newest vintage first: the Census Bureau publishes a new one each spring.
  for (let v = new Date().getUTCFullYear(); v >= 2024; v--) {
    try {
      const text = await get(`https://www2.census.gov/programs-surveys/popest/datasets/2020-${v}/counties/totals/co-est${v}-alldata.csv`, 'latin1', 1);
      // The server answers a missing file with HTTP 200 and an HTML error page, so
      // check the content, not just the status.
      if (!text.startsWith('SUMLEV')) continue;
      const rows = parseCSV(text), head = rows[0];
      const recs = rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))).filter(r => r.SUMLEV === '050');
      if (recs.length < 3000 || !head.includes(`POPESTIMATE${v}`)) continue;
      return (censusCounties = { vintage: v, recs });
    } catch { /* try the previous vintage */ }
  }
  throw new Error('No Census county estimates file found');
}

function countyPanel(meta, recs, years, valueOf) {
  const last = Math.max(...Object.keys(recs[0]).filter(k => /^POPESTIMATE\d{4}$/.test(k)).map(k => +k.slice(-4)));
  const entities = recs.map(r => ({ id: r.STATE + r.COUNTY, code: ABBR[r.STATE], name: `${r.CTYNAME}, ${ABBR[r.STATE]}`, short: r.CTYNAME, pop: +r[`POPESTIMATE${last}`],
    values: years.map(y => { const v = valueOf(r, y); return Number.isFinite(v) ? v : null; }) }));
  return panel({ ...meta, geo: 'us-counties' }, years.map(y => `${y}-07-01`), entities);
}

builders['county-population'] = async () => {
  const { vintage, recs } = await censusCountyFile();
  const years = []; for (let y = 2020; y <= vintage; y++) years.push(y);
  const src = { publisher: 'U.S. Census Bureau', dataset: `County Population Totals, Vintage ${vintage}`, url: 'https://www.census.gov/programs-surveys/popest.html' };
  const base = { category: 'People', frequency: 'annual', source: src, reframes: ['county-population', 'county-growth', 'county-migration'] };
  return [
    countyPanel({ ...base, id: 'county-population', title: 'Population by county', lens: 'People',
      unit: { label: 'Resident population (July 1)', format: 'number', decimals: 0 },
      description: 'Estimated number of people living in each county on July 1 of each year.',
      howToRead: ['Annual estimates built from births, deaths and migration since the 2020 Census.'],
      caveats: [COUNTY_CAVEAT], isCount: true }, recs, years, (r, y) => +r[`POPESTIMATE${y}`]),
    countyPanel({ ...base, id: 'county-growth', title: 'Population growth by county since 2020', lens: 'Growth since 2020',
      unit: { label: 'Population change since April 2020', format: 'pct', decimals: 1 },
      description: 'How much each county\'s population has grown or shrunk since the 2020 Census.',
      howToRead: ['Percent change from the April 2020 Census base, so small counties can swing a lot from a few hundred people.'],
      caveats: [COUNTY_CAVEAT, 'Percent change computed by Plainsight from Census estimates.'], isRate: true, zeroLine: true },
      recs, years, (r, y) => round((+r[`POPESTIMATE${y}`] / +r.ESTIMATESBASE2020 - 1) * 100, 2)),
    countyPanel({ ...base, id: 'county-migration', title: 'Where Americans are moving, by county', lens: 'Moves within the U.S.',
      unit: { label: 'Net domestic migration per 1,000 residents', format: 'number', decimals: 1 },
      description: 'People moving into a county from elsewhere in the U.S., minus people moving out, per 1,000 residents.',
      howToRead: ['Positive means more people arrived from other parts of the U.S. than left. Immigration from abroad is counted separately and is not included.'],
      caveats: [COUNTY_CAVEAT, 'The first year (2020) covers only April to July.'], isRate: true, zeroLine: true },
      recs, years.filter(y => y > 2020), (r, y) => round(+r[`RDOMESTICMIG${y}`], 1)),
  ];
};

// CDC PLACES: model-based county estimates for health measures (age-adjusted).
const PLACES = [
  ['OBESITY', 'county-obesity', 'Adult obesity by county', 'Adults with obesity (BMI 30+)'],
  ['DIABETES', 'county-diabetes', 'Diagnosed diabetes by county', 'Adults ever told they have diabetes'],
  ['DEPRESSION', 'county-depression', 'Depression by county', 'Adults ever told they have depression'],
  ['CSMOKING', 'county-smoking', 'Adult smoking by county', 'Adults who currently smoke cigarettes'],
  ['ACCESS2', 'county-uninsured', 'Uninsured adults by county', 'Adults 18-64 without health insurance'],
];
builders['county-health'] = async () => {
  const ids = PLACES.map(p => `'${p[0]}'`).join(',');
  const rows = await get(`https://data.cdc.gov/resource/swc5-untb.json?$select=locationid,locationname,stateabbr,measureid,data_value,year&$where=datavaluetypeid='AgeAdjPrv' AND measureid in(${ids})&$limit=50000`);
  // County names come from the Census file: the CDC feed has encoding damage in some
  // names (e.g. "DoÃ±a Ana").
  let names = new Map(), pops = new Map();
  try {
    const { vintage, recs } = await censusCountyFile();
    names = new Map(recs.map(r => [r.STATE + r.COUNTY, r.CTYNAME]));
    pops = new Map(recs.map(r => [r.STATE + r.COUNTY, +r[`POPESTIMATE${vintage}`]]));
  } catch { }
  return PLACES.map(([mid, id, title, label]) => {
    const rs = rows.filter(r => r.measureid === mid && /^\d{5}$/.test(r.locationid));
    const year = rs.reduce((m, r) => Math.max(m, +r.year), 0);
    const entities = rs.filter(r => +r.year === year).map(r => {
      const short = names.get(r.locationid) || `${r.locationname} County`;
      return { id: r.locationid, code: r.stateabbr, name: `${short}, ${r.stateabbr}`, short, pop: pops.get(r.locationid) ?? null, values: [round(+r.data_value, 1)] };
    });
    return panel({ id, title, category: 'Health', frequency: 'annual', geo: 'us-counties', singleTime: true,
      unit: { label: `${label} (age-adjusted %)`, format: 'pct', decimals: 1 },
      description: `${label}, age-adjusted, as estimated by the CDC for every county.`,
      source: { publisher: 'CDC, Division of Population Health', dataset: 'PLACES: Local Data for Better Health, County Data', url: 'https://www.cdc.gov/places/' },
      howToRead: ['Age-adjusted, so counties with older or younger populations can be compared fairly.'],
      caveats: ['These are model-based estimates from a national survey (BRFSS) combined with Census data, not direct counts for each county. Small differences between neighboring counties are not meaningful.', COUNTY_CAVEAT],
      isRate: true }, [`${year}-12-31`], entities);
  });
};

// Census ACS 5-year county income and poverty. Runs only when a free Census API key
// is available (repo secret CENSUS_API_KEY). Not exercised until the key exists.
builders['county-income'] = async () => {
  const key = process.env.CENSUS_API_KEY;
  if (!key) { console.log('  (skipped county-income: add a CENSUS_API_KEY secret to enable)'); return []; }
  const years = [];
  for (let y = new Date().getUTCFullYear() - 1; y >= 2015 && years.length < 10; y--) {
    try {
      const j = await get(`https://api.census.gov/data/${y}/acs/acs5?get=NAME,B19013_001E,B17001_001E,B17001_002E&for=county:*&key=${key}`, 'json', 1);
      years.unshift({ y, rows: j.slice(1) });
    } catch { /* that year is not released yet */ }
  }
  if (!years.length) throw new Error('Census ACS returned no county data');
  const ids = [...new Set(years.flatMap(({ rows }) => rows.map(r => r[4] + r[5])))];
  const names = new Map(years.at(-1).rows.map(r => [r[4] + r[5], r[0]]));
  const val = (yr, id, f) => { const r = yr.rows.find(x => x[4] + x[5] === id); if (!r) return null; const v = f(r); return Number.isFinite(v) && v >= 0 ? v : null; };
  const src = { publisher: 'U.S. Census Bureau', dataset: 'American Community Survey 5-year estimates', url: 'https://www.census.gov/programs-surveys/acs' };
  const mk = (id, title, unit, f, extra) => panel({ id, title, category: 'Economy', frequency: 'annual', geo: 'us-counties', source: src, unit,
    howToRead: ['Each year is a 5-year average (e.g. 2019-2023), which keeps small-county estimates stable but makes recent changes show up slowly.'],
    caveats: ['Survey estimates with margins of error that can be large for small counties.', COUNTY_CAVEAT], ...extra },
    years.map(({ y }) => `${y}-12-31`),
    ids.map(cid => ({ id: cid, code: ABBR[cid.slice(0, 2)], name: (names.get(cid) || cid).replace(/, ([A-Za-z ]+)$/, (m, st) => `, ${STATES.find(s => s[2] === st)?.[0] || st}`), short: (names.get(cid) || '').split(',')[0], values: years.map(yr => val(yr, cid, f)) })));
  return [
    mk('county-income', 'Median household income by county', { label: 'Median household income', format: 'usd', decimals: 0 }, r => +r[1], { description: 'Income of the household in the middle of each county.', caveats: ['Not adjusted for inflation between years.', COUNTY_CAVEAT] }),
    mk('county-poverty', 'Poverty rate by county', { label: 'People below the poverty line', format: 'pct', decimals: 1 }, r => round(+r[3] / +r[2] * 100, 1), { description: 'Share of people whose family income is below the federal poverty threshold.', isRate: true }),
  ];
};

// ---------- run ----------
await fs.mkdir(OUT, { recursive: true });
const only = process.argv.slice(2);
const catalog = [];
for (const [key, build] of Object.entries(builders)) {
  if (only.length && !only.includes(key)) continue;
  try {
    const t0 = Date.now();
    const result = [].concat(await build());
    for (const ds of result) {
      const n = ds.kind === 'panel' ? ds.entities.filter(e => e.values.some(v => v != null)).length : ds.kind === 'events' ? ds.events.length : ds.series.reduce((a, x) => a + x.points.length, 0);
      if (!n) { console.error(`FAIL ${ds.id}: built with no data (keeping previous snapshot)`); continue; }
      await fs.writeFile(path.join(OUT, ds.id + '.json'), JSON.stringify(ds));
      console.log(`ok   ${ds.id.padEnd(22)} ${ds.kind.padEnd(10)} last=${ds.lastObservation} ${Date.now() - t0}ms`);
    }
  } catch (e) {
    console.error(`FAIL ${key}: ${e.message} (keeping previous snapshot)`); if (process.env.DEBUG) console.error(e.stack);
  }
}
// Rebuild the catalog from whatever snapshots exist on disk.
for (const f of (await fs.readdir(OUT)).filter(f => f.endsWith('.json') && f !== 'catalog.json')) {
  const ds = JSON.parse(await fs.readFile(path.join(OUT, f), 'utf8'));
  const { series, entities, events, times, national, ...meta } = ds;
  const tag = DATASET_TAGS[meta.id] || {};
  const src = [...FEDERAL.map(f => ({ ...f, tier: 'federal' })), ...THIRD_PARTY].find(x => x.id === tag.source);
  catalog.push({ ...meta, hasNational: !!national, topic: tag.topic || 'economy', sourceId: tag.source || null, tier: tag.tier || src?.tier || 'federal', nSeries: series?.length, nEntities: entities?.length, nEvents: events?.length,
    firstObservation: times?.[0] ?? series?.[0]?.points?.[0]?.[0] ?? events?.[0]?.t });
}
catalog.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
await fs.writeFile(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`catalog: ${catalog.length} datasets`);
