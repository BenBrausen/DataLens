// Pulls every curated dataset from its official source, normalizes it into
// Civic Charts's three shapes (timeseries | panel | events), and writes
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
      const r = await fetch(url, { headers: { 'User-Agent': 'civiccharts-data-refresh/1.0' } });
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
      caveats: ['Adjusted with the all-items CPI computed by Civic Charts; the source publishes nominal prices only.'],
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
      caveats: ['Inflation adjustment computed by Civic Charts using CPI-U.'] },
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
      caveats: ['Inflation adjustment computed by Civic Charts with CPI-U.'] },
      [{ id: 'DEBT_REAL', name: 'Total public debt (inflation-adjusted)', points: deflate(nominal, d.CPIAUCSL) }]),
  ];
};

// Deficit, revenue vs. spending, and interest. Fiscal years run Oct 1 to Sep 30 and
// are labeled by the year they end (FY2026 = Oct 2025 to Sep 2026).
builders['federal-deficit'] = async () => {
  const d = await fred(['FYFSD', 'FYFSGDA188S', 'MTSDS133FMS', 'FYFRGDA188S', 'FYONGDA188S', 'A091RC1Q027SBEA', 'FYOIGDA188S', 'CPIAUCSL']);
  const fy = pts => pts.map(([t, v]) => [`${t.slice(0, 4)}-09-30`, v]); // label each fiscal year by its end date
  const annual = fy(d.FYFSD).map(([t, v]) => [t, round(v / 1e6, 4)]); // millions -> trillions
  // Rolling 12-month deficit from the Monthly Treasury Statement: current every month,
  // not just once a year, and free of the month-to-month swings around tax dates.
  const m = d.MTSDS133FMS, roll = [];
  for (let i = 11; i < m.length; i++) roll.push([m[i][0], round(m.slice(i - 11, i + 1).reduce((a, x) => a + x[1], 0) / 1e6, 4)]);
  // Cross-check: the 12 months ending September must equal the fiscal-year total.
  const lastFy = annual.at(-1), sep = roll.find(r => r[0] === `${lastFy[0].slice(0, 4)}-09-01`);
  if (sep && Math.abs(sep[1] - lastFy[1]) > 0.02) console.warn(`  (deficit cross-check: MTS ${sep[1]}T vs OMB ${lastFy[1]}T)`);
  const fiscalSrc = { publisher: 'U.S. Office of Management and Budget', via: 'FRED, Federal Reserve Bank of St. Louis' };
  const base = { category: 'Government', reframes: ['federal-deficit', 'federal-deficit-gdp', 'federal-deficit-12mo'], zeroLine: true };
  const signHow = 'Below zero is a deficit (the government spent more than it collected); above zero is a surplus.';
  const fyHow = 'Fiscal years run October through September and are named for the year they end: FY2026 is Oct 2025 to Sep 2026.';
  const debtLink = 'The deficit is one year of borrowing; the national debt is the running total of past deficits (plus other borrowing).';
  return [
    ts({ ...base, id: 'federal-deficit', title: 'U.S. federal budget deficit', lens: 'Nominal dollars', frequency: 'fiscal',
      unit: { label: 'Surplus or deficit (-), fiscal year', format: 'usdT', decimals: 2, signWords: { neg: 'deficit', pos: 'surplus', subject: 'The federal government' } },
      description: 'Federal surplus or deficit for each fiscal year: total receipts minus total outlays.',
      source: { ...fiscalSrc, dataset: 'Federal Surplus or Deficit (FYFSD)', url: fredUrl('FYFSD') },
      howToRead: [signHow, fyHow, debtLink],
      caveats: ['In dollars of each year, so recent deficits look larger partly because prices and the economy are bigger. The share-of-GDP view corrects for that.'],
      defaultChart: 'columns' },
      [{ id: 'FYFSD', name: 'Surplus or deficit', points: annual }]),
    ts({ ...base, id: 'federal-deficit-gdp', title: 'U.S. federal budget deficit as a share of GDP', lens: 'Share of the economy', frequency: 'fiscal',
      unit: { label: 'Surplus or deficit (-) as % of GDP', format: 'pct', decimals: 1, signWords: { neg: 'deficit', pos: 'surplus', subject: 'The federal government', of: ' of GDP' } },
      description: 'Federal surplus or deficit divided by the size of the economy, by fiscal year.',
      source: { ...fiscalSrc, dataset: 'Federal Surplus or Deficit as Percent of GDP (FYFSGDA188S)', url: fredUrl('FYFSGDA188S') },
      howToRead: [signHow, fyHow, 'This is how economists compare deficits across decades: a $1 trillion deficit means far less in a $30 trillion economy than in a $10 trillion one.'],
      caveats: ['Updated once a year, after the fiscal year closes and GDP for it is estimated, so it lags the dollar figures.'],
      defaultChart: 'columns' },
      [{ id: 'FYFSGDA188S', name: 'Surplus or deficit, % of GDP', points: fy(d.FYFSGDA188S) }]),
    ts({ ...base, id: 'federal-deficit-12mo', title: 'U.S. federal budget deficit, last 12 months', lens: 'Rolling 12 months', frequency: 'monthly',
      unit: { label: 'Surplus or deficit (-), trailing 12 months', format: 'usdT', decimals: 2, signWords: { neg: 'deficit', pos: 'surplus', subject: 'The federal government', trailing: true } },
      description: 'Federal surplus or deficit over the 12 months ending each month, from the Monthly Treasury Statement.',
      source: { publisher: 'U.S. Department of the Treasury', dataset: 'Monthly Treasury Statement, Federal Surplus or Deficit (MTSDS133FMS), 12-month sum computed by Civic Charts', url: 'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/', via: 'FRED, Federal Reserve Bank of St. Louis' },
      howToRead: [signHow, 'Each point adds up the latest 12 months, so it updates monthly without the big swings single months show around tax deadlines.', debtLink],
      caveats: ['Shifts in payment timing (when a due date falls on a weekend) can move a month between fiscal years and nudge the 12-month total.'] },
      [{ id: 'MTS12', name: 'Surplus or deficit, last 12 months', points: roll }]),
    ts({ id: 'federal-budget-gdp', title: 'Federal revenue vs. spending', category: 'Government', frequency: 'fiscal',
      unit: { label: '% of GDP, fiscal year', format: 'pct', decimals: 1 },
      description: 'Total federal receipts and total federal outlays, each as a share of GDP. The gap between them is the deficit.',
      source: { ...fiscalSrc, dataset: 'Federal Receipts (FYFRGDA188S) and Outlays (FYONGDA188S) as Percent of GDP', url: fredUrl('FYONGDA188S') },
      howToRead: ['When the spending line is above the revenue line, the government ran a deficit that year; the distance between them is its size.', fyHow],
      caveats: ['Revenue falls and spending rises automatically in recessions (lower tax receipts, more unemployment benefits), so gaps widen in downturns regardless of policy.'],
      defaultSeries: ['FYONGDA188S', 'FYFRGDA188S'],
      gap: { a: 'FYONGDA188S', b: 'FYFRGDA188S', aName: 'federal spending', bName: 'revenue', of: ' of GDP', posWord: 'deficit', negWord: 'surplus' } },
      [{ id: 'FYONGDA188S', name: 'Spending (outlays)', points: fy(d.FYONGDA188S) }, { id: 'FYFRGDA188S', name: 'Revenue (receipts)', points: fy(d.FYFRGDA188S) }]),
    ts({ id: 'federal-interest', title: 'Interest on the national debt', category: 'Government', lens: 'Nominal dollars', frequency: 'quarterly', reframes: ['federal-interest', 'federal-interest-gdp'],
      unit: { label: 'Federal interest payments, annual rate', format: 'usdT', decimals: 2 },
      description: 'What the federal government pays in interest on its debt, at a seasonally adjusted annual rate.',
      source: { publisher: 'U.S. Bureau of Economic Analysis', dataset: 'Federal government current expenditures: Interest payments (A091RC1Q027SBEA)', url: fredUrl('A091RC1Q027SBEA'), via: 'FRED, Federal Reserve Bank of St. Louis' },
      howToRead: ['Quarterly figures are expressed as a yearly pace, so each point is roughly what a full year would cost at that rate.', 'Interest grows when the debt grows and when the rates the Treasury pays on new borrowing rise.'],
      caveats: ['National-accounts measure from BEA; Treasury budget figures for net interest differ somewhat in definition and timing.', 'In dollars of each year; the share-of-GDP view adjusts for the size of the economy.'] },
      [{ id: 'A091RC1Q027SBEA', name: 'Interest payments', points: d.A091RC1Q027SBEA.map(([t, v]) => [t, round(v / 1000, 4)]) }]),
    ts({ id: 'federal-interest-gdp', title: 'Interest on the national debt as a share of GDP', category: 'Government', lens: 'Share of the economy', frequency: 'fiscal', reframes: ['federal-interest', 'federal-interest-gdp'],
      unit: { label: 'Net interest outlays as % of GDP', format: 'pct', decimals: 1 },
      description: 'Federal net interest outlays divided by GDP, by fiscal year.',
      source: { ...fiscalSrc, dataset: 'Federal Outlays: Interest as Percent of GDP (FYOIGDA188S)', url: fredUrl('FYOIGDA188S') },
      howToRead: ['Shows how much of the economy goes to paying interest on federal debt.', fyHow],
      caveats: ['Updated once a year, after the fiscal year closes.'] },
      [{ id: 'FYOIGDA188S', name: 'Net interest, % of GDP', points: fy(d.FYOIGDA188S) }]),
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
      caveats: ['Rate computed by Civic Charts using Census population estimates. It is not age-adjusted, unlike CDC\'s official rates.', 'Recent months are provisional and are usually revised upward.'],
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
      caveats: [COUNTY_CAVEAT, 'Percent change computed by Civic Charts from Census estimates.'], isRate: true, zeroLine: true },
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

// ---------- FEMA ----------
async function femaDeclarations() {
  const rows = [];
  for (let skip = 0; ; skip += 10000) {
    const j = await get(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$select=disasterNumber,declarationType,declarationDate,incidentType,fipsStateCode,fipsCountyCode&$top=10000&$skip=${skip}`);
    rows.push(...j.DisasterDeclarationsSummaries);
    if (j.DisasterDeclarationsSummaries.length < 10000) break;
  }
  return rows;
}
builders['disasters'] = async () => {
  const rows = await femaDeclarations();
  const lastFull = new Date().getUTCFullYear() - 1;
  // Major disaster declarations (DR); COVID-19 (Biological, 2020) is excluded and disclosed.
  const dr = rows.filter(r => r.declarationType === 'DR' && r.incidentType !== 'Biological');
  const byYearType = new Map();
  for (const r of dr) {
    const y = +r.declarationDate.slice(0, 4); if (y > lastFull) continue;
    const k = `${y}|${r.incidentType}`; if (!byYearType.has(k)) byYearType.set(k, new Set()); byYearType.get(k).add(r.disasterNumber);
  }
  const years = []; for (let y = 1953; y <= lastFull; y++) years.push(y);
  const typeTotals = new Map();
  for (const [k, s] of byYearType) { const t = k.split('|')[1]; typeTotals.set(t, (typeTotals.get(t) || 0) + s.size); }
  const top = [...typeTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
  const count = (y, t) => [...byYearType.entries()].filter(([k]) => k.startsWith(y + '|') && (!t || k.endsWith('|' + t))).reduce((a, [, s]) => a + s.size, 0);
  const series = [{ id: 'ALL', name: 'All major disasters', points: years.map(y => [`${y}-12-31`, count(y)]) },
    ...top.map(t => ({ id: t.replace(/\W+/g, '_'), name: t, points: years.map(y => [`${y}-12-31`, count(y, t)]) }))];
  // Cumulative county designations
  const byCounty = new Map();
  for (const r of dr) {
    if (!r.fipsCountyCode || r.fipsCountyCode === '000') continue;
    const id = r.fipsStateCode + r.fipsCountyCode, y = +r.declarationDate.slice(0, 4);
    if (y > lastFull) continue;
    if (!byCounty.has(id)) byCounty.set(id, new Map());
    const m = byCounty.get(id); if (!m.has(y)) m.set(y, new Set()); m.get(y).add(r.disasterNumber);
  }
  let names = new Map(), pops = new Map();
  try { const { vintage, recs } = await censusCountyFile(); names = new Map(recs.map(r => [r.STATE + r.COUNTY, [r.CTYNAME, ABBR[r.STATE]]])); pops = new Map(recs.map(r => [r.STATE + r.COUNTY, +r[`POPESTIMATE${vintage}`]])); } catch { }
  const cyears = years.filter(y => y >= 1965);
  const entities = [...byCounty.entries()].filter(([id]) => names.has(id)).map(([id, m]) => {
    let acc = 0; for (const [y, s] of m) if (y < cyears[0]) acc += s.size;
    const [nm, ab] = names.get(id);
    return { id, code: ab, name: `${nm}, ${ab}`, short: nm, pop: pops.get(id), values: cyears.map(y => (acc += m.get(y)?.size || 0)) };
  });
  const src = { publisher: 'Federal Emergency Management Agency', dataset: 'OpenFEMA Disaster Declarations Summaries (v2)', url: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2' };
  const care = ['A declaration is a federal funding decision, not a direct measure of how severe a disaster was. Thresholds and politics change over time.', 'COVID-19 declarations (2020) are left out because they covered every state at once.'];
  return [
    ts({ id: 'disasters', title: 'Major disaster declarations per year', category: 'Environment', frequency: 'annual',
      unit: { label: 'Major disaster declarations', format: 'number', decimals: 0 }, source: src,
      description: 'Number of major disaster declarations the President approved each year, by type of disaster.',
      howToRead: ['Each declaration unlocks federal aid for a state or tribe after a disaster that overwhelms local resources.'],
      caveats: care, defaultSeries: ['ALL'] }, series.map(s => ({ ...s, points: s.points }))),
    panel({ id: 'county-disasters', title: 'Federal disaster declarations by county since 1965', category: 'Environment', frequency: 'annual', geo: 'us-counties',
      unit: { label: 'Major disaster declarations (running total since 1965)', format: 'number', decimals: 0 }, source: src,
      description: 'How many major disaster declarations have covered each county, adding up year by year.',
      howToRead: ['Watch it fill in: the coasts, Tornado Alley and river valleys light up first.'],
      caveats: [...care, 'Statewide declarations without county detail are not counted.', COUNTY_CAVEAT] }, cyears.map(y => `${y}-12-31`), entities),
  ];
};

builders['hazard-risk'] = async () => {
  const fields = ['STCOFIPS', 'COUNTY', 'COUNTYTYPE', 'STATEABBRV', 'POPULATION', 'RISK_SCORE', 'WFIR_RISKS', 'HRCN_RISKS', 'HWAV_RISKS', 'IFLD_RISKS', 'SOVI_SCORE'];
  const rows = [];
  for (let off = 0; ; off += 2000) {
    const j = await get(`https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query?where=1%3D1&outFields=${fields.join(',')}&returnGeometry=false&orderByFields=STCOFIPS&resultOffset=${off}&resultRecordCount=2000&f=json`);
    if (j.error) throw new Error(j.error.message);
    rows.push(...j.features.map(f => f.attributes));
    if (!j.exceededTransferLimit && j.features.length < 2000) break;
  }
  const y = new Date().getUTCFullYear();
  const src = { publisher: 'Federal Emergency Management Agency', dataset: 'National Risk Index for Natural Hazards (counties)', url: 'https://hazards.fema.gov/nri/' };
  const mk = (id, field, title, label, extra = {}) => panel({ id, title, category: 'Environment', frequency: 'annual', geo: 'us-counties', singleTime: true, source: src,
    unit: { label, format: 'number', decimals: 1 }, reframes: ['county-risk', 'county-wildfire-risk', 'county-hurricane-risk', 'county-heat-risk', 'county-flood-risk'],
    howToRead: ['Scores run from 0 to 100 and rank each county against all others: 90 means riskier than 90% of U.S. counties. It is not a probability.', 'Risk combines how often a hazard strikes, what is in harm\'s way, how vulnerable people are and how well communities can recover.'],
    caveats: ['A model built by FEMA from historical hazard data; it is updated every year or two.', COUNTY_CAVEAT], isRate: true, ...extra },
    [`${y}-01-01`], rows.filter(r => r[field] != null && /^\d{5}$/.test(r.STCOFIPS)).map(r => ({ id: r.STCOFIPS, code: r.STATEABBRV, name: `${r.COUNTY} ${r.COUNTYTYPE || ''}`.trim() + `, ${r.STATEABBRV}`, short: `${r.COUNTY} ${r.COUNTYTYPE || ''}`.trim(), pop: r.POPULATION, values: [round(r[field], 1)] })));
  return [
    mk('county-risk', 'RISK_SCORE', 'Natural hazard risk by county', 'Overall risk score (0-100)', { lens: 'All hazards' }),
    mk('county-wildfire-risk', 'WFIR_RISKS', 'Wildfire risk by county', 'Wildfire risk score (0-100)', { lens: 'Wildfire' }),
    mk('county-hurricane-risk', 'HRCN_RISKS', 'Hurricane risk by county', 'Hurricane risk score (0-100)', { lens: 'Hurricane' }),
    mk('county-heat-risk', 'HWAV_RISKS', 'Heat wave risk by county', 'Heat wave risk score (0-100)', { lens: 'Heat wave' }),
    mk('county-flood-risk', 'IFLD_RISKS', 'Inland flooding risk by county', 'Inland flooding risk score (0-100)', { lens: 'Inland flooding' }),
  ];
};

// ---------- Census, no key needed ----------
builders['county-vitals'] = async () => {
  const { vintage, recs } = await censusCountyFile();
  const years = []; for (let y = 2021; y <= vintage; y++) years.push(y);
  const src = { publisher: 'U.S. Census Bureau', dataset: `County Population Totals and Components of Change, Vintage ${vintage}`, url: 'https://www.census.gov/programs-surveys/popest.html' };
  const base = { category: 'People', frequency: 'annual', source: src, reframes: ['county-population', 'county-growth', 'county-migration', 'county-natural-change', 'county-immigration'], isRate: true, zeroLine: true };
  return [
    countyPanel({ ...base, id: 'county-natural-change', title: 'Births minus deaths by county', lens: 'Births minus deaths',
      unit: { label: 'Births minus deaths per 1,000 residents', format: 'number', decimals: 1 },
      description: 'Natural change: births minus deaths each year, per 1,000 residents. Below zero means deaths outnumbered births.',
      howToRead: ['Older counties, especially rural ones, often have more deaths than births even before anyone moves away.'], caveats: [COUNTY_CAVEAT] },
      recs, years, (r, y) => round(+r[`RNATURALCHG${y}`], 1)),
    countyPanel({ ...base, id: 'county-immigration', title: 'Immigration by county', lens: 'Moves from abroad',
      unit: { label: 'Net international migration per 1,000 residents', format: 'number', decimals: 1 },
      description: 'People arriving from abroad minus people leaving the U.S., per 1,000 residents.',
      howToRead: ['Includes immigrants of all legal statuses, people moving to and from Puerto Rico, and Americans returning from abroad.'],
      caveats: ['International migration is the hardest population component to estimate and is revised often.', COUNTY_CAVEAT] },
      recs, years, (r, y) => round(+r[`RINTERNATIONALMIG${y}`], 1)),
  ];
};

builders['county-age'] = async () => {
  for (let v = new Date().getUTCFullYear(); v >= 2024; v--) {
    let text;
    try { text = await get(`https://www2.census.gov/programs-surveys/popest/datasets/2020-${v}/counties/asrh/cc-est${v}-agesex-all.csv`, 'latin1', 1); } catch { continue; }
    if (!text.startsWith('SUMLEV')) continue;
    const rows = parseCSV(text), h = rows[0], ix = k => h.indexOf(k);
    // YEAR 1 is the April 2020 base; 2 onward are July 1 estimates starting 2020.
    const recs = rows.slice(1).filter(r => +r[ix('YEAR')] >= 2);
    const years = [...new Set(recs.map(r => 2018 + +r[ix('YEAR')]))].sort();
    const by = new Map();
    for (const r of recs) { const id = r[ix('STATE')] + r[ix('COUNTY')]; if (!by.has(id)) by.set(id, { r, ys: new Map() }); by.get(id).ys.set(2018 + +r[ix('YEAR')], r); }
    const ent = f => [...by.entries()].map(([id, { r, ys }]) => ({ id, code: ABBR[r[ix('STATE')]], name: `${r[ix('CTYNAME')]}, ${ABBR[r[ix('STATE')]]}`, short: r[ix('CTYNAME')], pop: +ys.get(years.at(-1))?.[ix('POPESTIMATE')], values: years.map(y => { const x = ys.get(y); return x ? f(x) : null; }) }));
    const src = { publisher: 'U.S. Census Bureau', dataset: `County Population by Characteristics (age and sex), Vintage ${v}`, url: 'https://www.census.gov/programs-surveys/popest.html' };
    const base = { category: 'People', frequency: 'annual', geo: 'us-counties', source: src, reframes: ['county-median-age', 'county-65plus'], caveats: [COUNTY_CAVEAT] };
    return [
      panel({ ...base, id: 'county-median-age', title: 'Median age by county', lens: 'Median age', unit: { label: 'Median age (years)', format: 'number', decimals: 1 },
        description: 'Half the people in each county are older than this, half younger.', howToRead: ['College towns and military bases are young; retirement areas and rural counties that young people have left are old.'], isRate: true },
        years.map(y => `${y}-07-01`), ent(x => +x[ix('MEDIAN_AGE_TOT')])),
      panel({ ...base, id: 'county-65plus', title: 'Share of people 65 and older by county', lens: 'Share 65+', unit: { label: 'Residents 65 and older', format: 'pct', decimals: 1 },
        description: 'Percent of each county\'s residents who are 65 or older.', howToRead: ['The baby boom generation turning 65 is raising this share almost everywhere.'], isRate: true },
        years.map(y => `${y}-07-01`), ent(x => round(+x[ix('AGE65PLUS_TOT')] / +x[ix('POPESTIMATE')] * 100, 1))),
    ];
  }
  throw new Error('No county age file found');
};

// Small Area Income and Poverty Estimates: single-year county poverty and income, no key.
builders['county-saipe'] = async () => {
  const years = [], data = new Map();
  for (let y = 2005; y <= new Date().getUTCFullYear(); y++) {
    const yy = String(y % 100).padStart(2, '0');
    let text;
    try { text = await get(`https://www2.census.gov/programs-surveys/saipe/datasets/${y}/${y}-state-and-county/est${yy}all.txt`, 'latin1', 1); } catch { continue; }
    if (!/^\d{2}\s+0\s/.test(text)) continue;
    years.push(y);
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t.length < 23 || t[1] === '0') continue;
      const id = t[0].padStart(2, '0') + t[1].padStart(3, '0');
      if (!data.has(id)) data.set(id, new Map());
      const num = v => (v === '.' || v == null ? null : +v);
      data.get(id).set(y, { pov: num(t[5]), lo: num(t[6]), hi: num(t[7]), inc: num(t[20]) });
    }
  }
  if (!years.length) throw new Error('No SAIPE files found');
  let names = new Map(), pops = new Map();
  try { const { vintage, recs } = await censusCountyFile(); names = new Map(recs.map(r => [r.STATE + r.COUNTY, [r.CTYNAME, ABBR[r.STATE]]])); pops = new Map(recs.map(r => [r.STATE + r.COUNTY, +r[`POPESTIMATE${vintage}`]])); } catch { }
  const ent = f => [...data.entries()].filter(([id]) => names.has(id)).map(([id, m]) => { const [nm, ab] = names.get(id); return { id, code: ab, name: `${nm}, ${ab}`, short: nm, pop: pops.get(id), values: years.map(y => { const x = m.get(y); return x ? f(x) : null; }) }; });
  const src = { publisher: 'U.S. Census Bureau', dataset: 'Small Area Income and Poverty Estimates (SAIPE)', url: 'https://www.census.gov/programs-surveys/saipe.html' };
  const base = { category: 'Economy', frequency: 'annual', geo: 'us-counties', source: src, reframes: ['county-poverty', 'county-income'],
    howToRead: ['Model-based single-year estimates that combine survey data with tax and program records, so even small counties get a yearly number.'] };
  return [
    panel({ ...base, id: 'county-poverty', title: 'Poverty rate by county', lens: 'Poverty rate', unit: { label: 'People below the poverty line', format: 'pct', decimals: 1 },
      description: 'Share of people whose family income is below the federal poverty threshold.', isRate: true,
      caveats: ['Each county estimate has a margin of error; for small counties the 90% range is often several points wide, so close rankings are not meaningful.', COUNTY_CAVEAT] },
      years.map(y => `${y}-12-31`), ent(x => x.pov)),
    panel({ ...base, id: 'county-income', title: 'Median household income by county', lens: 'Median income', unit: { label: 'Median household income', format: 'usd', decimals: 0 },
      description: 'Income of the household in the middle of each county.', isRate: true,
      caveats: ['Not adjusted for inflation between years, or for local cost of living.', COUNTY_CAVEAT] },
      years.map(y => `${y}-12-31`), ent(x => x.inc)),
  ];
};

