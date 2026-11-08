// Hand-curated source catalog: tiers, topics, federal publishers and vetted
// third-party sources. State portals come from state-portals.csv and are
// verified by scripts/build-sources.mjs.
//
// Adding a third-party source: it must publish its methodology, have a stable
// public download or API, and state its funding or business interest. Industry
// and company sources always carry a disclosure that is shown next to the chart.

export const TIERS = [
  { id: 'federal', name: 'Federal government', short: 'Federal', desc: 'U.S. agencies with legally mandated statistical programs.' },
  { id: 'state', name: 'State government', short: 'State', desc: 'Official open-data portals run by state governments and agencies.' },
  { id: 'academic', name: 'Universities & research', short: 'Academic', desc: 'University programs and academic research groups that publish their methods.' },
  { id: 'nonprofit', name: 'Nonprofit research', short: 'Nonprofit', desc: 'Independent, nonpartisan research organizations.' },
  { id: 'industry', name: 'Industry & companies', short: 'Industry', desc: 'Companies and trade groups. Useful and timely, but they have a business interest; a disclosure travels with every chart.' },
  { id: 'international', name: 'International', short: 'Intl.', desc: 'Intergovernmental organizations.' },
];

export const TOPICS = [
  { id: 'economy', name: 'Jobs & economy', kw: ['employment', 'unemployment', 'labor', 'jobs', 'wage', 'income', 'economy', 'business', 'gdp'] },
  { id: 'prices', name: 'Prices & cost of living', kw: ['price', 'inflation', 'cost', 'cpi', 'rent', 'gas'] },
  { id: 'housing', name: 'Housing', kw: ['housing', 'home', 'mortgage', 'rent', 'eviction', 'homeless'] },
  { id: 'health', name: 'Health', kw: ['health', 'hospital', 'disease', 'overdose', 'death', 'covid', 'medicaid', 'vaccin'] },
  { id: 'education', name: 'Education', kw: ['education', 'school', 'student', 'college', 'enrollment', 'graduation'] },
  { id: 'safety', name: 'Public safety & justice', kw: ['crime', 'police', 'arrest', 'court', 'jail', 'prison', 'fire', 'crash', 'safety'] },
  { id: 'environment', name: 'Environment & climate', kw: ['environment', 'climate', 'emission', 'air', 'water', 'earthquake', 'weather', 'wildlife', 'parks'] },
  { id: 'energy', name: 'Energy', kw: ['energy', 'electric', 'oil', 'gas', 'solar', 'utility', 'fuel'] },
  { id: 'transportation', name: 'Transportation', kw: ['transport', 'traffic', 'vehicle', 'transit', 'road', 'highway', 'airport'] },
  { id: 'government', name: 'Government & budget', kw: ['budget', 'spending', 'debt', 'tax', 'revenue', 'payroll', 'contract', 'finance'] },
  { id: 'people', name: 'Population & demographics', kw: ['population', 'census', 'demographic', 'age', 'race', 'birth', 'migration'] },
  { id: 'world', name: 'World', kw: ['country', 'international', 'global', 'world'] },
];

// Federal publishers behind the curated datasets. `catalogSlug` is the data.gov
// organization used for "search this publisher".
export const FEDERAL = [
  { id: 'bls', name: 'Bureau of Labor Statistics', url: 'https://www.bls.gov/', topics: ['economy', 'prices'], catalogSlug: 'dol-bls' },
  { id: 'census', name: 'U.S. Census Bureau', url: 'https://www.census.gov/', topics: ['people', 'economy', 'housing'], catalogSlug: 'census' },
  { id: 'bea', name: 'Bureau of Economic Analysis', url: 'https://www.bea.gov/', topics: ['economy'] },
  { id: 'treasury', name: 'U.S. Department of the Treasury', url: 'https://fiscaldata.treasury.gov/', topics: ['government'], catalogSlug: 'treasury' },
  { id: 'cdc', name: 'CDC National Center for Health Statistics', url: 'https://www.cdc.gov/nchs/', topics: ['health'], catalogSlug: 'hhs' },
  { id: 'usgs', name: 'U.S. Geological Survey', url: 'https://www.usgs.gov/', topics: ['environment'], catalogSlug: 'doi' },
  { id: 'eia', name: 'U.S. Energy Information Administration', url: 'https://www.eia.gov/', topics: ['energy', 'prices'], catalogSlug: 'energy' },
  { id: 'fhfa', name: 'Federal Housing Finance Agency', url: 'https://www.fhfa.gov/data/hpi', topics: ['housing'], catalogSlug: 'fhfa' },
  { id: 'dol', name: 'U.S. Department of Labor', url: 'https://www.dol.gov/agencies/whd/minimum-wage/state', topics: ['economy'], catalogSlug: 'dol' },
  { id: 'fred', name: 'Federal Reserve Bank of St. Louis (FRED)', url: 'https://fred.stlouisfed.org/', topics: ['economy', 'prices', 'housing'], note: 'Redistributes official series from the agencies above; Plainsight cites the original agency.' },
];

