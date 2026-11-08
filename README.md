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
| GDP by country, 1960 to now | World Bank | panel, world map | annual |
| Life expectancy by country | World Bank / UN | panel, world map | annual |

To add a source, write one builder function in `scripts/refresh-data.mjs` that returns one of the three shapes. Charts, explanations and trust checks work automatically.

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