builders['state-permits'] = async () => {
  const pop = await statePopulation();
  const byYear = new Map();
  for (let y = 1980; y <= new Date().getUTCFullYear(); y++) {
    let text; try { text = await get(`https://www2.census.gov/econ/bps/State/st${y}a.txt`, 'latin1', 1); } catch { continue; }
    const rows = parseCSV(text).slice(2).filter(r => /^\d{4}/.test((r[0] || '').trim()) && /^\d{2}$/.test((r[1] || '').trim()));
    if (rows.length < 50) continue;
    byYear.set(y, new Map(rows.map(r => [r[1].trim(), [6, 9, 12, 15].reduce((a, i) => a + (+r[i] || 0), 0)])));
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const popAt = (ab, y) => { const s = pop[ab + 'POP']; const m = s.find(p => +p[0].slice(0, 4) === y) || s.at(-1); return m[1] * 1000; };
  const units = STATES.map(([ab, fips, name]) => ({ id: fips, code: ab, name, values: years.map(y => byYear.get(y).get(fips) ?? null) }));
  const rate = units.map(e => ({ ...e, values: e.values.map((v, i) => (v == null ? null : round(v / popAt(e.code, years[i]) * 1000, 2))) }));
  const usUnits = years.map((_, i) => units.reduce((a, e) => a + (e.values[i] || 0), 0));
  const usPop = years.map(y => STATES.reduce((a, [ab]) => a + popAt(ab, y), 0));
  const src = { publisher: 'U.S. Census Bureau', dataset: 'Building Permits Survey, annual state totals', url: 'https://www.census.gov/construction/bps/' };
  const base = { category: 'Housing', frequency: 'annual', geo: 'us-states', source: src, reframes: ['state-permits', 'state-permits-total'],
    howToRead: ['Permits are the earliest sign of new housing: most permitted homes are started within a few months.'], caveats: ['Counts new privately owned units in permit-issuing places, which cover nearly all construction. The latest year can be revised.'] };
  const times = years.map(y => `${y}-12-31`);
  return [
    panel({ ...base, id: 'state-permits', title: 'New homes permitted per 1,000 residents', lens: 'Per 1,000 residents', unit: { label: 'Housing units permitted per 1,000 residents', format: 'number', decimals: 1 },
      description: 'New housing units authorized by building permits each year, per 1,000 residents.', isRate: true,
      national: { name: 'United States', values: usUnits.map((u, i) => round(u / usPop[i] * 1000, 2)) } }, times, rate),
    panel({ ...base, id: 'state-permits-total', title: 'New homes permitted by state', lens: 'Total units', unit: { label: 'Housing units permitted', format: 'number', decimals: 0 },
      description: 'New housing units authorized by building permits each year.', isCount: true }, times, units),
  ];
};

builders['business-applications'] = async () => {
  const text = await get('https://www.census.gov/econ/bfs/csv/bfs_monthly.csv', 'text');
  const rows = parseCSV(text), h = rows[0];
  const M = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map(m => h.indexOf(m));
  const pick = rows.slice(1).filter(r => r[0] === 'A' && r[1] === 'TOTAL' && r[2] === 'BA_BA');
  const series = new Map();
  for (const r of pick) for (let m = 0; m < 12; m++) { const v = parseFloat(r[M[m]]); if (!Number.isFinite(v)) continue; if (!series.has(r[3])) series.set(r[3], new Map()); series.get(r[3]).set(`${r[4]}-${String(m + 1).padStart(2, '0')}-01`, v); }
  const times = [...new Set([...series.values()].flatMap(m => [...m.keys()]))].sort();
  const pop = await statePopulation();
  const popAt = (ab, t) => { const s = pop[ab + 'POP']; const y = +t.slice(0, 4); const m = s.find(p => +p[0].slice(0, 4) === y) || s.at(-1); return m[1] * 1000; };
  const entities = STATES.filter(([ab]) => series.has(ab)).map(([ab, fips, name]) => ({ id: fips, code: ab, name, values: times.map(t => { const v = series.get(ab).get(t); return v == null ? null : round(v / popAt(ab, t) * 1e5, 1); }) }));
  const usPop = t => STATES.reduce((a, [ab]) => a + popAt(ab, t), 0);
  return panel({ id: 'business-applications', title: 'New business applications by state', category: 'Economy', frequency: 'monthly', geo: 'us-states',
    unit: { label: 'Business applications per 100,000 residents (monthly)', format: 'number', decimals: 1 },
    description: 'Applications for a new employer ID number (EIN) each month, a leading sign of new businesses, per 100,000 residents.',
    source: { publisher: 'U.S. Census Bureau', dataset: 'Business Formation Statistics (seasonally adjusted)', url: 'https://www.census.gov/econ/bfs/' },
    howToRead: ['An application is an intention to start a business; only some become employers. Applications jumped in mid-2020 and stayed high.'],
    caveats: ['Per-person rate computed by Civic Charts with Census population estimates.'], isRate: true,
    national: { name: 'United States', values: times.map(t => { const v = series.get('US')?.get(t); return v == null ? null : round(v / usPop(t) * 1e5, 1); }) } }, times, entities);
};

// ---------- NASA ----------
builders['global-temperature'] = async () => {
  const text = await get('https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv', 'text');
  const rows = parseCSV(text.slice(text.indexOf('Year,'))), h = rows[0];
  const monthly = [], annual = [];
  for (const r of rows.slice(1)) {
    const y = +r[0]; if (!y) continue;
    for (let m = 1; m <= 12; m++) { const v = parseFloat(r[m]); if (Number.isFinite(v)) monthly.push([`${y}-${String(m).padStart(2, '0')}-15`, v]); }
    const a = parseFloat(r[h.indexOf('J-D')]); if (Number.isFinite(a)) annual.push([`${y}-07-01`, a]);
  }
  return ts({ id: 'global-temperature', title: 'Global temperature', category: 'Environment', frequency: 'annual',
    unit: { label: '°C above or below the 1951-1980 average', format: 'number', decimals: 2, suffix: '°C', signed: true },
    description: 'Global average surface temperature over land and ocean compared with the 1951-1980 average.',
    source: { publisher: 'NASA Goddard Institute for Space Studies', dataset: 'GISTEMP v4, Land-Ocean Temperature Index', url: 'https://data.giss.nasa.gov/gistemp/' },
    howToRead: ['Zero is the 1951-1980 average, not "normal" in any deeper sense. The change over time is what matters.', 'Single months are noisy (El Niño years run hot); the annual average shows the trend.'],
    caveats: ['Recent months are revised slightly as late station reports arrive.'], zeroLine: true, defaultSeries: ['ANNUAL'] },
    [{ id: 'ANNUAL', name: 'Annual average', points: annual }]);
};

// ---------- EPA ----------
builders['county-air'] = async () => {
  const { unzipSync, strFromU8 } = await import('fflate');
  // County names in EPA files -> FIPS via the Census county list.
  const { recs } = await censusCountyFile();
  const norm = s => String(s).toLowerCase().replace(/\./g, '').replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/, '').replace(/^saint /, 'st ').trim();
  const look = new Map(recs.map(r => [`${r.STNAME.toLowerCase()}|${norm(r.CTYNAME)}`, r.STATE + r.COUNTY]));
  const lastFull = new Date().getUTCFullYear() - 1;
  const years = [], vals = new Map();
  for (let y = 2000; y <= lastFull; y++) {
    let buf; try { const r = await fetch(`https://aqs.epa.gov/aqsweb/airdata/annual_aqi_by_county_${y}.zip`); if (!r.ok) continue; buf = new Uint8Array(await r.arrayBuffer()); } catch { continue; }
    const files = unzipSync(buf); const name = Object.keys(files).find(n => n.endsWith('.csv')); if (!name) continue;
    const rows = parseCSV(strFromU8(files[name])), h = rows[0], ix = k => h.indexOf(k);
    years.push(y);
    for (const r of rows.slice(1)) {
      const id = look.get(`${r[ix('State')].toLowerCase()}|${norm(r[ix('County')])}`); if (!id) continue;
      const days = +r[ix('Days with AQI')]; if (days < 120) continue; // too few monitored days to compare
      const bad = ['Unhealthy for Sensitive Groups Days', 'Unhealthy Days', 'Very Unhealthy Days', 'Hazardous Days'].reduce((a, k) => a + (+r[ix(k)] || 0), 0);
      if (!vals.has(id)) vals.set(id, new Map()); vals.get(id).set(y, bad);
    }
  }
  const byId = new Map(recs.map(r => [r.STATE + r.COUNTY, r]));
  const entities = [...vals.entries()].map(([id, m]) => { const r = byId.get(id); return { id, code: ABBR[r.STATE], name: `${r.CTYNAME}, ${ABBR[r.STATE]}`, short: r.CTYNAME, values: years.map(y => m.get(y) ?? null) }; });
  return panel({ id: 'county-air', title: 'Days with unhealthy air by county', category: 'Environment', frequency: 'annual', geo: 'us-counties',
    unit: { label: 'Days with unhealthy air (AQI over 100)', format: 'number', decimals: 0 },
    description: 'Days each year when the Air Quality Index was unhealthy for sensitive groups or worse.',
    source: { publisher: 'U.S. Environmental Protection Agency', dataset: 'Air Quality System, annual AQI by county', url: 'https://aqs.epa.gov/aqsweb/airdata/download_files.html' },
    howToRead: ['Above 100 on the Air Quality Index, children, older adults and people with heart or lung disease should limit time outdoors.', 'Wildfire smoke drives many of the worst recent years in the West.'],
    caveats: ['Only counties with air monitors appear, and only years with at least 120 monitored days. Most rural counties have no monitor, which is not the same as clean air.', COUNTY_CAVEAT], isRate: true },
    years.map(y => `${y}-12-31`), entities);
};