export const THIRD_PARTY = [
  {
    id: 'owid', tier: 'academic', name: 'Our World in Data', url: 'https://ourworldindata.org/',
    org: 'Research publication run by the University of Oxford and the nonprofit Global Change Data Lab',
    why: 'Publishes sources, code and methods for every chart; data licensed CC BY.',
    disclosure: 'Mostly republishes and harmonizes primary data (UN, World Bank, Global Carbon Project); the original source is named on each dataset.',
    topics: ['world', 'environment', 'health', 'energy'], access: 'csv',
  },
  {
    id: 'umich', tier: 'academic', name: 'University of Michigan Surveys of Consumers', url: 'https://www.sca.isr.umich.edu/',
    org: 'Institute for Social Research, University of Michigan',
    why: 'Running since 1946 with published questionnaires and methodology; a component of the government\'s Index of Leading Indicators.',
    disclosure: 'A monthly phone/online survey of about 600-1,000 people, so small moves are within the margin of error.',
    topics: ['economy'], access: 'fred',
  },
  {
    id: 'urban', tier: 'nonprofit', name: 'Urban Institute Education Data Portal', url: 'https://educationdata.urban.org/',
    org: 'Urban Institute, a nonpartisan research organization',
    why: 'Harmonizes federal education data (NCES, IPEDS, Civil Rights Data Collection) into one documented API.',
    disclosure: 'Redistributes federal data; values match the underlying federal source.',
    topics: ['education'], access: 'api',
  },
  {
    id: 'zillow', tier: 'industry', name: 'Zillow Research', url: 'https://www.zillow.com/research/data/',
    org: 'Zillow Group, a real-estate marketplace company',
    why: 'Widely cited, updated monthly, with published methodology and free downloads.',
    disclosure: 'Zillow is a real-estate company. The Zillow Home Value Index is its own model of typical home values, not actual sale prices.',
    topics: ['housing'], access: 'csv',
  },
  {
    id: 'indeed', tier: 'industry', name: 'Indeed Hiring Lab', url: 'https://www.hiringlab.org/',
    org: 'Economic research team at Indeed, a job-listing company',
    why: 'Daily data, open on GitHub with documented methodology; often leads official job-openings data.',
    disclosure: 'Counts postings on Indeed only. It tracks demand for workers, not total job openings or hires.',
    topics: ['economy'], access: 'csv',
  },
  {
    id: 'worldbank', tier: 'international', name: 'World Bank', url: 'https://data.worldbank.org/',
    org: 'International financial institution owned by 189 member countries',
    why: 'Standardized national statistics with documented sources for every indicator; CC BY 4.0.',
    disclosure: 'Figures come from national statistical offices and vary in quality between countries.',
    topics: ['world', 'economy', 'health'], access: 'api',
  },
];

// Where each curated dataset sits in the taxonomy.
export const DATASET_TAGS = {
  'us-unemployment': { topic: 'economy', source: 'bls' },
  'us-inflation': { topic: 'prices', source: 'bls' },
  'mortgage-rate': { topic: 'housing', source: 'fred' }, // Freddie Mac is a government-sponsored enterprise
  'gas-price': { topic: 'prices', source: 'eia' },
  'gas-price-real': { topic: 'prices', source: 'eia' },
  'home-price': { topic: 'housing', source: 'census' },
  'home-price-real': { topic: 'housing', source: 'census' },
  'federal-debt': { topic: 'government', source: 'treasury' },
  'federal-debt-gdp': { topic: 'government', source: 'treasury' },
  'federal-debt-real': { topic: 'government', source: 'treasury' },
  'state-unemployment': { topic: 'economy', source: 'bls' },
  'state-population': { topic: 'people', source: 'census' },
  'overdose-deaths': { topic: 'health', source: 'cdc' },
  'overdose-rate': { topic: 'health', source: 'cdc' },
  'earthquakes': { topic: 'environment', source: 'usgs' },
  'world-gdp': { topic: 'world', source: 'worldbank' },
  'life-expectancy': { topic: 'world', source: 'worldbank' },
  'state-income': { topic: 'economy', source: 'census' },
  'state-income-pc': { topic: 'economy', source: 'bea' },
  'state-hpi': { topic: 'housing', source: 'fhfa' },
  'state-min-wage': { topic: 'economy', source: 'dol' },
  'state-home-values': { topic: 'housing', source: 'zillow' },
  'consumer-sentiment': { topic: 'economy', source: 'umich' },
  'job-postings': { topic: 'economy', source: 'indeed' },
  'world-co2': { topic: 'environment', source: 'owid' },
};

// State portals found through the Socrata discovery API that the starter list
// did not include. Each is a state agency on a .gov domain, reviewed by hand.
// (Rejected during review: datahub.va.gov is the U.S. Dept. of Veterans Affairs,
// not Virginia; data.bloomington.in.gov and performance.ci.janesville.wi.us are cities.)
export const EXTRA_STATE_PORTALS = [
  { state: 'California', url: 'https://bythenumbers.sco.ca.gov/', name: 'State Controller: By the Numbers', scope: 'agency' },
  { state: 'Tennessee', url: 'https://healthdata.tn.gov/', name: 'Department of Health', scope: 'agency' },
  { state: 'Hawaii', url: 'https://highways.hidot.hawaii.gov/', name: 'Department of Transportation, Highways', scope: 'agency' },
];
