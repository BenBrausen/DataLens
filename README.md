# Civic Charts

Turn official public data into honest, animated charts and maps, sized for any platform.

**Live:** https://civiccharts.com/ · Contact: hello@civiccharts.com · Corrections: corrections@civiccharts.com

Follow: [X](https://x.com/civiccharts) · [Instagram](https://www.instagram.com/civiccharts/) · [Threads](https://www.threads.com/@civiccharts) · [YouTube](https://www.youtube.com/@civiccharts) · [TikTok](https://www.tiktok.com/@civiccharts) · [LinkedIn](https://www.linkedin.com/company/civiccharts) · [Bluesky](https://bsky.app/profile/civiccharts.com) · [Facebook](https://www.facebook.com/profile.php?id=61596267393158)

**Open data API** (no key, refreshed every 6 hours):
- Catalog of every ready-made dataset: https://civiccharts.com/data/catalog.json
- One dataset: `https://civiccharts.com/data/<id>.json` (for example `us-unemployment`, `county-poverty`, `disasters`)
- Source registry (federal, state, local portals with verified platforms): https://civiccharts.com/sources/registry.json

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
| Households with broadband / with no internet, by county and state | Census ACS 5-year, Table B28002 (bulk files, keyless) | county + state maps | annual (5-year periods) |
| Federal budget deficit: by fiscal year, % of GDP, rolling 12 months | OMB, Treasury Monthly Treasury Statement | time series | fiscal year / monthly |
| Federal revenue vs. spending, % of GDP | OMB | time series (2 lines) | fiscal year |
| Interest on the national debt: dollars, % of GDP | BEA, OMB | time series | quarterly / fiscal year |
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
| Poverty rate and median household income by county, 2005-2024 | Census SAIPE (no key) | panel, county map | annual |
| Births minus deaths, immigration by county | Census population estimates | panel, county map | annual |
| Median age, share 65+ by county | Census population estimates | panel, county map | annual |
| New homes permitted by state (per 1,000 residents and total), since 1980 | Census Building Permits Survey | panel, US map | annual |
| New business applications by state | Census Business Formation Statistics | panel, US map | monthly |
| Major disaster declarations per year, by type; running total by county since 1965 | FEMA OpenFEMA | time series; county map | daily source |
| Natural hazard risk by county: overall, wildfire, hurricane, heat, inland flooding | FEMA National Risk Index (FEMA's ArcGIS service) | county map | periodic |
| Global temperature since 1880 | NASA GISS GISTEMP v4 | time series | monthly |
| Days with unhealthy air by county | EPA Air Quality System | panel, county map | annual |
| Food and drug recalls by severity | FDA openFDA | time series | monthly |
| Forest cover by country | World Bank / UN FAO | panel, world map | annual |
| Presidential results by county and state, 2000-2024 | MIT Election Data + Science Lab (CC0), from state election offices | panel, county and state maps | every four years |
| Violent crime, property crime and homicide rates by state, 1985 to last year | FBI Crime Data Explorer (needs the `API_DATA_GOV_KEY` secret; built in CI) | panel, US map | annual |
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

## Pending access

| Source | Status |
|---|---|
| USDA (ERS county data, NASS) | ERS bulk files next; NASS Quick Stats needs its own free key |
| USAID / foreign aid | USAID's programs moved to the State Department in 2025; ForeignAssistance.gov still publishes obligations by country and is the candidate source |
| FCC broadband | Very large location-level files; needs pre-aggregation to county |

Every federal publisher on data.gov (62 agencies) is listed in Sources → Federal with a search button, so agency data without a ready-made dataset is still reachable.

## Elections

Election results get extra safeguards:

- **Takeaway counts voters, not just places.** It reports how many places each side led *and* the share of votes cast in them, for example: Republicans led 2,658 counties holding 51% of the votes cast; Democrats led 444 holding 49%. That corrects the sea-of-one-color effect of shaded maps.
- **"Land area is not voters" trust check** on every election map.
- **Margins in plain notation** ("D+4.4", "R+1.5"), on a red/blue two-sided scale with gray at even.
- **Data cleaning:**
  - Summary rows (total votes cast, undervotes, overvotes, spoiled ballots) are excluded. Counting them doubled the 2024 totals in SC, TX, WI and WV.
  - Alaska's house districts are kept out of the county view.
- **Verified against certified results:** national margins 2000-2024, PA, TX, WI, WV.
- **One-time download.** The data is downloaded once through Harvard Dataverse's guestbook. Rebuild with `ELECTIONS_FILE=<path> node scripts/refresh-data.mjs elections`.

## Keeping the story true (claim check)

Creators can write their own title, subtitle, takeaway, voiceover and notes, but not ones the data contradicts. `public/js/integrity.js` checks every sentence they type and **pauses export** when it finds:

| Problem | Example that is blocked |
|---|---|
| A number that appears nowhere in the data or its computed facts | "The debt hit $90 trillion" |
| A "now / currently / hits" figure that isn't the latest value (latest two releases count) | "Unemployment is now 12%" |
| A direction the data contradicts, over the shown range or "since YYYY" | "Gas prices fell since 2020" ($2.58 → $4.15) |
| Doubled / tripled / halved that the numbers don't support | "Home prices doubled since 2015" (1.36×) |
| A record that isn't one, judged on the full history even when the chart is cropped | "2025 was a record hot year" (record: 2024) |

Places named in a sentence are checked against that place ("California unemployment hits 9%" vs. California's 5.1%). Cause-and-effect wording ("because of tariffs") is a warning, since the data shows what happened, not why. Each block comes with a one-click fix (use the computed takeaway, restore the suggested title).

Context that can't be removed is stamped into the source line of every export: a cropped time range ("Shows 2015-2020 of the 1948-2026 record", plus a note when the full record shows the opposite trend), a zoomed axis, and "Data provided by the creator; not verified by Civic Charts" for uploads. Share links carry settings only and rebuild the chart from the official data, so anyone can check a chart against its source.

Someone determined to mislead can still edit a file in another app. The goal is that Civic Charts is never the easy way to do it.

## Sharing

- **Sizes**
  - 9:16 for TikTok, Instagram and Facebook Reels and Stories, and YouTube Shorts
  - 4:5 feed for Facebook, LinkedIn and Instagram
  - 1:1 for LinkedIn, X and Threads
  - 16:9 for YouTube, slides, web and broadcast
  - 3:2 for blogs, newsletters and reports
  - 1.91:1 link preview (1200×628) for LinkedIn, Facebook and X
  - 2:3 for Pinterest
- **9:16 safe area:** content stays out of the union of every vertical platform's overlays (organic posts): top 13% for tabs and the Stories profile and progress bar, right 14% for the like, comment and share buttons, bottom 25% for the caption, username, sound and reply bar. Stills get the same margins, since Stories and TikTok photo posts are covered too. The "Safe zones" toggle under the preview labels each area. Paid ads add a CTA button and need more bottom room (about 35%).
- **LinkedIn carousel:** a 4-page PDF document post. The pages are the chart, what the data shows, how to read it, and sources & method.
- **Post text:** a version for each platform (LinkedIn, Facebook, X, Instagram, TikTok), with hashtags by topic, plus alt text.
- **Captions file:** `.srt` captions for video, timed to match the burned-in captions. LinkedIn and Facebook accept them as uploads.
- **PNG metadata:** exports carry title, description, source, source URL and the share link as embedded text. Platforms strip this on upload, so it is for provenance, not reach.
- **Share to apps:** on phones and Safari, the system share sheet sends the file and text straight to installed apps. Elsewhere, the post text is copied and the platform's composer opens.

## Finding data

- **Popular** (the default tab): 16 plain-language questions ("How big is the national debt?", "Are prices still rising?"), each with its latest number and source, one tap to a ready-made chart. Picking a state turns state and county questions local. The list lives in `FEATURED` in `scripts/sources/catalog.mjs`. A "New data in the last two weeks" row appears when a dataset gets a new observation; the refresh job records when each dataset's latest observation first appeared (`released` in the catalog).
- **Search**: ready-made datasets filter as you type, with synonyms (jobs, taxes, murder, climate…), area (national, states, counties, world), topic, and sort by best match or most recent data. Press Search to also query data.gov and every state and local portal.
- **Topics** and **Sources** browse the same data by subject or publisher.
- **External results are ranked by what "Load data" will actually get**: current, downloadable tables first. Files older than 5 years sink and say "Last updated 2011; may be out of date"; entries that point at API documentation instead of a file sink and show "No data file". Raw layer names are tidied (`Iowa_Broadband_v5` → "Iowa Broadband v5"), and data.gov copies of state datasets are shown once.

**Budget balances** (deficit data) are written as "a $1.99T deficit", never "-$1.99T"; a bigger deficit counts as growth in the claim check, and "doubled" from a surplus is blocked. Fiscal years read "FY2026" (October 2025 to September 2026).

## Analytics (GA4)

Off until a measurement ID is set: `window.CC_GA_ID = 'G-…'` in `public/index.html`. Everything measured is in `public/js/analytics.js` and the `PS.track(...)` calls in the app. No Google signals, no ad personalization; EEA/UK/Swiss visitors start with analytics storage denied. Share-link settings (the `#c=` hash) are never sent.

| Event | When | Key parameters |
|---|---|---|
| `page_view` | every visit | `entry_type` (direct, share_link, embed), `embed_host` (the site an embed sits on) |
| `select_dataset` | a dataset is picked | `dataset_id`, `via` (popular, topics, sources, search, lens, chart) |
| `search` | search submitted, or typing pauses | `search_term`, `search_scope`, `results` |
| `select_chart` / `select_size` / `select_state` | chart type, size or state changed | `chart_type`, `size`, `state` |
| `add_compare` | an overlay dataset is added | `compare_id` |
| `export` | any download | `export_kind` (video, image, slides, brief, carousel, data_csv, captions, project) |
| `share` | share sheet, composer, copy link, embed code | `method` |
| `copy` | post text or alt text copied | `what`, `network` |
| `export_blocked` | the claim check stopped an export | `blocked_checks` |
| `load_external` / `upload_data` | data loaded from a portal, or a CSV uploaded | `publisher_host`, `platform` |

To exclude your own visits, open `https://civiccharts.com/?notrack=1` once in each browser and device (stored in that browser; `?notrack=0` undoes it).

Every event also carries `dataset_id`, `chart_type`, `size` and `format`. To report on these in GA4, register them under Admin → Custom definitions → Create custom dimension (scope: Event).

The link-preview card (`public/og.png`, 2400×1260) is rendered from `scripts/og-card.html`.

## Presentations, reports and websites

- **PowerPoint (.pptx):** a 16:9 deck. Slide 1 is the chart exactly as exported (title, source line and stamps included). The rest are editable: what the data shows, how to read it, and sources and method. Every slide's speaker notes carry the takeaway, facts, cautions and sources, so the context travels with the presenter. Opens in PowerPoint, Keynote and Google Slides. Exported MP4s can be dropped onto a slide for the animated version.
- **One-page brief (PDF):** US Letter, real selectable text: the chart at 3:2, what it shows, how to read it, what to keep in mind, and the source with a link. Text is measured first and the chart shrinks if needed, so it always fits on one page.
- **Data (CSV):** every number behind the current chart (respecting the chosen range, focus and overlays), with the title, source, URL and retrieval date as `#` lines on top.
- **Embed:** an `<iframe>` of the share link with `?embed=1`. It shows only the chart and player, plus a live-data line and an "Open in Civic Charts" link. It rebuilds from the latest data on every visit, and if the creator's text no longer matches a newer release, it says so on the embed. Phone sizes embed as 16:9.

All of these go through the same claim check as images and video.

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
3. A static site can't search data.gov directly because the catalog sends no CORS headers. The live site uses `worker/proxy.js` on Cloudflare Workers (free tier) at `https://plainsight-proxy.misty-brook-457e.workers.dev/`, set as `window.PS_PROXY` in `public/index.html`. To redeploy after editing it: `npx wrangler deploy worker/proxy.js --name plainsight-proxy --compatibility-date 2024-09-01`. The local `server.js` has the same proxy built in and does not use the Worker.

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