// ---------- FDA ----------
builders['recalls'] = async () => {
  const counts = async (kind, cls) => {
    const j = await get(`https://api.fda.gov/${kind}/enforcement.json?search=classification:%22${encodeURIComponent(cls)}%22&count=report_date`);
    const m = new Map(); for (const r of j.results) { const k = `${r.time.slice(0, 4)}-${r.time.slice(4, 6)}-01`; m.set(k, (m.get(k) || 0) + r.count); } return m;
  };
  const out = [];
  for (const [kind, title, noun] of [['food', 'Food recalls', 'food'], ['drug', 'Drug recalls', 'drug']]) {
    const cls = ['Class I', 'Class II', 'Class III'], maps = [];
    for (const c of cls) maps.push(await counts(kind, c));
    const months = [...new Set(maps.flatMap(m => [...m.keys()]))].sort().filter(t => t >= '2013-01-01');
    const thisMonth = new Date().toISOString().slice(0, 7) + '-01';
    const ms = months.filter(t => t < thisMonth);
    out.push(ts({ id: `${kind}-recalls`, title, category: 'Health', frequency: 'monthly',
      unit: { label: `${title} reported per month`, format: 'number', decimals: 0 },
      description: `${title} reported to the FDA each month, by how serious the risk is.`,
      source: { publisher: 'U.S. Food and Drug Administration', dataset: `openFDA ${noun} enforcement reports`, url: `https://open.fda.gov/apis/${kind}/enforcement/` },
      howToRead: ['Class I: reasonable chance of serious harm or death. Class II: temporary or reversible harm. Class III: unlikely to cause harm.', 'One recall can cover many products and lots, so counts measure recall actions, not the amount of product.'],
      caveats: ['openFDA notes its data is not validated for medical decisions. Months reflect when FDA published the report, not when the problem started.'], defaultSeries: ['I'] },
      cls.map((c, i) => ({ id: c.split(' ')[1], name: c, points: ms.map(t => [t, maps[i].get(t) || 0]) }))));
  }
  return out;
};

