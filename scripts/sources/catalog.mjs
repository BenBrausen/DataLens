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
  { id: 'local', name: 'Cities, counties & regions', short: 'Local', desc: 'Official open-data portals of cities, counties and regional agencies. Searchable portals are verified weekly.' },
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
  { id: 'elections', name: 'Elections', kw: ['election', 'vote', 'voter', 'ballot', 'turnout', 'precinct'] },
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
  { id: 'fbi', name: 'Federal Bureau of Investigation', url: 'https://cde.ucr.cjis.gov/', topics: ['safety'], catalogSlug: 'doj' },
  { id: 'fema', name: 'Federal Emergency Management Agency', url: 'https://www.fema.gov/about/openfema', topics: ['environment', 'government'], catalogSlug: 'dhs' },
  { id: 'nasa', name: 'NASA Goddard Institute for Space Studies', url: 'https://data.giss.nasa.gov/gistemp/', topics: ['environment'], catalogSlug: 'nasa' },
  { id: 'epa', name: 'U.S. Environmental Protection Agency', url: 'https://www.epa.gov/outdoor-air-quality-data', topics: ['environment', 'health'], catalogSlug: 'epa' },
  { id: 'fda', name: 'U.S. Food and Drug Administration', url: 'https://open.fda.gov/', topics: ['health'], catalogSlug: 'hhs' },
  { id: 'usda', name: 'U.S. Department of Agriculture', url: 'https://www.usda.gov/topics/data', topics: ['economy', 'environment'], catalogSlug: 'usda' },
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
    id: 'mit-election-lab', tier: 'academic', name: 'MIT Election Data + Science Lab', url: 'https://electionlab.mit.edu/',
    org: 'Research lab at the Massachusetts Institute of Technology',
    why: 'Compiles certified results from every state election office into one consistent, documented dataset; public domain (CC0).',
    disclosure: 'A compilation of official results. Each state\'s certified canvass is the final authority.',
    topics: ['elections'], access: 'dataverse',
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
  'county-population': { topic: 'people', source: 'census' },
  'county-growth': { topic: 'people', source: 'census' },
  'county-migration': { topic: 'people', source: 'census' },
  'county-obesity': { topic: 'health', source: 'cdc' },
  'county-diabetes': { topic: 'health', source: 'cdc' },
  'county-depression': { topic: 'health', source: 'cdc' },
  'county-smoking': { topic: 'health', source: 'cdc' },
  'county-uninsured': { topic: 'health', source: 'cdc' },
  'county-income': { topic: 'economy', source: 'census' },
  'disasters': { topic: 'environment', source: 'fema' },
  'county-disasters': { topic: 'environment', source: 'fema' },
  'county-risk': { topic: 'environment', source: 'fema' },
  'county-wildfire-risk': { topic: 'environment', source: 'fema' },
  'county-hurricane-risk': { topic: 'environment', source: 'fema' },
  'county-heat-risk': { topic: 'environment', source: 'fema' },
  'county-flood-risk': { topic: 'environment', source: 'fema' },
  'county-natural-change': { topic: 'people', source: 'census' },
  'county-immigration': { topic: 'people', source: 'census' },
  'county-median-age': { topic: 'people', source: 'census' },
  'county-65plus': { topic: 'people', source: 'census' },
  'state-permits': { topic: 'housing', source: 'census' },
  'state-permits-total': { topic: 'housing', source: 'census' },
  'business-applications': { topic: 'economy', source: 'census' },
  'global-temperature': { topic: 'environment', source: 'nasa' },
  'county-air': { topic: 'environment', source: 'epa' },
  'food-recalls': { topic: 'health', source: 'fda' },
  'drug-recalls': { topic: 'health', source: 'fda' },
  'forest-cover': { topic: 'environment', source: 'worldbank' },
  'county-president': { topic: 'elections', source: 'mit-election-lab' },
  'state-violent-crime': { topic: 'safety', source: 'fbi' },
  'state-property-crime': { topic: 'safety', source: 'fbi' },
  'state-homicide': { topic: 'safety', source: 'fbi' },
  'state-president': { topic: 'elections', source: 'mit-election-lab' },
  'county-poverty': { topic: 'economy', source: 'census' },
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

