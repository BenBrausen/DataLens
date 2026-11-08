# Plainsight

Turn official public data into honest, animated charts and maps, sized for any platform.

Pick a dataset (curated, searched from data.gov, or uploaded), choose a chart, style it, and export a video or image for TikTok, Reels, Shorts, Instagram, X, LinkedIn, YouTube or the web. Every frame carries its source citation. Every explanation is computed from the data, never generated.

## Run it

```bash
npm install
npm run refresh      # pull the latest data from every source (about 30s)
npm start            # http://localhost:8080
```

`npm start` also re-pulls data every 6 hours (`REFRESH_HOURS=0` turns that off). Node 22+, no other dependencies at runtime. Behind a corporate proxy, run with `NODE_USE_ENV_PROXY=1`.

`npm run build:artifact` writes `dist/index.html`, a single 1.4 MB file with the app, maps and the latest snapshots inlined. It works on any static host and offline.

## How it works

```
official sources ─► scripts/refresh-data.mjs ─► public/data/*.json ─► app (browser)
  FRED, BLS, Treasury,     normalize into 3 shapes      versioned snapshots     render.js draws frame(t)
  CDC, USGS, World Bank,   (timeseries/panel/events)    (the central copy)      preview = PNG = video
  data.gov catalog, CSV
```

- **Frame renderer** (`public/js/render.js`). Every chart is a pure function of timeline position `p` (0 to 1) drawn on canvas. Preview, PNG and video all call it, so what you see is what ships.
- **Three data shapes** (`public/js/data.js`). Time series (one value over time), panel (place × time) and events (things that happen at a place and time). Chart types attach to shapes, not sources, so any new dataset gets every chart that fits.
- **Explanation engine** (`public/js/insights.js`). Computes the takeaway, key facts, captions and voiceover script from the numbers on screen. No language model writes numbers.
- **Trust checks.** These run on every change:
  - Citation on every frame. It can be restyled but not removed.
  - Freshness check against each source's release schedule.
  - Bars always start at zero. Line charts warn and label the chart when the axis is zoomed.
  - "Same data, different lens": nominal, % of GDP, or inflation-adjusted.
  - Per-capita guard on maps of raw counts.
  - Warning when a trimmed time range flips the long-term trend.
  - Warning when hype words in the headline ("soars", "plummets") outrun the data.
  - Colorblind check on the chosen palette.
  - Uploaded files are flagged as unverified.

## Datasets included

| Dataset | Source | Shape | Updates |
|---|---|---|---|
| Unemployment rate (U-3, U-6) | BLS via FRED | time series | monthly |
| Inflation (CPI, core) | BLS via FRED | time series | monthly |
| 30-year mortgage rate | Freddie Mac via FRED | time series | weekly |
| Gas price, nominal and inflation-adjusted | EIA via FRED | time series | weekly |
| New home price, nominal and inflation-adjusted | Census/HUD via FRED | time series | quarterly |
| National debt: nominal, % of GDP, inflation-adjusted | Treasury Fiscal Data, OMB | time series | daily / quarterly |
| Unemployment by state, 1976 to now | BLS LAUS via FRED | panel, US map | monthly |
| Population by state, 1900 to now | Census via FRED | panel, US map | annual |
| Overdose deaths by state: totals and per 100k | CDC NCHS | panel, US map | monthly |
| Earthquakes, past 30 days | USGS | events, world map | real time |
| Median household income by state (vs U.S.) | Census via FRED | panel, US map | annual |
| Personal income per person by state (vs U.S.) | BEA via FRED | panel, US map | annual |
| Home price growth by state (vs U.S.) | FHFA via FRED | panel, US map | quarterly |
| Minimum wage by state (vs federal) | Dept. of Labor via FRED | panel, US map | annual |
| Typical home value by state | Zillow Research (company) | panel, US map | monthly |
| Consumer sentiment | University of Michigan (academic) | time series | monthly |
| Job postings index | Indeed Hiring Lab (company) | time series | weekly |
| CO2 emissions per person by country | Our World in Data (academic) | panel, world map | annual |
| Population, growth since 2020, net domestic migration by county | Census (Vintage 2025) | panel, county map | annual |
| Obesity, diabetes, depression, smoking, uninsured adults by county | CDC PLACES (model-based) | county map | annual |
| Median household income and poverty by county | Census ACS 5-year | panel, county map | annual; turns on when a `CENSUS_API_KEY` secret is added (not yet exercised) |
| GDP by country, 1960 to now | World Bank | panel, world map | annual |
| Life expectancy by country | World Bank / UN | panel, world map | annual |

To add a source, write one builder function in `scripts/refresh-data.mjs` that returns one of the three shapes. Charts, explanations and trust checks work automatically.