// ---------- Forests ----------
builders['forest-cover'] = async () => {
  const { times, entities } = await worldBank('AG.LND.FRST.ZS', 1990);
  return panel({ id: 'forest-cover', title: 'Forest cover by country', category: 'World', frequency: 'annual', geo: 'world',
    unit: { label: 'Forest area (% of land area)', format: 'pct', decimals: 1 },
    description: 'Share of each country\'s land covered by forest.',
    source: { publisher: 'World Bank', dataset: 'World Development Indicators (AG.LND.FRST.ZS), from UN FAO Global Forest Resources Assessment', url: 'https://data.worldbank.org/indicator/AG.LND.FRST.ZS' },
    howToRead: ['Counts land with trees taller than 5 meters covering more than 10% of the area, including planted forests.'],
    caveats: ['A country can lose old-growth forest while gaining plantations and show little net change.'], isRate: true }, times, entities);
};

// ---------- Elections (MIT Election Data + Science Lab, CC0) ----------
// Harvard Dataverse requires a guestbook response (name, email, institution,
// position) for each download. Results change every four years, so CI does not
// re-download: the builder runs only when ELECTIONS_FILE (a local copy) or the
// DATAVERSE_GB_* variables are set, and otherwise keeps the committed snapshot.
async function electionsFile() {
  if (process.env.ELECTIONS_FILE) return fs.readFile(process.env.ELECTIONS_FILE, 'utf8');
  const gb = ['NAME', 'EMAIL', 'INSTITUTION', 'POSITION'].map(k => process.env[`DATAVERSE_GB_${k}`]);
  if (gb.some(v => !v)) return null;
  const r = await fetch('https://dataverse.harvard.edu/api/access/datafile/13573089?format=original', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestbookResponse: { name: gb[0], email: gb[1], institution: gb[2], position: gb[3] } }) });
  const j = await r.json();
  if (!j.data?.signedUrl) throw new Error('Dataverse did not return a download link');
  return get(j.data.signedUrl, 'text');
}