// State agencies that publish on ArcGIS Online without a standalone portal on the
// starter list. Found through ArcGIS Hub's site directory, filtered to state
// government publishers, and reviewed by hand. Searched centrally through
// hub.arcgis.com by organization ID. (Rejected in review: New Mexico State
// University and the Nevada Bureau of Mines, which are universities; regional
// planning councils; one-off project microsites.)
export const ARCGIS_STATE_ORGS = [
  { state: "Alabama", orgId: 'ecupH7bxameyeamw', name: "Alabama Department of Economic and Community Affairs", url: "https://hub.arcgis.com/search?q=&orgId=ecupH7bxameyeamw" },
  { state: "Florida", orgId: 'nRHtyn3uE1kyzoYc', name: "Florida Department of Environmental Protection", url: "https://hub.arcgis.com/search?q=&orgId=nRHtyn3uE1kyzoYc" },
  { state: "Florida", orgId: 'O1JpcwDW8sjYuddV', name: "Florida Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=O1JpcwDW8sjYuddV" },
  { state: "Florida", orgId: 'z6TmTIyYXEYhuNM0', name: "Florida Fish and Wildlife Conservation Commission", url: "https://hub.arcgis.com/search?q=&orgId=z6TmTIyYXEYhuNM0" },
  { state: "Georgia", orgId: '6RaeG1zfsIoM9Lze', name: "Georgia Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=6RaeG1zfsIoM9Lze" },
  { state: "Georgia", orgId: 'Za9Nk6CPIPbvR1t7', name: "Georgia Geospatial Information Office", url: "https://hub.arcgis.com/search?q=&orgId=Za9Nk6CPIPbvR1t7" },
  { state: "Georgia", orgId: 'Gqyymy5JISeLzyNM', name: "Georgia Department of Community Affairs", url: "https://hub.arcgis.com/search?q=&orgId=Gqyymy5JISeLzyNM" },
  { state: "Idaho", orgId: 'CNPdEkvnGl65jCX8', name: "State of Idaho", url: "https://hub.arcgis.com/search?q=&orgId=CNPdEkvnGl65jCX8" },
  { state: "Idaho", orgId: 'Qqv4dYPC8Vv8e3c3', name: "Idaho Transportation Department", url: "https://hub.arcgis.com/search?q=&orgId=Qqv4dYPC8Vv8e3c3" },
  { state: "Idaho", orgId: 'iRCkLgFRU45VAYn3', name: "Idaho Department of Water Resources", url: "https://hub.arcgis.com/search?q=&orgId=iRCkLgFRU45VAYn3" },
  { state: "Illinois", orgId: 'aIrBD8yn1TDTEXoz', name: "Illinois Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=aIrBD8yn1TDTEXoz" },
  { state: "Illinois", orgId: 'b9DHj1BjfdLLFv11', name: "Illinois Department of Natural Resources", url: "https://hub.arcgis.com/search?q=&orgId=b9DHj1BjfdLLFv11" },
  { state: "Iowa", orgId: 'vPD5PVLI6sfkZ5E4', name: "State of Iowa", url: "https://hub.arcgis.com/search?q=&orgId=vPD5PVLI6sfkZ5E4" },
  { state: "Iowa", orgId: '8lRhdTsQyJpO52F1', name: "Iowa Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=8lRhdTsQyJpO52F1" },
  { state: "Iowa", orgId: 'r6iFVcMJeA4kB4GC', name: "Iowa Department of Natural Resources", url: "https://hub.arcgis.com/search?q=&orgId=r6iFVcMJeA4kB4GC" },
  { state: "Louisiana", orgId: 'PLiuXYMBpMK5h36e', name: "Louisiana Department of Transportation & Development", url: "https://hub.arcgis.com/search?q=&orgId=PLiuXYMBpMK5h36e" },
  { state: "Maine", orgId: 'RbMX0mRVOFNTdLzd', name: "State of Maine", url: "https://hub.arcgis.com/search?q=&orgId=RbMX0mRVOFNTdLzd" },
  { state: "Montana", orgId: 'qnjIrwR8z5Izc0ij', name: "Montana State Library", url: "https://hub.arcgis.com/search?q=&orgId=qnjIrwR8z5Izc0ij" },
  { state: "Montana", orgId: 'DRQySz3VhPgOv7Bo', name: "Montana Department of Natural Resources & Conservation", url: "https://hub.arcgis.com/search?q=&orgId=DRQySz3VhPgOv7Bo" },
  { state: "Montana", orgId: 'dKlvxNSUvl36IGMp', name: "Montana Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=dKlvxNSUvl36IGMp" },
  { state: "Nebraska", orgId: 'Sj9eBhzWwOMzQCfI', name: "State of Nebraska", url: "https://hub.arcgis.com/search?q=&orgId=Sj9eBhzWwOMzQCfI" },
  { state: "Nevada", orgId: 'RyxlXSfFi87rAosq', name: "Nevada Department of Wildlife", url: "https://hub.arcgis.com/search?q=&orgId=RyxlXSfFi87rAosq" },
  { state: "Nevada", orgId: '9Y4hSlLf13E9S0Eo', name: "Nevada Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=9Y4hSlLf13E9S0Eo" },
  { state: "Nevada", orgId: 'hKjkLA70e5yLFrt0', name: "Nevada Department of Conservation and Natural Resources", url: "https://hub.arcgis.com/search?q=&orgId=hKjkLA70e5yLFrt0" },
  { state: "New Mexico", orgId: 'qXZbWTdPDbTjl7Dy', name: "New Mexico Office of the State Engineer", url: "https://hub.arcgis.com/search?q=&orgId=qXZbWTdPDbTjl7Dy" },
  { state: "North Dakota", orgId: 'GOcSXpzwBHyk2nog', name: "State of North Dakota", url: "https://hub.arcgis.com/search?q=&orgId=GOcSXpzwBHyk2nog" },
  { state: "Ohio", orgId: '1AlElnGrgBM62OSj', name: "Ohio Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=1AlElnGrgBM62OSj" },
  { state: "Ohio", orgId: 'ajRlmtxbNBjZggOT', name: "Ohio Department of Natural Resources", url: "https://hub.arcgis.com/search?q=&orgId=ajRlmtxbNBjZggOT" },
  { state: "Ohio", orgId: 'MlJ0G8iWUyC7jAmu', name: "Ohio Geographically Referenced Information Program", url: "https://hub.arcgis.com/search?q=&orgId=MlJ0G8iWUyC7jAmu" },
  { state: "Rhode Island", orgId: 'EOvMKOFaeiXUzBcH', name: "State of Rhode Island - DOA - Division of Planning", url: "https://hub.arcgis.com/search?q=&orgId=EOvMKOFaeiXUzBcH" },
  { state: "South Carolina", orgId: 'VaY7cY9pvUYUP1Lf', name: "South Carolina Department of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=VaY7cY9pvUYUP1Lf" },
  { state: "South Carolina", orgId: 'acgZYxoN5Oj8pDLa', name: "South Carolina Department of Natural Resources", url: "https://hub.arcgis.com/search?q=&orgId=acgZYxoN5Oj8pDLa" },
  { state: "South Carolina", orgId: 'OMDIQXm11z4wcK26', name: "South Carolina Department of Environmental Services", url: "https://hub.arcgis.com/search?q=&orgId=OMDIQXm11z4wcK26" },
  { state: "Utah", orgId: 'KaHXE9OkiB9e63uE', name: "Utah Division of Emergency Management", url: "https://hub.arcgis.com/search?q=&orgId=KaHXE9OkiB9e63uE" },
  { state: "West Virginia", orgId: '3iZGO9lgMHNG1V3R', name: "West Virginia Department of Environmental Protection", url: "https://hub.arcgis.com/search?q=&orgId=3iZGO9lgMHNG1V3R" },
  { state: "Wisconsin", orgId: 'Ul9AyFFeFTjf08DW', name: "Wisconsin Department of Natural Resources", url: "https://hub.arcgis.com/search?q=&orgId=Ul9AyFFeFTjf08DW" },
  { state: "Wisconsin", orgId: '0pgGLzT0Nh7FVjon', name: "Wisconsin Dept of Transportation", url: "https://hub.arcgis.com/search?q=&orgId=0pgGLzT0Nh7FVjon" },
  { state: "Wisconsin", orgId: 'o4NJgD3NfeHnWy06', name: "Wisconsin Department of Public Instruction", url: "https://hub.arcgis.com/search?q=&orgId=o4NJgD3NfeHnWy06" },
  { state: "District of Columbia", orgId: 'neT9SoYxizqTHZPH', name: "Open Data DC (DC government)", url: "https://opendata.dc.gov/" },
  { state: "Massachusetts", orgId: 'hGdibHYSPO59RG1h', name: "MassGIS, Bureau of Geographic Information", url: "https://open-data-massgis.hub.arcgis.com/" },
  { state: "Utah", orgId: '99lidPhWCzftIe9K', name: "Utah Geospatial Resource Center (UGRC)", url: "https://opendata.gis.utah.gov/" },
  { state: "Kentucky", orgId: 'ghsX9CKghMvyYjBU', name: "KyGovMaps (Commonwealth of Kentucky)", url: "https://opendata-kygeonet.opendata.arcgis.com/" },
  { state: "Rhode Island", orgId: '7arM4WYbUOtKu3Zq', name: "Rhode Island State Enterprise GIS", url: "https://hub.arcgis.com/search?q=&orgId=7arM4WYbUOtKu3Zq" },
];

