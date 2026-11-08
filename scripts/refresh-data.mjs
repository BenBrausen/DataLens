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
    const text = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${chunk.join(',')}`, 'text');
    if (text.startsWith('PK') || !text.startsWith('observation_date')) {
      if (chunk.length === 1) throw new Error(`FRED returned no CSV for ${chunk[0]}`);
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
  const d = await fred(STATES.map(s => s[0] + 'UR'));
  const times = d.CAUR.map(p => p[0]);
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
    isRate: true }, times, entities);
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
    caveats: ['Estimates are revised after each decennial census, so older numbers may change.'] }, times, entities);
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
  const { series, entities, events, times, ...meta } = ds;
  catalog.push({ ...meta, nSeries: series?.length, nEntities: entities?.length, nEvents: events?.length,
    firstObservation: times?.[0] ?? series?.[0]?.points?.[0]?.[0] ?? events?.[0]?.t });
}
catalog.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
await fs.writeFile(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`catalog: ${catalog.length} datasets`);