builders['elections'] = async () => {
  const text = await electionsFile();
  if (!text) { console.log('  (skipped elections: results change every four years; set ELECTIONS_FILE to rebuild)'); return []; }
  const rows = parseCSV(text), h = rows[0], ix = k => h.indexOf(k);
  // Per county and year: use TOTAL rows where a county reports them, otherwise add up vote modes.
  const hasTotal = new Set(rows.slice(1).filter(r => r[ix('mode')] === 'TOTAL').map(r => `${r[ix('year')]}|${r[ix('state_po')]}|${r[ix('county_fips')]}|${r[ix('county_name')]}`));
  const cty = new Map(), st = new Map();
  const add = (m, k, party, v) => { if (!m.has(k)) m.set(k, { D: 0, R: 0, T: 0 }); const x = m.get(k); x.T += v; if (party === 'DEMOCRAT') x.D += v; if (party === 'REPUBLICAN') x.R += v; };
  for (const r of rows.slice(1)) {
    const year = r[ix('year')], spo = r[ix('state_po')], f = r[ix('county_fips')], nm = r[ix('county_name')], mode = r[ix('mode')];
    if (hasTotal.has(`${year}|${spo}|${f}|${nm}`) && mode !== 'TOTAL') continue;
    // Some 2024 state files (SC, TX, WI, WV) add summary rows that are not votes for a
    // candidate; counting them would double totals and distort margins.
    if (/^(TOTAL VOTES CAST|UNDERVOTES|OVERVOTES|SPOILED)$/i.test(r[ix('candidate')].trim())) continue;
    const v = +r[ix('candidatevotes')] || 0, party = r[ix('party')];
    add(st, `${year}|${spo}`, party, v);
    // Alaska reports by state house district (codes 2001-2040), which would collide with
    // real borough codes once padded; it stays in state totals only.
    if (spo !== 'AK' && /^\d{4,5}$/.test(f)) add(cty, `${year}|${f.padStart(5, '0')}`, party, v);
  }
  const years = [...new Set(rows.slice(1).map(r => +r[ix('year')]))].sort((a, b) => a - b);
  const margin = x => (x && x.T ? round((x.D - x.R) / x.T * 100, 1) : null);
  let names = new Map();
  try { names = new Map((await censusCountyFile()).recs.map(r => [r.STATE + r.COUNTY, [r.CTYNAME, ABBR[r.STATE]]])); } catch { }
  const ids = [...new Set([...cty.keys()].map(k => k.split('|')[1]))].filter(id => names.has(id));
  const nat = years.map(y => { const s = { D: 0, R: 0, T: 0 }; for (const [k, x] of st) if (k.startsWith(y + '|')) { s.D += x.D; s.R += x.R; s.T += x.T; } return s; });
  const src = { publisher: 'MIT Election Data + Science Lab', dataset: 'County Presidential Election Returns 2000-2024 (official results from state election offices)', url: 'https://doi.org/10.7910/DVN/VOQCHQ' };
  const unit = { label: 'Vote margin (percentage points)', format: 'margin', decimals: 1 };
  const howToRead = ['Margin = Democratic share minus Republican share of all votes cast. +10 means the Democratic candidate led by 10 points; −10 means the Republican candidate did.', 'Third-party and write-in votes count toward the total, so the two shares add to less than 100%.'];
  const base = { category: 'Elections', frequency: 'quadrennial', source: src, unit, howToRead, zeroLine: true, election: true };
  const times = years.map(y => `${y}-11-05`);
  return [
    panel({ ...base, id: 'county-president', title: 'Presidential election results by county', geo: 'us-counties',
      description: 'How each county voted for president, 2000 to 2024, as the margin between the Democratic and Republican candidates.',
      caveats: ['A shaded map gives large, empty counties the same weight as big cities. The votes-cast fact and the bar view show where the voters are.', 'Alaska reports results by state house district, not county, so it shows as no data.', 'Certified results compiled by MIT Election Data + Science Lab; small differences from a state\'s own canvass are possible.'],
      national: { name: 'United States', values: nat.map(margin) } }, times,
      ids.map(id => { const [nm, ab] = names.get(id); const xs = years.map(y => cty.get(`${y}|${id}`)); return { id, code: ab, name: `${nm}, ${ab}`, short: nm, votes: xs.map(x => x?.T ?? null), values: xs.map(margin) }; })),
    panel({ ...base, id: 'state-president', title: 'Presidential election results by state', geo: 'us-states',
      description: 'Statewide margin between the Democratic and Republican presidential candidates, 2000 to 2024.',
      caveats: ['The national popular vote and the Electoral College can differ: the winner of the most votes nationally lost the presidency in 2000 and 2016.', 'Certified results compiled by MIT Election Data + Science Lab.'],
      national: { name: 'United States (popular vote)', values: nat.map(margin) } }, times,
      STATES.map(([ab, fips, name]) => { const xs = years.map(y => st.get(`${y}|${ab}`)); return { id: fips, code: ab, name, votes: xs.map(x => x?.T ?? null), values: xs.map(margin) }; })),
  ];
};