// National sources with local detail, from the reviewed source list. `status`:
//   built      already a ready-made dataset
//   next       strong candidate: open download, no key, high story value
//   key        needs a free API key (add as a GitHub secret)
//   search     reachable through data.gov or a federal portal search today
//   reference  supporting data (boundaries), not something to chart
//   care       sensitive or very large; needs extra design before adding
export const FEDERAL_CANDIDATES = [
  { name: 'CDC PLACES', status: 'built', note: 'County health measures (obesity, diabetes, depression, smoking, uninsured).' },
  { name: 'BLS Local Area Unemployment', status: 'built', note: 'State level built; county level next (monthly county rates).' },
  { name: 'US Census ACS and Decennial', status: 'key', note: 'County income and poverty builder is ready; activates with CENSUS_API_KEY.' },
  { name: 'FEMA National Risk Index', status: 'next', note: 'County and tract risk scores for 18 hazards; bulk CSV, no key.' },
  { name: 'FEMA OpenFEMA', status: 'next', note: 'Disaster declarations by county since 1953; open API, no key. Strong animated map.' },
  { name: 'USDA Food Access Research Atlas', status: 'next', note: 'Food deserts by tract; bulk CSV.' },
  { name: 'CDC Social Vulnerability Index', status: 'next', note: 'County and tract vulnerability; bulk CSV.' },
  { name: 'NHTSA FARS', status: 'next', note: 'Fatal crashes by state and county; open API.' },
  { name: 'USASpending', status: 'next', note: 'Federal spending by state and county; open API, no key.' },
  { name: 'USGS Water Data', status: 'next', note: 'Streamflow and groundwater stations; live, no key. Event-style map.' },
  { name: 'NOAA National Weather Service', status: 'next', note: 'Live alerts by zone; no key. Event-style map.' },
  { name: 'NCES Common Core of Data', status: 'next', note: 'School enrollment by district; bulk files (or via Urban Institute API, already registered).' },
  { name: 'US Census County Business Patterns', status: 'key', note: 'Businesses, jobs and payroll by county and industry.' },
  { name: 'BEA Regional Data', status: 'key', note: 'County GDP and personal income.' },
  { name: 'EPA AirData', status: 'key', note: 'Air quality by monitor; the AQS API needs an email key.' },
  { name: 'NOAA Climate Data Online', status: 'key', note: 'Weather station history; needs a token.' },
  { name: 'EIA Open Data', status: 'key', note: 'Energy by state; free key.' },
  { name: 'USDA NASS Quick Stats', status: 'key', note: 'County agriculture; free key.' },
  { name: 'US Department of Education College Scorecard', status: 'key', note: 'College cost and earnings; api.data.gov key.' },
  { name: 'EPA Envirofacts', status: 'search', note: 'Facility-level records; better as search results than a curated chart.' },
  { name: 'HUD Open Data', status: 'search', note: 'ArcGIS Hub; reachable through data.gov search.' },
  { name: 'US DOT BTS Open Data', status: 'search', note: 'ArcGIS Hub; reachable through data.gov search.' },
  { name: 'NTD National Transit Database', status: 'next', note: 'Transit ridership by agency; the statistical counterpart to transit schedule feeds.' },
  { name: 'FHWA Highway Statistics', status: 'care', note: 'Published as formatted spreadsheet tables; needs a custom parser per table.' },
  { name: 'FCC Broadband Data', status: 'care', note: 'Very large location-level files; needs pre-aggregation to county.' },
  { name: 'US Census LEHD LODES', status: 'care', note: 'Commute flows; very large origin-destination files; needs a flow-map chart type.' },
  { name: 'NCES IPEDS', status: 'care', note: 'Institution-level; useful but needs a college-level chart, not a map.' },
  { name: 'US Election Assistance Commission', status: 'care', note: 'Election administration data. Elections need extra editorial safeguards before adding.' },
  { name: 'US Census TIGER Line', status: 'reference', note: 'Boundaries, not statistics. The app already ships county and state boundaries.' },
];