## Sources: federal, state and vetted third parties

Every dataset and search result carries a **source tier**, shown as a badge, in the trust check and in the citation line on the chart:

| Tier | Examples | How it's labeled on the chart |
|---|---|---|
| Federal | BLS, Census, BEA, Treasury, CDC, USGS, EIA, FHFA | agency name |
| State | 50 state portals plus state agencies | agency + state |
| Academic | University of Michigan, Our World in Data (Oxford) | "(academic research)" |
| Nonprofit | Urban Institute | "(nonprofit research)" |
| Industry | Zillow Research, Indeed Hiring Lab | "(company data)" + disclosure warning |
| International | World Bank | organization name |

Browse three ways in the Data step: **Topics** (jobs, prices, housing, health and so on), **Sources** (by tier, with each source's trust profile) and **Search** (data.gov and state portals together). Pick **Your state** and every state-level chart highlights that state, compares it with the U.S., and leads the takeaway with it ("California's unemployment rate was 5.1%, above the U.S. (4.2%). It ranks 2nd highest of 51.").

**State portals** (`scripts/sources/state-portals.csv`, plus reviewed extras in `scripts/sources/catalog.mjs`). `scripts/build-sources.mjs` detects each portal's platform, follows moved domains and counts datasets. It runs weekly in CI and never overwrites a good result because a portal was unreachable.

| Platform | Search | Download | Verified with |
|---|---|---|---|
| Socrata | one call covers every state portal | `/resource/<id>.csv` | NY, WA, TX, CO, CT, MD and 9 more |
| CKAN | `/api/3/action/package_search` | resource CSV URL | California (4,696 datasets) |
| ArcGIS Hub | `/api/search/v1` (OGC Records) | Hub download API | Minnesota (moved from gisdata.mn.gov) |
| ArcGIS Online agencies | one central `hub.arcgis.com` search filtered by `orgid` | Hub download API | Florida, Ohio, D.C., Utah and 18 more |

Coverage: 74 searchable portals in 50 of 51 jurisdictions (South Dakota is the gap). For states whose starter portal is a plain website, `ARCGIS_STATE_ORGS` in `scripts/sources/catalog.mjs` adds state agencies found through ArcGIS Hub's site directory, filtered to state-government publishers and reviewed by hand. Universities, regional councils and city/county sites were rejected.

All three allow direct browser requests, so state search works on a static site with no proxy. Downloads are capped at 30 MB (some GIS exports are 160 MB+); a capped load is flagged on the chart.

**Cities, counties and regions** (`scripts/sources/local-portals.csv`, 88 portals from the reviewed source list): 42 cities, 27 counties, 13 regional agencies, 6 combined city-counties. They are verified the same way as state portals, appear under **Your state** and in the **Local** tier, and are cited as official local sources. 25 are confirmed searchable so far, including New York City (2,416 datasets), Chicago (924), Cook County (523) and Los Angeles (361); the weekly check classifies the rest.

**How the reviewed source list was categorized**

| Rows | Treatment |
|---|---|
| 88 city, county, regional portals | Local tier, verified weekly, searchable when the platform allows |
| 29 national sources with local detail | Federal candidates (`FEDERAL_CANDIDATES` in `scripts/sources/catalog.mjs`): 2 built, 11 next (open, no key), 8 need a free key, 3 already reachable via search, 4 need extra design, 1 reference only |
| 9 transit feeds (GTFS) | Not added as data sources: they are schedules and live vehicle positions, not statistics, and several need keys. Transit ridership comes from the National Transit Database instead. Feeds fit a future "transit map" chart type |
| OpenStreetMap | Not added: community-made, not official. Could later serve as a context layer (labeled "Community data, OpenStreetMap contributors", ODbL) |
| Minnesota Pollution Control Agency | Already covered: its datasets are on Minnesota's state portal |
| Duplicates | Pittsburgh WPRDC listed twice; Washington DC is already the District's state-level portal |

**Adding a third-party source** (`THIRD_PARTY` in `scripts/sources/catalog.mjs`): it must publish its methodology, offer a stable public download or API, and state who funds it. Industry sources always ship with a disclosure. Candidates not yet added (no open bulk download or still to be reviewed): Pew Research Center, KFF, Brookings, Federal Reserve Bank of New York, Redfin Data Center, Realtor.com Research.

**Importing safely.** The CSV mapper samples the whole file, combines `year` + `month` columns into dates, and offers an "Only rows where…" filter that defaults to the most detailed level (counties, not the state total), so files that mix totals with their parts are not double counted. Whenever rows get summed or averaged, a trust check says so.

## County maps

Pick **Your state** and county maps zoom to that state's counties, rankings and takeaways are computed within the state ("In Ohio, Union County ranks highest (17.0%)…"), and the Topics tab lists that state's county data first.

- Data that can go negative (growth, migration) uses a two-sided red/blue scale with a gray midpoint at zero.
- Rankings leave out counties under 5,000 residents by default (changeable in the Chart step). Those counties still appear on the map, and a trust check says how many were skipped. Without it, 52-person Loving County, TX "leads the nation" in migration.
- Imports recognize county FIPS codes, county names with a state column, and county names on a state portal (data.ny.gov files map to New York's counties automatically). Independent cities (St. Louis city, Baltimore city, most of Virginia's) are told apart from counties by their FIPS codes.
- Connecticut replaced counties with planning regions in 2022; the county map still uses the old counties, so Connecticut shows as no data.

## Comparing datasets (overlays)

In the Chart step, **Compare with another dataset** lists every dataset as either compatible, with the methods it allows, or blocked, with the reason. The method follows from the data, and a second y-axis is never used:

| Datasets | Method | Example |
|---|---|---|
| Same unit, similar scale | One shared axis | Unemployment rate vs. inflation rate |
| Quantities in different units or at very different levels (all values positive) | Growth, indexed to 100 at the first shared date | New home prices vs. household income since 1984 |
| Any two or three measures over time | Stacked panels, own scales, one shared timeline | Unemployment vs. consumer sentiment |
| Two state, county or country datasets | Scatter, one dot per place, animated over shared years, with trend line and r | State income vs. home values |
| Events, mismatched geographies, no shared dates, single snapshots without a timeline, two lenses of one dataset | Blocked, with the reason shown | Earthquakes vs. anything |

Rates are never indexed (4% to 6% shown as "+50%" misleads). Very skewed measures (GDP) switch to a log scale, and r is computed on the scale shown. Every overlay gets a "How these fit together" explanation and computed facts, plus trust checks:

- Scatters always carry "Correlation, not cause".
- Indexed charts warn when they mix nominal and inflation-adjusted dollars, and note that the start date shapes the story.
- Only the shared period is shown.
- Every source is cited.

## Being the central data source

This repo is built to be the one place everyone reads from:

1. `.github/workflows/refresh-and-deploy.yml` runs every 6 hours. It pulls every source, commits changed snapshots (each dataset gets a git history) and deploys `public/` to GitHub Pages.
2. Anyone, including other apps, can read `https://<owner>.github.io/<repo>/data/catalog.json` and `/data/<id>.json`. No API keys are needed, and the government APIs aren't hit once per viewer.
3. A static site can't search data.gov directly because the catalog sends no CORS headers. Deploy `worker/proxy.js` to Cloudflare Workers (free tier) and set `window.PS_API_BASE` to its URL. The local `server.js` already includes the same proxy.

Free API keys worth getting, stored as GitHub Action secrets and never in the browser:

| Key | Why |
|---|---|
| Census API key | now required for ACS data, e.g. county-level income and poverty |
| FRED API key | higher rate limits and release calendars |
| BLS v2 key | more series per request |
| EIA key | energy detail by state |

## Roadmap

**Next**
- County-level maps (geometry is already in `us-atlas`), with ACS income, poverty and rent once a Census key is added.
- Server-side text-to-speech (ElevenLabs or OpenAI) so the voiceover script embeds in exports without recording. Browser voices can preview but can't be captured.
- Release calendar: show "next update: Nov 7, 8:30am ET" and send alerts when a followed dataset publishes.
- MP4 encoding via WebCodecs for faster-than-real-time export.

**Then**
- More chart forms: small multiples, slope charts, waffle/unit charts ("1 in 5"), dot plots with uncertainty ranges, cartograms, county hex maps.
- Brand kits for newsrooms: saved fonts, colors, logo and lower-third, locked per team.
- Embeddable interactive version (iframe) with a data table for accessibility and SEO.
- Margin-of-error awareness: show ACS confidence intervals and refuse to rank states whose ranges overlap.
- An optional AI rewrite of the takeaway. It may rephrase only computed facts and is checked number-for-number against the data before it shows.
- Native iOS app: the editor and preview already adapt to available width, so wide inner displays get side-by-side panels while standard iPhones get the stacked flow.

## Files

```
server.js                      static server + data.gov search + CSV proxy + scheduled refresh
scripts/refresh-data.mjs       source builders (one per dataset)
scripts/build-geo.mjs          bundles map geometry + country/state lookups
scripts/build-artifact.mjs     single-file build
public/js/render.js            frame renderer and all chart types
public/js/insights.js          takeaways, captions, voiceover script, trust checks
public/js/data.js              loading, data.gov search, CSV type inference
public/js/export.js            PNG, video (MP4/WebM), audio mixing
public/js/app.js               editor UI
worker/proxy.js                Cloudflare Worker for static hosting
```