// ---------- FBI Crime Data Explorer (needs API_DATA_GOV_KEY; runs in CI) ----------
// /summarized/{state|national}/{offense} returns monthly offenses per 100,000 people,
// plus the share of the population covered by reporting agencies.
async function fbiSummary(where, offense, from, to) {
  const r = await fetch(`https://api.usa.gov/crime/fbi/cde/summarized/${where}/${offense}?from=01-${from}&to=12-${to}`, { headers: { 'X-Api-Key': process.env.API_DATA_GOV_KEY } });
  if (!r.ok) throw new Error(`FBI ${where}/${offense}: HTTP ${r.status}`);
  return r.json();
}
function fbiAnnual(j, label, years) {
  const rates = j.offenses?.rates?.[`${label} Offenses`] || {}, cover = j.tooltips?.['Percent of Population Coverage']?.[label] || {};
  return years.map(y => {
    const months = Object.keys(rates).filter(k => k.endsWith('-' + y));
    if (months.length < 12) return { v: null, c: null };
    const cov = months.reduce((a, k) => a + (+cover[k] || 0), 0) / months.length;
    return { v: round(months.reduce((a, k) => a + (+rates[k] || 0), 0), 1), c: round(cov, 1) };
  });
}
builders['crime'] = async () => {
  if (!process.env.API_DATA_GOV_KEY) { console.log('  (skipped crime: needs the API_DATA_GOV_KEY secret)'); return []; }
  const last = new Date().getUTCFullYear() - 1, years = []; for (let y = 1985; y <= last; y++) years.push(y);
  const MIN_COVER = 60;
  const OFF = [['violent-crime', 'state-violent-crime', 'Violent crime rate by state', 'Violent crimes per 100,000 residents', 'Murder, rape, robbery and aggravated assault reported to police, per 100,000 residents.'],
    ['property-crime', 'state-property-crime', 'Property crime rate by state', 'Property crimes per 100,000 residents', 'Burglary, larceny-theft and motor vehicle theft reported to police, per 100,000 residents.'],
    ['homicide', 'state-homicide', 'Homicide rate by state', 'Murders per 100,000 residents', 'Murder and nonnegligent manslaughter reported to police, per 100,000 residents.']];
  const out = [];
  for (const [off, id, title, label, description] of OFF) {
    const nat = fbiAnnual(await fbiSummary('national', off, 1985, last), 'United States', years);
    let dropped = 0;
    const entities = [];
    for (const [ab, fips, name] of STATES) {
      const a = fbiAnnual(await fbiSummary(`state/${ab}`, off, 1985, last), name, years);
      entities.push({ id: fips, code: ab, name, coverage: a.map(x => x.c), values: a.map(x => { if (x.v != null && x.c != null && x.c < MIN_COVER) { dropped++; return null; } return x.v; }) });
    }
    console.log(`  ${id}: ${entities.filter(e => e.values.some(v => v != null)).length} states, ${dropped} state-years left blank for low reporting coverage`);
    out.push(panel({ id, title, category: 'Public safety', frequency: 'annual', geo: 'us-states',
      unit: { label, format: 'number', decimals: 1 }, description, reframes: OFF.map(x => x[1]),
      lens: { 'violent-crime': 'Violent crime', 'property-crime': 'Property crime', homicide: 'Homicide' }[off],
      source: { publisher: 'Federal Bureau of Investigation', dataset: 'Crime Data Explorer, Uniform Crime Reporting (summarized)', url: 'https://cde.ucr.cjis.gov/' },
      howToRead: ['Counts crimes reported to police, not all crimes: many go unreported, especially property crimes and rape.', 'The FBI changed reporting systems in 2021 and many agencies did not submit that year, so 2021 is the least complete year.'],
      caveats: [`A state-year is left blank when agencies covering less than ${MIN_COVER}% of its residents reported (${dropped} blanks).`, 'Rates are computed from the agencies that reported. The FBI\'s official national estimates fill in for non-reporting agencies and run 1-6% lower in some years (1991: about 758 violent crimes per 100,000 vs. 798 here). Cite "FBI Crime Data Explorer, reported agencies" when using these.', 'Definitions changed over time (for example, the FBI broadened its definition of rape in 2013), so long-term comparisons carry caveats.'],
      isRate: true, national: { name: 'United States', values: nat.map(x => x.v) } }, years.map(y => `${y}-12-31`), entities));
  }
  return out;
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
// `released` records when a dataset's latest observation first appeared, so the app can
// show "new data" (a real release), not just "re-downloaded".
let prevCat = [];
try { prevCat = JSON.parse(await fs.readFile(path.join(OUT, 'catalog.json'), 'utf8')); } catch { }
const prevById = new Map(prevCat.map(c => [c.id, c]));
// Latest headline value, for dataset cards.
function latestOf(ds) {
  if (ds.kind === 'timeseries') {
    const s = ds.series.find(x => x.id === ds.defaultSeries?.[0]) || ds.series[0];
    const p = s?.points.at(-1);
    return p ? { t: p[0], v: p[1], series: ds.series.length > 1 ? s.name : undefined } : null;
  }
  if (ds.kind === 'panel' && ds.national) {
    for (let i = ds.times.length - 1; i >= 0; i--) if (ds.national.values[i] != null) return { t: ds.times[i], v: ds.national.values[i], series: ds.national.name };
  }
  return null;
}
for (const f of (await fs.readdir(OUT)).filter(f => f.endsWith('.json') && f !== 'catalog.json')) {
  const ds = JSON.parse(await fs.readFile(path.join(OUT, f), 'utf8'));
  const { series, entities, events, times, national, ...meta } = ds;
  const tag = DATASET_TAGS[meta.id] || {};
  const src = [...FEDERAL.map(f => ({ ...f, tier: 'federal' })), ...THIRD_PARTY].find(x => x.id === tag.source);
  const prev = prevById.get(meta.id);
  const released = prev && prev.lastObservation !== meta.lastObservation ? NOW : prev?.released ?? null;
  catalog.push({ ...meta, latest: latestOf(ds), released, hasNational: !!national, topic: tag.topic || 'economy', sourceId: tag.source || null, tier: tag.tier || src?.tier || 'federal', nSeries: series?.length, nEntities: entities?.length, nEvents: events?.length,
    firstObservation: times?.[0] ?? series?.[0]?.points?.[0]?.[0] ?? events?.[0]?.t });
}
catalog.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
await fs.writeFile(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`catalog: ${catalog.length} datasets`);
