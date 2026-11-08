// Bundles map geometry + lookup tables into public/js/geo-data.js
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const iso = require('i18n-iso-countries');
iso.registerLocale(require('i18n-iso-countries/langs/en.json'));
const states = JSON.parse(fs.readFileSync('node_modules/us-atlas/states-albers-10m.json'));
const world = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-110m.json'));
// Countries without a numeric id in world-atlas (e.g. Kosovo, N. Cyprus) get a stable name id.
world.objects.countries.geometries.forEach(g => { if (g.id == null) g.id = 'n:' + g.properties.name; });
const iso3 = {}, names = {};
for (const [a3, num] of Object.entries(iso.getNumericCodes ? {} : {})) {}
for (const a2 of Object.keys(iso.getAlpha2Codes())) {
  const a3 = iso.alpha2ToAlpha3(a2), num = iso.alpha2ToNumeric(a2);
  if (!a3 || !num) continue;
  iso3[a3] = num;
  for (const n of [].concat(iso.getName(a2, 'en', { select: 'all' }) || [])) names[n.toLowerCase()] = num;
}
for (const g of world.objects.countries.geometries) names[g.properties.name.toLowerCase()] = g.id;
Object.assign(names, { 'united states of america': '840', 'usa': '840', 'us': '840', 'uk': '826', 'russia': '643', 'south korea': '410', 'north korea': '408', 'iran': '364', 'syria': '760', 'vietnam': '704', 'laos': '418', 'bolivia': '068', 'venezuela': '862', 'tanzania': '834', 'czechia': '203', 'turkiye': '792', 'egypt, arab rep.': '818' });
const out = `window.PS_GEO=${JSON.stringify({ states, world, iso3ToNum: iso3, countryNameToNum: names })};`;
fs.writeFileSync('public/js/geo-data.js', out);
// County geometry is large (~800 KB), so it ships as its own file and loads on demand.
const counties = JSON.parse(fs.readFileSync('node_modules/us-atlas/counties-albers-10m.json'));
delete counties.objects.nation;
fs.writeFileSync('public/js/geo-counties.js', `window.PS_GEO_COUNTIES=${JSON.stringify(counties)};`);
fs.copyFileSync('node_modules/d3/dist/d3.min.js', 'public/vendor/d3.min.js');
fs.copyFileSync('node_modules/topojson-client/dist/topojson-client.min.js', 'public/vendor/topojson-client.min.js');
console.log('geo-data.js', (out.length / 1024).toFixed(0) + 'KB');
