// Temporary: discovers the FBI Crime Data Explorer API's real response shapes from CI,
// where the API_DATA_GOV_KEY secret exists. Prints status and a short excerpt only.
const key = process.env.API_DATA_GOV_KEY;
if (!key) { console.log('API_DATA_GOV_KEY is not set'); process.exit(1); }
const paths = [
  'cde/estimate/national?from=2015&to=2023',
  'cde/estimate/state/CA?from=2015&to=2023',
  'cde/estimate/state/CA?type=violent-crime&from=01-2015&to=12-2023',
  'cde/estimate/state/CA/violent-crime?from=01-2015&to=12-2023',
  'cde/summarized/state/CA/violent-crime?from=01-2022&to=12-2023',
  'cde/summarized/national/violent-crime?from=01-2022&to=12-2023',
  'cde/lookup/states',
  'sapi/api/estimates/states/CA/2015/2023',
  'sapi/api/estimates/national/2015/2023',
];
for (const p of paths) {
  try {
    const r = await fetch(`https://api.usa.gov/crime/fbi/${p}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    const t = (await r.text()).replace(/\s+/g, ' ');
    console.log(`\n### ${r.status} ${p}\n${t.slice(0, 600)}`);
  } catch (e) { console.log(`\n### ERR ${p} ${e.message}`); }
}
