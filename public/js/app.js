// Civic Charts app: state, step panels, preview loop, export.
(function (PS) {
  const $ = s => document.querySelector(s);
  const esc = PS.esc;
  const canvas = $('#canvas');
  const renderer = new PS.Renderer(canvas);
  PS._renderer = renderer; // handle for tests and debugging

  const S = {
    compareDs: new Map(), combo: null, comboKey: '', picker: null,
    catalog: [], ds: null, step: 'data', dataTab: 'popular', topic: 'all', sourceOpen: null,
    state: (() => { try { return localStorage.getItem('ps-state') || ''; } catch { return ''; } })(), playing: false, p: 1, t0: 0,
    analysis: null, audio: null, imported: null, search: { q: '', geo: 'any', topic: '', sort: 'relevance', scope: 'all', org: null, orgName: '', results: [], busy: false, err: '', info: '' }, exporting: false, custom: [],
  };
  const DEFAULTS = {
    chart: 'line', platform: 'vertical', format: 'video', duration: 20, theme: 'newsroom', palette: 'plainsight',
    customColors: ['#1d4e89', '#e4572e', '#29a36a', '#f2a541', '#7d5ba6', '#5c5c5c'], ramp: 'auto', headFont: 'theme', bodyFont: 'theme',
    accent: '', bg: '', bgGradient: false, radius: 6, lineWidth: 5, grid: 'light', textScale: 1, annotate: true, zeroBase: true,
    series: [], entities: [], topN: 10, highlight: '', sortAsc: false, rangeStart: null, rangeEnd: null, handle: '', brand: true,
    motion: 'steady', takeaway: true, takeawayText: '', captions: true, script: '', scriptEdited: false, voice: '', speakPreview: false,
    kicker: '', title: '', subtitle: '', note: '', colorZero: false, focus: '', compareNational: true, titleEdited: false, minPop: 0, scope: '', compare: [], combineMethod: '',
  };
  let o = { ...DEFAULTS };
  PS.DEFAULT_OPTIONS = DEFAULTS;
  // What the dataset itself suggests (left out of share links, recomputed on open).
  const autoOpts = () => ({ title: autoTitle(S.ds), subtitle: autoSubtitle(S.ds), chart: PS.defaultChart(S.ds), titleEdited: false, zeroBase: !S.ds?.zeroLine, minPop: S.ds?.geo === 'us-counties' && S.ds?.isRate ? 5000 : 0, highlight: o.focus, focus: o.focus });

  // ---------- helpers ----------
  const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); };
  const yearOf = t => new Date(t).getUTCFullYear();
  function timeBounds(ds) {
    if (!ds) return null;
    if (ds.kind === 'timeseries') { const all = ds.series.flatMap(s => s.pts); return [Math.min(...all.map(p => p.t)), Math.max(...all.map(p => p.t))]; }
    if (ds.kind === 'panel') return [ds._tms[0], ds._tms.at(-1)];
    return [ds.events[0]?.tm, ds.events.at(-1)?.tm];
  }
  function autoSubtitle(ds) {
    const [a, b] = timeBounds(ds) || [];
    if (ds.kind === 'events') return `${ds.unit.label} 2.5 and above, ${PS.fmtDate(a, 'daily')} to ${PS.fmtDate(b, 'daily')}`;
    const range = ds.singleTime ? '' : yearOf(a) === yearOf(b) ? `, ${yearOf(a)}` : `, ${yearOf(o.rangeStart ?? a)}–${yearOf(o.rangeEnd ?? b)}`;
    return `${ds.unit.label}${range}`;
  }
  const comboOpts = () => ({ ...o, focus: o.focus || stateInfo()?.fips || '' });
  const stateInfo = () => { const r = PS.STATE_LIST.find(x => x[0] === S.state); return r ? { code: r[0], fips: r[1], name: r[2] } : null; };
  function autoTitle(ds) {
    const st = stateInfo();
    if (o.focus && st && o.chart === 'line') return `${ds.title.replace(/ by state$/i, '')} in ${st.name}`;
    if (st && ds.geo === 'us-counties') return `${ds.title} in ${st.name}`;
    return ds.title;
  }
  function palette() {
    const T = PS.THEMES[o.theme];
    return o.palette === 'custom' ? o.customColors : PS.PALETTES[o.palette][T.mode === 'dark' ? 'dark' : 'colors'];
  }
  function colorsInUse() {
    if (!S.ds) return 1;
    if (o.chart === 'line' && S.ds.kind === 'timeseries') return Math.max(1, (o.series.length || S.ds.defaultSeries?.length || 1));
    if (o.chart === 'line') return Math.max(1, o.entities.length || 3);
    if (o.chart === 'barrace' && !o.highlight) return Math.min(palette().length, 8);
    return 1;
  }

  // County datasets with a state chosen: only that state's counties, with short names.
  function viewOf(ds) {
    const st = stateInfo();
    if (ds.geo !== 'us-counties' || !st) { o.scope = ''; return ds; }
    o.scope = st.fips;
    const entities = ds.entities.filter(e => e.id.startsWith(st.fips)).map(e => ({ ...e, name: e.short || e.name }));
    return entities.length ? { ...ds, entities, scopeName: st.name } : ds;
  }
  async function ensureGeo(kind) {
    if (PS.geoReady(kind)) return;
    await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/geo-counties.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the county map.')); document.head.appendChild(sc); });
  }

  // ---------- core update ----------
  function update({ relayout = true, panels = true } = {}) {
    if (!S.ds) return;
    let ds = viewOf(S.ds);
    // Overlay: combine the main dataset with the ones chosen to compare.
    S.combo = null; S.comboDs = null;
    if (o.compare.length) {
      const parts = [ds, ...o.compare.map(id => S.compareDs.get(id)).filter(Boolean).map(viewOf)];
      const oo = comboOpts();
      const cmp = PS.compatibility(parts.slice(0, -1), parts.at(-1), oo);
      if (cmp.ok) {
        const method = cmp.methods.find(m => m.id === o.combineMethod) || cmp.methods[0];
        ds = PS.combine(parts, method.id, oo);
        S.comboDs = ds;
        S.combo = { methods: cmp.methods, method: method.id };
        o.chart = { shared: 'line', indexed: 'line', stacked: 'stacked', scatter: 'scatter' }[method.id];
        if (method.id === 'indexed') o.zeroBase = false;
        if (S.comboKey !== ds.id) {
          S.comboKey = ds.id;
          if (!o.titleEdited) o.title = ds.title;
          o.subtitle = method.id === 'scatter' ? `Each dot is a ${{ 'us-states': 'state', 'us-counties': 'county', world: 'country' }[ds.geo]}, ${ds.years[0]}${ds.years.length > 1 ? '–' + ds.years.at(-1) : ''}`
            : method.id === 'indexed' ? `${ds.unit.label}`
            : `${method.id === 'stacked' ? 'Shared timeline' : ds.unit.label}, ${yearOf(ds.window[0])}–${yearOf(ds.window[1])}`;
          o.takeawayText = ''; o.scriptEdited = false;
        }
      } else { o.compare = []; toast(cmp.reason); }
    } else S.comboKey = '';
    const T = PS.THEMES[o.theme];
    const pc = PS.checkPalette(palette(), o.bg || T.bg, colorsInUse());
    S.analysis = PS.analyze(ds, { ...o, paletteCheck: colorsInUse() > 1 ? pc : null });
    if (!o.scriptEdited) o.script = S.analysis.script;
    // Claim check: the creator's own words must not contradict the data.
    S.integrity = PS.checkClaims(ds, S.analysis, { ...o, _autoSubtitle: autoSubtitle(S.ds), _autoTitle: autoTitle(S.ds), focus: o.focus || (stateInfo()?.fips && ds.geo === 'us-states' ? stateInfo().fips : '') }, S.ds);
    S.analysis.checks = [...S.integrity.blocks.map(b => ({ level: 'block', title: b.title, detail: b.detail, fixAct: b.fix })), ...S.integrity.warns.map(w => ({ level: 'warn', title: w.title, detail: w.detail })), ...S.analysis.checks];
    const platform = PS.PLATFORMS[o.platform];
    renderer.setScene({
      ds, platform, analysis: S.analysis, script: o.script, fullRange: timeBounds(S.ds),
      o: { ...o, static: o.format === 'image', title: o.title || ds.title, subtitle: o.subtitle },
    });
    if (!S.playing) renderer.draw(S.p);
    if (panels) renderInsight();
    $('#timeLbl').textContent = o.format === 'image' ? 'Image' : `${(S.p * o.duration).toFixed(1)}s / ${o.duration}s`;
  }

  // ---------- playback ----------
  let audioCtx, audioSrc;
  function play(from = 0) {
    if (o.format === 'image') { toast('Switch format to Video to preview animation.'); return; }
    S.playing = true; S.p = from; S.t0 = performance.now() - from * o.duration * 1000;
    $('#playBtn').textContent = '❚❚'; $('#playBtn').setAttribute('aria-label', 'Pause');
    if (from === 0) {
      if (S.audio?.buffer) {
        audioCtx = audioCtx || new AudioContext();
        audioSrc = audioCtx.createBufferSource(); audioSrc.buffer = S.audio.buffer; audioSrc.connect(audioCtx.destination); audioSrc.start();
      } else if (o.speakPreview) PS.speak(o.script, { voice: o.voice, duration: o.duration });
    }
    requestAnimationFrame(loop);
  }
  function pause() {
    S.playing = false; $('#playBtn').textContent = '▶'; $('#playBtn').setAttribute('aria-label', 'Play');
    PS.stopSpeaking(); try { audioSrc?.stop(); } catch { } audioSrc = null;
  }
  function loop(now) {
    if (!S.playing || S.exporting) return;
    S.p = Math.min(1, (now - S.t0) / (o.duration * 1000));
    renderer.draw(S.p);
    $('#scrub').value = Math.round(S.p * 1000);
    $('#timeLbl').textContent = `${(S.p * o.duration).toFixed(1)}s / ${o.duration}s`;
    if (S.p >= 1) { pause(); return; }
    requestAnimationFrame(loop);
  }
  $('#playBtn').onclick = () => (S.playing ? pause() : play(S.p >= 1 ? 0 : S.p));
  $('#scrub').oninput = e => { pause(); S.p = e.target.value / 1000; renderer.draw(S.p); $('#timeLbl').textContent = `${(S.p * o.duration).toFixed(1)}s / ${o.duration}s`; };
  $('#safeToggle').onchange = e => { o.showSafe = e.target.checked; update({ panels: false }); };

  // ---------- platforms ----------
  function renderPlatforms() {
    $('#platforms').innerHTML = Object.entries(PS.PLATFORMS).map(([id, p]) =>
      `<button class="chip ${o.platform === id ? 'active' : ''}" data-platform="${id}" title="${esc(p.name)}">${p.ratio}<small>${esc(p.name.split(' / ')[0].split(' (')[0])}</small></button>`).join('');
  }
  $('#platforms').onclick = e => {
    const b = e.target.closest('[data-platform]'); if (!b) return;
    PS.track('select_size', { size: b.dataset.platform });
    const was = PS.PLATFORMS[o.platform].dur;
    o.platform = b.dataset.platform;
    if (o.duration === was) o.duration = PS.PLATFORMS[o.platform].dur;
    renderPlatforms(); update(); if (S.step === 'export') renderStep();
  };

  // ---------- dataset selection ----------
  async function selectDataset(id, { keepStory = false } = {}) {
    pause();
    let ds = S.custom.find(d => d.id === id);
    if (!ds) { try { ds = await PS.loadDataset(id); } catch (e) { toast(e.message); return; } }
    if (ds.geo) { try { await ensureGeo(ds.geo); } catch (e) { toast(e.message); return; } }
    S.ds = ds;
    const charts = PS.chartsFor(ds).map(c => c.id);
    o.chart = charts.includes(o.chart) && keepStory ? o.chart : PS.defaultChart(ds);
    Object.assign(o, { series: [], entities: [], highlight: '', rangeStart: null, rangeEnd: null, takeawayText: '', scriptEdited: false, titleEdited: false, compare: [], combineMethod: '' });
    S.picker = null;
    // A chosen state localizes every state-level dataset: highlighted on maps and
    // bars, and compared with the U.S. on line charts.
    const st = stateInfo();
    o.focus = st && ds.geo === 'us-states' && ds.entities.some(e => e.id === st.fips) ? st.fips : '';
    o.highlight = o.focus;
    if (o.focus && ds.national && !keepStory) o.chart = 'line';
    o.minPop = ds.geo === 'us-counties' && ds.isRate ? 5000 : 0;
    o.title = autoTitle(ds); o.subtitle = autoSubtitle(ds); o.kicker = '';
    o.zeroBase = !(ds.kind === 'timeseries' && ds.unit.format === 'usd' && false);
    if (ds.zeroLine) o.zeroBase = false;
    S.p = o.format === 'image' ? 1 : 1;
    $('#freshness').textContent = `${ds.source.publisher.replace(/^U\.S\. /, '')} · data through ${PS.fmtDate(ds.lastObservation, ds.frequency === 'real-time' ? 'daily' : ds.frequency)}`;
    update(); renderStep();
  }

  // ---------- steps ----------
  document.querySelector('.steps').onclick = e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    S.step = b.dataset.step; renderStep();
  };
  function renderStep() {
    document.querySelectorAll('.steps button').forEach(b => b.classList.toggle('active', b.dataset.step === S.step));
    $('#stepBody').innerHTML = STEPS[S.step]();
    $('#controls').scrollTop = 0;
    AFTER[S.step]?.();
  }

  const field = (label, inner, out = '') => `<div class="field"><label>${label}${out ? `<output>${out}</output>` : ''}</label>${inner}</div>`;
  const check = (k, label) => `<label class="chk"><input type="checkbox" data-k="${k}" ${o[k] ? 'checked' : ''}> ${label}</label>`;
  const range = (k, min, max, step = 1) => `<input type="range" data-k="${k}" data-num min="${min}" max="${max}" step="${step}" value="${o[k]}">`;
  const select = (k, opts) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(o[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  const STEPS = {};
  const AFTER = {};

  const TIER_BADGE = { federal: 'Federal', state: 'State', local: 'Local', academic: 'Academic', nonprofit: 'Nonprofit', industry: 'Company', international: 'Intl.' };
  const tierBadge = t => `<span class="badge tier-${t || 'federal'}">${TIER_BADGE[t] || 'Federal'}</span>`;
  const PLATFORM_NAME = { socrata: 'Socrata', ckan: 'CKAN', arcgis: 'ArcGIS Hub', 'arcgis-org': 'ArcGIS Online', website: 'Website', unknown: 'Not yet checked' };
  const fmtThrough = c => PS.fmtDate(c.lastObservation, c.frequency === 'real-time' ? 'daily' : c.frequency);

  function dsCard(c) {
    const st = stateInfo();
    const active = S.ds && (S.ds.id === c.id || c.reframes?.includes(S.ds.id));
    const kind = c.kind === 'events' ? '<span class="badge live">Live</span>' : c.geo ? '<span class="badge">Map</span>' : c.kind === 'panel' ? '<span class="badge">Compare</span>' : '';
    const local = st && c.geo === 'us-states' ? `<span class="local">Shows ${esc(st.name)}${c.hasNational ? ' vs. U.S.' : ''}</span>` : st && c.geo === 'us-counties' ? `<span class="local">Zooms to ${esc(st.name)}'s counties</span>` : '';
    return `<button class="ds ${active ? 'active' : ''}" data-ds="${c.id}"><b>${esc(c.title)}${kind}${tierBadge(c.tier)}</b><span>${esc(c.source.publisher)} · ${esc(latestText(c))}</span>${local}</button>`;
  }
  // "$40.56T · Nov 5, 2026", "$1.99T deficit · FY2026", "U.S.: 4.2% · Sep 2026"
  function latestText(c) {
    const L = c.latest, u = c.unit || {};
    if (L && Number.isFinite(L.v)) {
      const sw = u.signWords;
      const val = sw ? `${PS.fmt(Math.abs(L.v), u)}${sw.of || ''} ${L.v < 0 ? sw.neg : sw.pos}` : PS.fmt(L.v, u);
      const who = c.kind === 'panel' ? (/united states/i.test(L.series || '') ? 'U.S.: ' : '') : '';
      return `${who}${val} · ${fmtThrough({ ...c, lastObservation: L.t })}`;
    }
    if (c.kind === 'events') return `${(c.nEvents || 0).toLocaleString()} events · through ${fmtThrough(c)}`;
    const geoWord = { 'us-states': 'states', 'us-counties': 'counties', world: 'countries' }[c.geo];
    return geoWord && c.nEntities ? `${c.nEntities.toLocaleString()} ${geoWord} · ${fmtThrough(c)}` : `through ${fmtThrough(c)}`;
  }

  // ---------- ready-made dataset search (instant, local) ----------
  const SYN = { jobs: ['unemploy', 'employ', 'job'], job: ['unemploy', 'employ'], work: ['unemploy', 'employ', 'job'], prices: ['inflation', 'price'], cpi: ['inflation'], cost: ['price', 'inflation'],
    spending: ['outlay', 'spending'], taxes: ['revenue', 'receipt'], tax: ['revenue', 'receipt'], borrowing: ['debt', 'deficit'], budget: ['deficit', 'budget', 'debt'],
    homes: ['home', 'housing'], housing: ['home', 'house', 'mortgage', 'permit'], rent: ['home', 'housing'], climate: ['temperature', 'co2', 'warming', 'heat'], warming: ['temperature'],
    crime: ['crime', 'homicide'], murder: ['homicide'], vote: ['president', 'election'], voting: ['president', 'election'], election: ['president', 'election'], elections: ['president', 'election'],
    drugs: ['overdose', 'drug'], opioid: ['overdose'], money: ['income'], wages: ['income', 'wage'], pay: ['income', 'wage'], salary: ['income', 'wage'], moving: ['migration'], movers: ['migration'],
    disaster: ['disaster', 'risk', 'fema'], weather: ['disaster', 'heat', 'hurricane', 'flood'], storms: ['hurricane', 'disaster'], fire: ['wildfire'], gdp: ['gdp'], interest: ['interest', 'mortgage'],
    old: ['65', 'age'], elderly: ['65', 'age'], seniors: ['65'], poor: ['poverty'], insurance: ['uninsured'], pollution: ['air', 'co2'], quake: ['earthquake'], internet: ['broadband', 'internet'], wifi: ['broadband', 'internet'], online: ['broadband', 'internet'], connectivity: ['broadband'] };
  const GEO_WORDS = { 'us-states': 'state states by-state', 'us-counties': 'county counties local', world: 'world country countries global international' };
  function hay(c) {
    if (c._hay) return c._hay;
    const topic = PS.REGISTRY?.topics.find(t => t.id === c.topic);
    const lo = x => String(x || '').toLowerCase();
    c._hay = { title: lo(c.title + ' ' + (c.lens || '')), rest: lo([c.id, c.description, c.category, topic?.name, c.source?.publisher, c.source?.dataset, c.unit?.label, (c.howToRead || []).join(' '), GEO_WORDS[c.geo] || 'national united states u.s.', c.frequency].join(' ')) };
    return c._hay;
  }
  function searchLocal(q, { geo = 'any', topic = '', sort = 'relevance' } = {}) {
    const toks = q.toLowerCase().replace(/[^\w\s.%-]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !['the', 'of', 'in', 'and', 'for', 'by', 'us', 'u.s.', 'how', 'what', 'is'].includes(t));
    const geoOk = c => geo === 'any' || (geo === 'national' ? !c.geo : c.geo === geo);
    let out = [];
    for (const c of S.catalog) {
      if (!geoOk(c) || (topic && c.topic !== topic)) continue;
      const h = hay(c); let score = 0, ok = true;
      for (const t of toks) {
        const alts = [t, ...(SYN[t] || []), t.endsWith('s') ? t.slice(0, -1) : null].filter(Boolean);
        const inTitle = alts.some(a => h.title.includes(a)), inRest = inTitle || alts.some(a => h.rest.includes(a));
        if (!inRest) { ok = false; break; }
        score += inTitle ? 3 : 1;
      }
      if (ok) out.push({ c, score: score + (c.reframes && c.reframes[0] !== c.id ? -0.5 : 0) });
    }
    if (sort === 'updated' || !toks.length) out.sort((a, b) => String(b.c.lastObservation).localeCompare(String(a.c.lastObservation)));
    else out.sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title));
    return out.map(x => x.c);
  }
  function localResultsHTML() {
    const sc = S.search, list = searchLocal(sc.q, sc);
    const head = `<p class="muted local-count"><b>${list.length}</b> of ${S.catalog.length} ready-made datasets${sc.q ? ` match "${esc(sc.q)}"` : ''}. Verified sources, updated automatically.</p>`;
    return head + (list.length ? list.slice(0, 40).map(dsCard).join('') : '<p class="muted">No ready-made dataset matches. Search data.gov and state portals below.</p>');
  }
  const heads = list => list.filter(c => !c.reframes || c.reframes[0] === c.id);
  function lensHTML() {
    if (!S.ds?.reframes) return '';
    return `<div class="lens"><p><b>Same data, different lens.</b> The lens changes the story; pick the one that answers the question honestly.</p><div class="chips">${S.ds.reframes.map(id => { const c = S.catalog.find(x => x.id === id); return c ? `<button class="chip ${S.ds.id === id ? 'active' : ''}" data-ds="${id}">${esc(c.lens || c.title)}</button>` : ''; }).join('')}</div></div>`;
  }
  const LEVEL_NAME = { city: 'City', county: 'County', 'city-county': 'City & county', regional: 'Regional', district: 'District' };
  function portalChips(code, which = 'state') {
    const ps = PS.statePortals(code).filter(p => (which === 'local') === (p.scope === 'local'));
    if (!ps.length && which === 'local') return '';
    if (!ps.length) return '<p class="muted">No portals registered yet.</p>';
    return `<div class="portal-list">${ps.map(p => `<a class="portal" href="${esc(p.url)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b><span>${p.level ? esc(LEVEL_NAME[p.level] || '') + ' · ' : ''}${esc(p.platform === 'arcgis-org' ? 'ArcGIS Online' : (p.host || new URL(p.url).hostname))} · ${PLATFORM_NAME[p.platform] || 'Not yet checked'}${p.datasets ? ` · ${p.datasets.toLocaleString()} datasets` : ''}${p.scope === 'specialized' ? ' · GIS/agency' : ''}</span></a>`).join('')}</div>`;
  }

  STEPS.data = () => {
    const st = stateInfo();
    const stateSel = `<div class="state-pick"><label for="statePick">Your state</label><select id="statePick"><option value="">All states (national view)</option>${PS.STATE_LIST.map(([c, , n]) => `<option value="${c}" ${S.state === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      ${st ? `<p class="muted state-note">State-level charts now highlight ${esc(st.name)} and compare it with the U.S.</p>` : ''}`;
    const tabs = `<div class="tabs">${[['popular', 'Popular'], ['topics', 'Topics'], ['sources', 'Sources'], ['search', 'Search'], ['upload', 'Upload']].map(([k, l]) => `<button data-tab="${k}" class="${S.dataTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    let body = '';
    const reg = PS.REGISTRY;

    if (S.dataTab === 'popular') {
      const byId = new Map(S.catalog.map(c => [c.id, c]));
      const week = Date.now() - 14 * 864e5;
      const fresh = S.catalog.filter(c => c.released && Date.parse(c.released) > week).sort((a, b) => b.released.localeCompare(a.released)).slice(0, 6);
      if (fresh.length) body += `<div class="ds-group"><h3>New data in the last two weeks</h3>${fresh.map(dsCard).join('')}</div>`;
      const picks = (reg?.featured || []).map(f => ({ ...f, c: byId.get(f.id) })).filter(f => f.c);
      body += `<div class="ds-group"><h3>Popular questions</h3><p class="muted tier-desc">Pick a question. Each one opens a ready-made chart from an official source, kept up to date.</p><div class="pop-grid">${picks.map(({ q, c }) => {
        const active = S.ds && (S.ds.id === c.id || c.reframes?.includes(S.ds.id));
        const local = st && c.geo === 'us-states' ? `For ${esc(st.name)}` : st && c.geo === 'us-counties' ? `${esc(st.name)} counties` : '';
        return `<button class="pop ${active ? 'active' : ''}" data-ds="${c.id}"><b>${esc(st && c.geo ? q.replace('your state', st.name).replace('your county', `your ${st.name} county`) : q)}</b><span class="pop-val">${esc(latestText(c))}</span><span class="pop-src">${esc(c.source.publisher)}${local ? ' · ' + local : ''}</span></button>`;
      }).join('')}</div></div>`;
      body += `<button class="btn block" data-tab="search">Search all ${S.catalog.length} ready-made datasets, plus data.gov and state portals</button>`;
    }

    else if (S.dataTab === 'topics') {
      const topics = (reg?.topics || []).map(t => ({ ...t, n: heads(S.catalog).filter(c => c.topic === t.id).length })).filter(t => t.n);
      body += `<div class="chips topic-chips"><button class="chip ${S.topic === 'all' ? 'active' : ''}" data-topic="all">All</button>${topics.map(t => `<button class="chip ${S.topic === t.id ? 'active' : ''}" data-topic="${t.id}">${esc(t.name)} <small>${t.n}</small></button>`).join('')}</div>`;
      body += lensHTML();
      let list = heads(S.catalog).filter(c => S.topic === 'all' || c.topic === S.topic);
      const rank = c => (c.geo === 'us-counties' ? 0 : c.geo === 'us-states' ? 1 : 2);
      if (st) list = [...list].sort((a, b) => rank(a) - rank(b));
      const groups = {};
      list.forEach(c => { const g = st && c.geo === 'us-counties' ? `${st.name} counties` : st && c.geo === 'us-states' ? `${st.name} & the U.S.` : (reg?.topics.find(t => t.id === c.topic)?.name || c.category); (groups[g] ||= []).push(c); });
      if (S.custom.length && S.topic === 'all') groups['Your data'] = S.custom;
      body += Object.entries(groups).map(([g, l]) => `<div class="ds-group"><h3>${esc(g)}</h3>${l.map(dsCard).join('')}</div>`).join('');
      if (st) {
        const t = reg?.topics.find(x => x.id === S.topic);
        const localChips = portalChips(st.code, 'local');
        body += `<div class="ds-group"><h3>From ${esc(st.name)}'s government</h3>${portalChips(st.code)}${localChips ? `<h3>Cities, counties & regions in ${esc(st.name)}</h3>${localChips}` : ''}
          <button class="btn block" data-act="portalBrowse" data-q="${esc(t ? t.kw[0] : '')}">Browse ${esc(st.name)} datasets${t ? ' about ' + esc(t.name.toLowerCase()) : ''}</button></div>`;
      }
      if (S.ds?.id === 'earthquakes') body = `<button class="btn block" data-act="live">Refresh live from USGS</button>` + body;
    }

    else if (S.dataTab === 'sources') {
      const curated = id => heads(S.catalog).filter(c => c.sourceId === id);
      const card = (src, tier) => {
        const open = S.sourceOpen === src.id, ds = curated(src.id);
        return `<div class="src ${open ? 'open' : ''}"><button class="src-head" data-src="${src.id}"><b>${esc(src.name)}</b>${tierBadge(tier)}<span>${ds.length ? `${ds.length} ready-made` : src.catalogSlug ? 'Search on data.gov' : ''}</span></button>
          ${open ? `<div class="src-body">${src.org ? `<p><b>Who:</b> ${esc(src.org)}</p>` : ''}${src.why ? `<p><b>Why it's trusted:</b> ${esc(src.why)}</p>` : ''}${src.disclosure ? `<p class="${tier === 'industry' ? 'disclose' : ''}"><b>${tier === 'industry' ? 'Disclosure' : 'Keep in mind'}:</b> ${esc(src.disclosure)}</p>` : ''}${src.note ? `<p class="muted">${esc(src.note)}</p>` : ''}
            ${ds.map(dsCard).join('')}
            ${src.catalogSlug ? `<button class="btn block" data-act="orgSearch" data-org="${esc(src.catalogSlug)}" data-name="${esc(src.name)}">Search all ${esc(src.name)} datasets on data.gov</button>` : ''}
            <a class="muted" href="${esc(src.url)}" target="_blank" rel="noopener">${esc(new URL(src.url).hostname)} ↗</a></div>` : ''}</div>`;
      };
      const tiers = reg?.tiers || [];
      body += lensHTML();
      for (const tier of tiers) {
        body += `<div class="ds-group"><h3>${esc(tier.name)}</h3><p class="muted tier-desc">${esc(tier.desc)}</p>`;
        if (tier.id === 'federal') {
          body += (reg.federal || []).map(f => card(f, 'federal')).join('');
          // Every federal publisher in the data.gov catalog, each searchable.
          const orgs = (reg.catalogOrgs || []).filter(x => x.type === 'Federal Government');
          if (orgs.length) body += `<details class="local-state"><summary>All ${orgs.length} federal publishers on data.gov <span class="muted">${orgs.reduce((a, x) => a + x.datasets, 0).toLocaleString()} datasets</span></summary><div class="portal-list">${orgs.map(x => `<button class="cmp ok" data-act="orgSearch" data-org="${esc(x.slug)}" data-name="${esc(x.name)}"><b>${esc(x.name)}</b><span>${x.datasets.toLocaleString()} datasets · search</span></button>`).join('')}</div></details>`;
        }
        else if (tier.id === 'state') {
          body += `<div class="state-grid">${reg.states.map(s => {
            const ps = s.portals.filter(p => PS.SEARCHABLE.includes(p.platform)), n = ps.reduce((a, p) => a + (p.datasets || 0), 0);
            return `<button class="state-cell ${S.state === s.code ? 'active' : ''}" data-statebrowse="${s.code}" title="${esc(s.name)}"><b>${s.code}</b><span>${ps.length ? (n ? n.toLocaleString() : 'Searchable') : s.portals.length ? 'Link' : '—'}</span></button>`;
          }).join('')}</div><p class="muted">Numbers are searchable datasets. "Link" means the portal has no search API yet and opens in a new tab.</p>`;
        }
        else if (tier.id === 'local') {
          const byState = reg.states.map(s => [s, s.portals.filter(p => p.scope === 'local')]).filter(([, ps]) => ps.length);
          body += byState.map(([s, ps]) => `<details class="local-state"><summary>${esc(s.name)} <span class="muted">${ps.length} portal${ps.length > 1 ? 's' : ''} · ${ps.filter(p => PS.SEARCHABLE.includes(p.platform)).length} searchable</span></summary>${portalChips(s.code, 'local')}<button class="btn block" data-statebrowse="${s.code}">Search ${esc(s.name)} state and local portals</button></details>`).join('');
        }
        else body += (reg.thirdParty || []).filter(x => x.tier === tier.id).map(x => card(x, tier.id)).join('') || '<p class="muted">None yet.</p>';
        body += '</div>';
      }
    }

    else if (S.dataTab === 'search') {
      const sc = S.search;
      const scopes = [['all', st ? `Everything + ${st.name}` : 'Everything'], ['datagov', 'Federal (data.gov)'], ...(st ? [['state', `${st.name} portals`]] : []), ['states', 'All state portals']];
      const topicOpts = (reg?.topics || []).filter(t => S.catalog.some(c => c.topic === t.id));
      body += `<form id="searchForm" class="row"><input type="search" id="q" placeholder="e.g. deficit, rent, overdoses, broadband" value="${esc(sc.q)}" autocomplete="off"><button class="btn primary" style="flex:none">Search</button></form>
        <div class="ds-group"><h3>Ready-made</h3>
        <div class="search-filters"><div class="chips">${[['any', 'Any area'], ['national', 'National'], ['us-states', 'States'], ['us-counties', 'Counties'], ['world', 'World']].map(([k, l]) => `<button class="chip ${sc.geo === k ? 'active' : ''}" data-geo="${k}">${l}</button>`).join('')}</div>
        <div class="row"><select id="fTopic" aria-label="Topic"><option value="">All topics</option>${topicOpts.map(t => `<option value="${t.id}" ${sc.topic === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <select id="fSort" aria-label="Sort"><option value="relevance" ${sc.sort === 'relevance' ? 'selected' : ''}>Best match</option><option value="updated" ${sc.sort === 'updated' ? 'selected' : ''}>Most recent data</option></select></div></div>
        <div id="localResults">${localResultsHTML()}</div></div>
        <h3>More from data.gov and state portals</h3><p class="muted tier-desc">Press Search to look through hundreds of thousands of government datasets. These load straight from the publisher and get the same trust checks.</p>
        <div class="chips scope-chips">${scopes.map(([k, l]) => `<button class="chip ${sc.scope === k ? 'active' : ''}" data-scope="${k}">${esc(l)}</button>`).join('')}</div>
        ${sc.org ? `<p class="muted">Limited to ${esc(sc.orgName)} <button class="linkbtn" data-act="clearOrg">clear</button></p>` : ''}
        ${st && sc.scope === 'state' ? portalChips(st.code) + portalChips(st.code, 'local') : ''}
        <div class="results">${sc.busy ? '<p class="muted">Searching…</p>' : ''}${sc.err ? `<p class="err">${esc(sc.err)}</p>` : ''}${sc.info ? `<p class="muted">${esc(sc.info)}</p>` : ''}
        ${sc.results.map((r, i) => `<div class="result"><b>${esc(r.title)}</b><div class="meta">${tierBadge(r.tier)} ${esc(r.publisher)}${r.state && !r.publisher.includes(r.state) ? ' · ' + esc(r.state) : ''}${r.modified ? ' · updated ' + esc(String(r.modified).slice(0, 10)) : ''} · ${esc(r.platform === 'data.gov' ? 'data.gov' : r.host)}</div>${r.description ? `<p>${esc(r.description)}</p>` : ''}${r.q?.flags.length ? `<div class="result-flags">${r.q.flags.map(f => `<span class="flag ${f.kind}">${esc(f.text)}</span>`).join('')}</div>` : ''}<div class="row">${r.q?.loadable === false ? '<button class="btn" disabled>No data file</button>' : `<button class="btn" data-load="${i}">Load data</button>`}<a class="muted" href="${esc(r.landing)}" target="_blank" rel="noopener" style="flex:none">Source page ↗</a></div></div>`).join('')}</div>` + mapperHTML();
    }

    else {
      body = `<p class="muted">Upload a CSV. Civic Charts detects dates, numbers, states and countries automatically. Uploaded files are labeled as unverified in the citation.</p>
        <input type="file" id="file" accept=".csv,.tsv,.txt,text/csv"><p class="muted">Tip: one row per date (and place), one column per measure.</p>` + mapperHTML();
    }
    return stateSel + tabs + body;
  };

  let searchSeq = 0;
  async function runSearch() {
    if (S.search.q) PS.track('search', { search_term: S.search.q.toLowerCase(), search_scope: S.search.scope });
    const sc = S.search, st = stateInfo(), mySeq = ++searchSeq;
    Object.assign(sc, { busy: true, err: '', info: '', results: [] }); renderStep();
    const jobs = [];
    if (sc.scope === 'all' || sc.scope === 'datagov') jobs.push(PS.searchCatalog(sc.q, null, sc.org).then(r => ({ results: r.results })).catch(e => ({ results: [], err: sc.scope === 'datagov' ? e.message : 'data.gov search needs the Civic Charts server or proxy; showing state portals only.' })));
    if (!sc.org && (sc.scope === 'state' || (sc.scope === 'all' && st))) jobs.push(PS.searchPortals(st.code, sc.q).then(r => ({ results: r.results, errs: r.errors, portals: r.portals })));
    if (!sc.org && (sc.scope === 'states' || (sc.scope === 'all' && !st))) jobs.push(PS.searchPortals(null, sc.q).then(r => ({ results: r.results, errs: r.errors, portals: r.portals })));
    const out = await Promise.all(jobs);
    if (mySeq !== searchSeq) return; // a newer search started; drop these stale results
    // State results first when a state is chosen, otherwise interleave.
    const lists = out.map(x => x.results), merged = [];
    while (lists.some(l => l.length)) lists.forEach(l => l.length && merged.push(l.shift()));
    const mine = st ? merged.filter(r => r.tier !== 'state' || r.state === st.name) : merged;
    sc.results = st && sc.scope === 'all' ? [...mine.filter(r => r.tier === 'state'), ...mine.filter(r => r.tier !== 'state')] : mine;
    // Within that order, loadable and current files first (stable sort keeps relevance otherwise).
    sc.results.forEach((r, i) => { r.q = PS.resultQuality(r); r.title = PS.tidyTitle(r.title || ''); r._i = i; });
    sc.results.sort((a, b) => a.q.score - b.q.score || a._i - b._i);
    // data.gov mirrors many state datasets; show each once (the better-ranked copy).
    const seen = new Set();
    sc.results = sc.results.filter(r => { const k = `${r.title.toLowerCase().replace(/\W+/g, ' ').trim()}|${r.state || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const errs = out.flatMap(x => (x.err ? [x.err] : []).concat(x.errs || []));
    if (errs.length) sc.info = errs[0];
    if (!sc.results.length) sc.err = sc.scope === 'state' && !out.some(x => x.portals) ? `${st.name}'s portals don't have a search API yet. Open them from the links above, or search Federal (data.gov) for ${st.name} data.` : 'No downloadable datasets matched. Try broader words.';
    sc.busy = false; renderStep();
  }

  AFTER.data = () => {
    $('#statePick')?.addEventListener('change', e => {
      S.state = e.target.value;
      PS.track('select_state', { state: S.state || 'national' });
      try { localStorage.setItem('ps-state', S.state); } catch { }
      if (S.search.scope === 'state' && !S.state) S.search.scope = 'all';
      if (S.ds && !S.ds.id.startsWith('custom-')) selectDataset(S.ds.id); else renderStep();
    });
    $('#searchForm')?.addEventListener('submit', e => { e.preventDefault(); S.search.q = $('#q').value.trim(); runSearch(); });
    // Ready-made results filter as you type; the slower external search waits for Search.
    const refreshLocal = () => { const el = $('#localResults'); if (el) el.innerHTML = localResultsHTML(); };
    // Count what people look for once they pause typing, not every keystroke.
    $('#q')?.addEventListener('input', e => {
      S.search.q = e.target.value.trim(); refreshLocal();
      clearTimeout(S.searchTimer);
      if (S.search.q.length > 2) S.searchTimer = setTimeout(() => PS.track('search', { search_term: S.search.q.toLowerCase(), search_scope: 'ready_made', results: searchLocal(S.search.q, S.search).length }), 1500);
    });
    $('#fTopic')?.addEventListener('change', e => { S.search.topic = e.target.value; refreshLocal(); });
    $('#fSort')?.addEventListener('change', e => { S.search.sort = e.target.value; refreshLocal(); });
    $('#file')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 40e6) { toast('That file is over 40 MB. Filter it first.'); return; }
      importTable(await f.text(), { title: f.name.replace(/\.[^.]+$/, ''), category: 'Your data', source: { publisher: 'Uploaded by user', dataset: f.name, unverified: true }, caveats: ['Civic Charts could not verify where this file came from. Cite the original publisher before sharing.'] });
    });
  };

  function mapperHTML() {
    const im = S.imported; if (!im) return '';
    const opt = (k, types, none) => `<select data-map="${k}">${none ? `<option value="-1">${none}</option>` : ''}${im.cols.filter(c => types.includes(c.type)).map(c => `<option value="${c.i}" ${im.map[k] === c.i ? 'selected' : ''}>${esc(c.name)} (${c.type})</option>`).join('')}</select>`;
    return `<div class="mapper"><b>${esc(im.meta.title)}</b><p class="muted">${im.table.rows.length.toLocaleString()} rows · ${im.cols.length} columns</p>
      ${field('Time', opt('time', ['date'], 'None (one moment)'))}
      ${im.cols.some(c => c.type === 'month') ? field('Month column (combined with year)', opt('month', ['month'], 'None')) : ''}
      ${im.cols.some(c => c.values && c.values.length >= 2) ? field('Only rows where', `<div class="row"><select data-map="filterCol"><option value="-1">No filter</option>${im.cols.filter(c => c.values && c.values.length >= 2).map(c => `<option value="${c.i}" ${im.map.filterCol === c.i ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>${im.map.filterCol >= 0 ? `<select data-map="filterVal">${im.cols[im.map.filterCol].values.map(v => `<option ${im.map.filterVal === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}</div><p class="muted">Use this when a file mixes totals and their parts, like a state total plus its counties.</p>`) : ''}
      ${field('Place or category', opt('category', ['county', 'countyfips', 'state', 'country', 'text'], 'None (single series)'))}
      ${field('Value', opt('value', ['number'], ''))}
      ${field('Combine duplicate rows by', `<select data-map="agg">${['sum', 'mean', 'max', 'min', 'count'].map(a => `<option ${im.map.agg === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`)}
      <button class="btn primary block" data-act="build">Build chart</button>
      <table><tr>${im.table.header.slice(0, 5).map(h => `<th>${esc(h)}</th>`).join('')}</tr>${im.table.rows.slice(0, 4).map(r => `<tr>${r.slice(0, 5).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  }

  async function importTable(text, meta) {
    if (meta.source?.unverified) PS.track('upload_data', {});
    try {
      const table = PS.parseCSV(text);
      if (!table.rows.length) throw new Error('No rows found.');
      // County matching needs the county map's name list.
      if (PS.needsCountyMap(table.header)) await ensureGeo('us-counties').catch(() => {});
      const stateFips = meta.state ? PS.STATE_LIST.find(x => x[2] === meta.state)?.[1] : null;
      if (stateFips) meta.stateFips = stateFips;
      const cols = PS.profile(table, { stateFips });
      S.imported = { table, cols, map: PS.guessMapping(cols, table), meta };
      renderStep();
    } catch (e) { toast('Could not read that file: ' + e.message); }
  }

  $('#stepBody').addEventListener('click', async e => {
    const t = e.target.closest('button, [data-ds]'); if (!t) return;
    if (t.dataset.tab) { S.dataTab = t.dataset.tab; renderStep(); if (t.dataset.tab === 'search') $('#q')?.focus(); return; }
    if (t.dataset.geo) { S.search.geo = t.dataset.geo; document.querySelectorAll('[data-geo]').forEach(b => b.classList.toggle('active', b === t)); const el = $('#localResults'); if (el) el.innerHTML = localResultsHTML(); return; }
    if (t.dataset.topic) { S.topic = t.dataset.topic; renderStep(); return; }
    if (t.dataset.captab) { S.capTab = t.dataset.captab; renderStep(); return; }
    if (t.dataset.compose) { PS.track('share', { method: t.dataset.compose, content_type: 'chart' });
      if (gate()) return;
      const text = $('#postCaption')?.value || '', link = PS.shareLink(S.ds.id, o, S.state, DEFAULTS, autoOpts());
      copy(text, 'Post text copied. Paste it into the post and attach your downloaded file.');
      window.open(PS.composerUrl(t.dataset.compose, text, link), '_blank', 'noopener');
      return;
    }
    if (t.dataset.compare) { PS.track('add_compare', { compare_id: t.dataset.compare }); o.compare.push(t.dataset.compare); o.combineMethod = ''; S.picker = null; update(); renderStep(); return; }
    if (t.dataset.uncompare) { o.compare = o.compare.filter(x => x !== t.dataset.uncompare); o.combineMethod = ''; if (!o.compare.length) { o.chart = PS.defaultChart(S.ds); o.title = autoTitle(S.ds); o.subtitle = autoSubtitle(S.ds); o.zeroBase = !S.ds.zeroLine; } update(); renderStep(); return; }
    if (t.dataset.method) { o.combineMethod = t.dataset.method; S.comboKey = ''; update(); renderStep(); return; }
    if (t.dataset.src) { S.sourceOpen = S.sourceOpen === t.dataset.src ? null : t.dataset.src; renderStep(); return; }
    if (t.dataset.scope) { S.search.scope = t.dataset.scope; if (S.search.q || t.dataset.scope !== 'datagov') runSearch(); else renderStep(); return; }
    if (t.dataset.statebrowse) {
      S.state = t.dataset.statebrowse; try { localStorage.setItem('ps-state', S.state); } catch { }
      Object.assign(S.search, { scope: 'state', q: '', org: null }); S.dataTab = 'search';
      if (S.ds && !S.ds.id.startsWith('custom-')) selectDataset(S.ds.id);
      runSearch(); return;
    }
    if (t.dataset.ds) { PS.track('select_dataset', { dataset_id: t.dataset.ds, via: t.closest('.lens') ? 'lens' : S.step === 'data' ? S.dataTab : S.step }); selectDataset(t.dataset.ds); return; }
    if (t.dataset.load != null) {
      const r = S.search.results[+t.dataset.load];
      PS.track('load_external', { publisher_host: r.platform === 'data.gov' ? 'catalog.data.gov' : r.host, platform: r.platform, tier: r.tier });
      t.disabled = true; t.textContent = 'Loading…';
      try {
        const { text, truncated } = await PS.fetchRemote(r.files[0].url);
        importTable(text, {
          title: r.title, category: r.state || 'data.gov', state: r.state || null, description: r.description, tier: r.tier,
          source: { publisher: r.publisher + (r.state && !r.publisher.includes(r.state) ? `, ${r.state}` : ''), dataset: r.title, url: r.landing, portal: r.host },
          howToRead: r.description ? [r.description.slice(0, 220)] : [],
          caveats: truncated ? ['This file is very large, so Civic Charts loaded only its first rows. Check that the chart covers the period you mean to show.'] : [],
        });
        if (truncated) toast('Large file: loaded the first 30 MB of rows.');
      } catch (err) { toast(err.message); t.disabled = false; t.textContent = 'Load data'; }
      return;
    }
    if (t.dataset.chart) { PS.track('select_chart', { chart_type: t.dataset.chart }); o.chart = t.dataset.chart; Object.assign(o, { takeawayText: '' }); if (!o.titleEdited) o.title = autoTitle(S.ds); update(); renderStep(); return; }
    if (t.dataset.theme) { o.theme = t.dataset.theme; o.bg = ''; update(); renderStep(); return; }
    if (t.dataset.pal) { o.palette = t.dataset.pal; update(); renderStep(); return; }
    if (t.dataset.ramp) { o.ramp = t.dataset.ramp; update(); renderStep(); return; }
    if (t.dataset.fmt) { o.format = t.dataset.fmt; S.p = 1; update(); renderStep(); return; }
    const act = t.dataset.act; if (!act) return;
    ACTIONS[act]?.(t);
  });

  // Export is refused while the creator's text contradicts the data.
  function gate() {
    if (!blocked()) return false;
    PS.track('export_blocked', { blocked_checks: S.integrity.blocks.map(b => b.title.split(':')[0]).join(' | ') });
    toast('Export is paused: your text doesn\'t match the data. See the trust check for fixes.');
    if (S.step !== 'export') { S.step = 'export'; renderStep(); }
    return true;
  }
  const copy = (text, msg) => (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(msg)).catch(() => toast('Select the text and copy it manually.'));
  const ACTIONS = {
    openCompare: () => openPicker(),
    closeCompare: () => { S.picker = null; renderStep(); },
    portalBrowse: t => { Object.assign(S.search, { scope: 'state', q: t.dataset.q || '', org: null }); S.dataTab = 'search'; runSearch(); },
    orgSearch: t => { Object.assign(S.search, { scope: 'datagov', q: S.search.q || '', org: t.dataset.org, orgName: t.dataset.name }); S.dataTab = 'search'; runSearch(); },
    clearOrg: () => { Object.assign(S.search, { org: null, orgName: '' }); runSearch(); },
    live: async t => {
      t.disabled = true; t.textContent = 'Fetching…';
      try { S.ds = await PS.LIVE.earthquakes(); o.subtitle = autoSubtitle(S.ds); update(); toast('Updated with the latest USGS feed.'); }
      catch { toast('Live feed unreachable from this page. Showing the latest snapshot.'); }
      renderStep();
    },
    build: () => {
      const im = S.imported;
      try {
        const { ds, skipped } = PS.buildFromTable(im.table, im.cols, im.map, { ...im.meta, id: 'custom-' + (S.custom.length + 1) });
        S.custom = S.custom.filter(d => d.title !== ds.title).concat(ds);
        S.imported = null; S.dataTab = 'topics';
        selectDataset(ds.id);
        if (skipped) toast(`${skipped.toLocaleString()} rows skipped (missing or unreadable values).`);
      } catch (e) { toast(e.message); }
    },
    resetStory: () => { o.titleEdited = false; o.title = autoTitle(S.ds); o.subtitle = autoSubtitle(S.ds); o.kicker = ''; o.takeawayText = ''; o.scriptEdited = false; update(); renderStep(); },
    regenScript: () => { o.scriptEdited = false; update(); renderStep(); },
    speak: () => PS.speak(o.script, { voice: o.voice, duration: o.duration }),
    record: async t => {
      if (o.format === 'image') { toast('Voiceover is for video. Switch format to Video.'); return; }
      t.disabled = true; t.textContent = 'Recording… read the captions';
      try {
        const blob = await PS.recordMic(o.duration, () => { o.speakPreview = false; play(0); });
        S.audio = { buffer: await PS.decodeAudio(blob), name: 'Your recording' };
        toast('Voiceover recorded. It will be mixed into the video export.');
      } catch (e) { toast('Microphone unavailable: ' + e.message); }
      renderStep();
    },
    removeAudio: () => { S.audio = null; renderStep(); },
    png: async () => {
      if (gate()) return;
      const prev = o.format; o.format = 'image'; update({ panels: false });
      const raw = await new Promise(r => renderer.canvas.toBlob(r, 'image/png'));
      const ds = S.comboDs || S.ds;
      const blob = await PS.pngWithMeta(raw, { Title: o.title, Description: o.takeawayText || S.analysis.headline, Source: `${ds.source.publisher}${ds.source.dataset ? ', ' + ds.source.dataset : ''}`, 'Source URL': ds.source.url, Author: o.handle, Software: 'Civic Charts', 'Creation Time': new Date().toUTCString(), Comment: PS.shareLink(S.ds.id, o, S.state, DEFAULTS, autoOpts()) || '' });
      const name = `${PS.slug(o.title)}-${o.platform}.png`;
      S.lastExport = { blob, name, type: 'image/png' };
      o.format = prev; update({ panels: false });
      await PS.download(blob, name); toast('PNG saved, with source details embedded.'); if (S.step === 'export') renderStep();
    },
    carousel: async t => {
      if (gate()) return;
      t.disabled = true; t.textContent = 'Building PDF…';
      const prevP = o.platform, prevF = o.format; o.platform = 'feed'; o.format = 'image'; update({ panels: false });
      try {
        const blob = await PS.exportCarousel({ renderer, ds: S.comboDs || S.ds, analysis: S.analysis, o: { ...o, title: o.title || S.ds.title }, link: PS.shareLink(S.ds.id, o, S.state, DEFAULTS, autoOpts()) });
        const name = `${PS.slug(o.title)}-linkedin-carousel.pdf`; S.lastExport = { blob, name, type: 'application/pdf' };
        await PS.download(blob, name); toast('Carousel PDF saved. On LinkedIn, post it as a document.');
      } catch (e) { toast(e.message); }
      o.platform = prevP; o.format = prevF; renderPlatforms(); update({ panels: false }); renderStep();
    },
    pptx: async t => exportDoc(t, 'landscape', 'Building slides…', async png => {
      const blob = await PS.exportPptx({ chartPng: png, ds: S.comboDs || S.ds, analysis: S.analysis, o: { ...o, title: o.title || S.ds.title }, link: PS.shareLink(S.ds.id, o, S.state, DEFAULTS, autoOpts()), st: renderer.st });
      return [blob, `${PS.slug(o.title)}-slides.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Slides saved. Opens in PowerPoint, Keynote and Google Slides; sources are in the speaker notes.'];
    }),
    brief: async t => exportDoc(t, 'report', 'Building brief…', async (png, P) => {
      const blob = await PS.exportBrief({ chartPng: png, chartW: P.w, chartH: P.h, ds: S.comboDs || S.ds, analysis: S.analysis, o: { ...o, title: o.title || S.ds.title }, link: PS.shareLink(S.ds.id, o, S.state, DEFAULTS, autoOpts()), st: renderer.st });
      return [blob, `${PS.slug(o.title)}-brief.pdf`, 'application/pdf', 'One-page brief saved.'];
    }),
    csv: async () => {
      if (gate()) return;
      const { head, rows } = csvRows(), ds = S.comboDs || S.ds;
      await PS.download(new Blob([PS.toCsv(head, rows, { ...ds, title: o.title || S.ds.title })], { type: 'text/csv' }), `${PS.slug(o.title)}-data.csv`);
      toast(`Data saved: ${rows.length.toLocaleString()} rows, with the source on top.`);
    },
    copyEmbed: async () => { PS.track('share', { method: 'embed_code', content_type: 'chart' }); const v = $('#embedCode')?.value; if (!v) return; try { await navigator.clipboard.writeText(v); toast('Embed code copied.'); } catch { $('#embedCode').select(); } },
    srt: async () => { if (gate()) return; await PS.download(new Blob([PS.srt(o.script, o.duration)], { type: 'text/plain' }), `${PS.slug(o.title)}.srt`); toast('Captions file saved. Upload it with the video on LinkedIn or Facebook.'); },
    shareApps: async () => { PS.track('share', { method: 'share_sheet', content_type: 'chart' });
      if (gate() || !S.lastExport) return;
      const file = new File([S.lastExport.blob], S.lastExport.name, { type: S.lastExport.type });
      const text = $('#postCaption')?.value || '';
      if (PS.canShareFiles(file)) { try { await navigator.share({ files: [file], title: o.title, text }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message); } }
      else toast('This browser can\'t share files to apps. Use a platform button: the caption is copied and the composer opens.');
    },
    copyAlt: () => PS.track('copy', { what: 'alt_text' }) || copy($('#altText').value, 'Alt text copied.'),
    copyLink: () => PS.track('share', { method: 'copy_link', content_type: 'chart' }) || copy($('#shareLink').value, 'Link copied.'),
    clearTakeaway: () => { o.takeawayText = ''; update(); renderStep(); },
    resetTitle: () => { o.titleEdited = false; o.title = autoTitle(S.ds); update(); renderStep(); },
    resetSubtitle: () => { o.subtitle = autoSubtitle(S.ds); update(); renderStep(); },
    clearField: t => { o[t.dataset.field] = ''; update(); renderStep(); },
    video: async t => {
      if (gate()) return;
      pause(); S.exporting = true; t.disabled = true;
      const bar = $('#exportProgress i'), ctrl = new AbortController(); S.abort = ctrl;
      $('#cancelExport').hidden = false;
      try {
        const prev = o.format; o.format = 'video'; update({ panels: false });
        const { blob, ext } = await PS.exportVideo({ renderer, duration: o.duration, audioBuffer: S.audio?.buffer, signal: ctrl.signal, onProgress: p => (bar.style.width = (p * 100).toFixed(1) + '%') });
        o.format = prev;
        S.lastExport = { blob, name: `${PS.slug(o.title)}-${o.platform}.${ext}`, type: blob.type };
        await PS.download(blob, S.lastExport.name);
        toast(`Video saved (${ext.toUpperCase()}, ${(blob.size / 1e6).toFixed(1)} MB).`);
      } catch (e) { toast(e.message); }
      S.exporting = false; t.disabled = false; $('#cancelExport').hidden = true; bar.style.width = '0'; S.p = 1; update({ panels: false });
    },
    cancel: () => S.abort?.abort(),
    copyCaption: () => PS.track('copy', { what: 'post_text', network: S.capTab || 'linkedin' }) || copy($('#postCaption').value, 'Post text copied.'),
    saveProject: () => PS.download(new Blob([JSON.stringify({ plainsight: 1, dataset: S.ds.id, options: o }, null, 1)], { type: 'application/json' }), PS.slug(o.title) + '.plainsight.json'),
    openProject: () => $('#projFile').click(),
    applyCheck: t => {
      const a = JSON.parse(t.dataset.payload);
      if (a.type === 'dataset') { selectDataset(a.ids[0]); return; }
      if (a.key === 'range') { o.rangeStart = o.rangeEnd = null; } else o[a.key] = a.value;
      update(); renderStep();
    },
  };

  // generic inputs: data-k binds to o[key]
  $('#stepBody').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.map) {
      const k = el.dataset.map;
      S.imported.map[k] = ['agg', 'filterVal'].includes(k) ? el.value : +el.value;
      if (k === 'filterCol') { S.imported.map.filterVal = S.imported.cols[+el.value]?.values?.[0] ?? ''; renderStep(); }
      return;
    }
    if (el.dataset.color != null) { o.customColors[+el.dataset.color] = el.value; o.palette = 'custom'; update(); return; }
    const k = el.dataset.k; if (!k) return;
    let v = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? +el.value : el.value;
    if (k === 'script') o.scriptEdited = true;
    if (k === 'title') o.titleEdited = true;
    if (k === 'rangeStart' || k === 'rangeEnd') v = v === '' ? null : +v;
    o[k] = v;
    const out = el.closest('.field')?.querySelector('output');
    if (out) out.textContent = OUTFMT[k] ? OUTFMT[k](v) : v;
    if (k === 'rangeStart' || k === 'rangeEnd') o.subtitle = autoSubtitle(S.ds);
    update({ panels: !['title', 'subtitle', 'kicker', 'handle', 'note'].includes(k) || true });
    if (el.dataset.rerender != null) renderStep();
    if (k === 'script') { const f = $('#scriptFit'); if (f) f.innerHTML = fitText(); }
    if (['title', 'subtitle', 'kicker', 'takeawayText', 'script', 'note'].includes(k)) {
      clearTimeout(S._claimT);
      S._claimT = setTimeout(() => { const box = document.querySelector('#stepBody .integrity'), html = integrityBox();
        if (box) { if (html) box.outerHTML = html; else box.remove(); } else if (html) $('#stepBody').insertAdjacentHTML('afterbegin', html); }, 400);
    }
  });
  $('#stepBody').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.multi) {
      const k = el.dataset.multi;
      o[k] = [...document.querySelectorAll(`[data-multi="${k}"]:checked`)].map(x => x.value).slice(0, 4);
      update(); return;
    }
  });
  const OUTFMT = { duration: v => v + 's', radius: v => (v === 0 ? 'Square' : v >= 20 ? 'Round' : v + 'px'), lineWidth: v => v + 'px', textScale: v => Math.round(v * 100) + '%', topN: v => v };

  // ---------- step: chart ----------
  STEPS.chart = () => {
    if (!S.ds) return '<p class="muted">Pick data first.</p>';
    const ds = S.ds;
    const charts = PS.chartsFor(ds);
    let html = compareHTML();
    if (S.combo) {
      const ICON = { shared: 'M3 17l5-6 4 3 7-9M3 19l5-3 4 1 7-5', indexed: 'M3 12h18M3 17l6-6 4 2 8-8', stacked: 'M3 9l5-3 4 2 8-4M3 20l5-4 4 2 8-5', scatter: 'M6 17a1 1 0 1 0 0 .1M10 12a1 1 0 1 0 0 .1M15 9a1 1 0 1 0 0 .1M18 5a1 1 0 1 0 0 .1' };
      const DESC = { shared: 'Same unit and scale: one axis, read values directly', indexed: 'Different units: both start at 100, compare growth', stacked: 'Different units: own scales, shared timeline', scatter: 'One dot per place: is there a pattern?' };
      return html + `<h3>How to combine</h3><div class="chart-grid">${S.combo.methods.map(m => `<button class="chart-opt ${S.combo.method === m.id ? 'active' : ''}" data-method="${m.id}"><svg viewBox="0 0 24 24"><path d="${ICON[m.id]}"/></svg><b>${esc(m.name)}</b><span>${DESC[m.id]}</span></button>`).join('')}</div>
        <p class="muted">Only methods that keep the comparison honest are offered. Two y-axes on one chart are never used.</p>` +
        (S.combo.method === 'scatter' ? field('Highlight one', select('highlight', [['', 'None'], ...ds.entities.map(e => [e.id, e.short || e.name]).sort((a, b) => a[1].localeCompare(b[1]))])) + (ds.entities?.some(e => e.pop != null) ? field('Leave out', `<select data-k="minPop" data-num>${[[0, 'Nothing'], [5000, 'Places under 5,000 people'], [50000, 'Places under 50,000 people']].map(([v, l]) => `<option value="${v}" ${o.minPop === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`) : '') : '')
        + '<h3>Motion</h3>' + field('Pacing', select('motion', [['steady', 'Steady (best for reading values)'], ['smooth', 'Smooth (eases in and out)']]));
    }
    html += `<h3>Chart type</h3><div class="chart-grid">${charts.map(c => `<button class="chart-opt ${o.chart === c.id ? 'active' : ''}" data-chart="${c.id}"><svg viewBox="0 0 24 24"><path d="${c.icon}"/></svg><b>${c.name}${PS.defaultChart(ds) === c.id ? ' <span class="badge">Best fit</span>' : ''}</b><span>${c.desc}</span></button>`).join('')}</div>`;
    html += '<h3>What to show</h3>';
    if (ds.kind === 'timeseries' && ds.series.length > 1 && ['line', 'area'].includes(o.chart)) {
      const sel = o.series.length ? o.series : (ds.defaultSeries || [ds.series[0].id]);
      html += field('Series', ds.series.map(s => `<label class="chk"><input type="checkbox" data-multi="series" value="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join(''));
    }
    if (ds.kind === 'panel' && o.chart === 'line') {
      const li = ds._tms.length - 1;
      const ents = [...ds.entities].sort((a, b) => (b.values[li] ?? -1e18) - (a.values[li] ?? -1e18));
      html += field('Compare (up to 4)', `<div style="max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 8px">${ents.map(e => `<label class="chk"><input type="checkbox" data-multi="entities" value="${esc(e.id)}" ${o.entities.includes(e.id) ? 'checked' : ''}> ${esc(e.name)}</label>`).join('')}</div><p class="muted">None selected shows the top 3.</p>`);
    }
    if (['barrace', 'bars'].includes(o.chart)) html += field('How many bars', range('topN', 5, 20), o.topN);
    if (ds.kind === 'panel' && ['barrace', 'bars', 'choropleth'].includes(o.chart))
      html += field('Highlight one', select('highlight', [['', 'None'], ...ds.entities.map(e => [e.id, e.name]).sort((a, b) => a[1].localeCompare(b[1]))]));
    if (o.chart === 'bars') html += check('sortAsc', 'Show lowest first');
    if (ds.entities?.some(e => e.pop != null)) html += field('Leave out of rankings', `<select data-k="minPop" data-num>${[[0, 'Nothing (rank every place)'], [1000, 'Places under 1,000 people'], [5000, 'Places under 5,000 people'], [10000, 'Places under 10,000 people'], [50000, 'Places under 50,000 people']].map(([v, l]) => `<option value="${v}" ${o.minPop === v ? 'selected' : ''}>${l}</option>`).join('')}</select><p class="muted">Small places stay on the map; this only affects "highest" and "lowest".</p>`);
    if (['line', 'area'].includes(o.chart)) html += check('zeroBase', 'Start axis at zero (recommended)') + check('annotate', 'Label the peak');
    if (o.chart === 'columns' && ds.kind !== 'events') html += check('highlightLast', 'Highlight latest year');
    if (o.chart === 'choropleth') html += check('colorZero', 'Color scale starts at zero');
    if (ds.kind !== 'events' && !ds.singleTime) {
      const [a, b] = timeBounds(ds), y0 = yearOf(a), y1 = yearOf(b);
      const years = d3.range(y0, y1 + 1);
      const sv = o.rangeStart != null ? yearOf(o.rangeStart) : '', ev = o.rangeEnd != null ? yearOf(o.rangeEnd) : '';
      html += field('Time range', `<div class="row"><select id="rs"><option value="">From ${y0}</option>${years.map(y => `<option ${y === sv ? 'selected' : ''}>${y}</option>`).join('')}</select><select id="re"><option value="">To ${y1}</option>${years.map(y => `<option ${y === ev ? 'selected' : ''}>${y}</option>`).join('')}</select></div><p class="muted">Civic Charts warns you if a shorter range flips the long-term trend.</p>`);
    }
    html += '<h3>Motion</h3>' + field('Pacing', select('motion', [['steady', 'Steady (best for reading values)'], ['smooth', 'Smooth (eases in and out)']]));
    return html;
  };
  function compareHTML() {
    const chips = o.compare.map(id => { const c = S.catalog.find(x => x.id === id) || S.custom.find(x => x.id === id); return `<span class="cmp-chip">${esc(c?.title || id)}<button data-uncompare="${id}" aria-label="Remove">✕</button></span>`; }).join('');
    let h = `<h3>Compare with another dataset</h3><div class="cmp-box"><div class="cmp-chips"><span class="cmp-chip main">${esc(S.ds.title)}</span>${chips}</div>`;
    if (!S.picker) h += `<button class="btn block" data-act="openCompare">+ Add a dataset to compare</button>`;
    else if (S.picker === 'loading') h += '<p class="muted">Checking which datasets fit…</p>';
    else {
      const ok = S.picker.filter(x => x.ok), no = S.picker.filter(x => !x.ok);
      h += `<div class="cmp-list"><p class="muted">Works with your data</p>${ok.map(x => `<button class="cmp ok" data-compare="${x.id}"><b>${esc(x.title)}</b><span>${esc(x.methods.map(m => m.name).join(' · '))}</span></button>`).join('') || '<p class="muted">Nothing else fits this dataset.</p>'}
        ${no.length ? `<details><summary>Can't be combined (${no.length})</summary>${no.map(x => `<div class="cmp no"><b>${esc(x.title)}</b><span>${esc(x.reason)}</span></div>`).join('')}</details>` : ''}
        <button class="btn block" data-act="closeCompare">Close</button></div>`;
    }
    return h + '</div>';
  }
  async function openPicker() {
    S.picker = 'loading'; renderStep();
    const ids = [...S.catalog.map(c => c.id), ...S.custom.map(c => c.id)];
    const loaded = await Promise.all(ids.map(id => (S.custom.find(c => c.id === id) ? Promise.resolve(S.custom.find(c => c.id === id)) : PS.loadDataset(id).catch(() => null))));
    loaded.forEach(d => d && S.compareDs.set(d.id, d));
    const parts = [viewOf(S.ds), ...o.compare.map(id => viewOf(S.compareDs.get(id)))];
    const oo = comboOpts();
    S.picker = loaded.filter(d => d && !parts.some(p => p.id === d.id)).map(d => ({ id: d.id, title: d.title, ...PS.compatibility(parts, viewOf(d), oo) }))
      .sort((a, b) => (b.ok - a.ok) || a.title.localeCompare(b.title));
    renderStep();
  }
  AFTER.chart = () => {
    const set = () => {
      const rs = $('#rs').value, re = $('#re').value;
      o.rangeStart = rs ? Date.UTC(+rs, 0, 1) : null; o.rangeEnd = re ? Date.UTC(+re, 11, 31, 23) : null;
      o.subtitle = autoSubtitle(S.ds); update();
    };
    $('#rs')?.addEventListener('change', set); $('#re')?.addEventListener('change', set);
  };

  // ---------- step: style ----------
  STEPS.style = () => {
    const T = PS.THEMES[o.theme], bg = o.bg || T.bg, n = Math.max(3, colorsInUse());
    const themes = Object.entries(PS.THEMES).map(([id, t]) => {
      const pal = PS.PALETTES[o.palette === 'custom' ? 'plainsight' : o.palette][t.mode === 'dark' ? 'dark' : 'colors'];
      return `<button class="theme-opt ${o.theme === id ? 'active' : ''}" data-theme="${id}"><div class="sw" style="background:${t.bg}">${pal.slice(0, 4).map((c, i) => `<i style="background:${c};height:${10 + i * 5}px"></i>`).join('')}</div><b style="font-family:'${t.head}'">${t.name}</b></button>`;
    }).join('');
    const pals = Object.entries(PS.PALETTES);
    const palRow = ([id, p]) => {
      const cs = p[T.mode === 'dark' ? 'dark' : 'colors'], chk = PS.checkPalette(cs, bg, Math.min(n, cs.length));
      return `<button class="pal ${o.palette === id ? 'active' : ''}" data-pal="${id}"><span class="strip">${cs.slice(0, 6).map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${p.name}</b>${chk.issues.length ? '<em class="warn">Check</em>' : '<em>Readable</em>'}</button>`;
    };
    const customChk = PS.checkPalette(o.customColors, bg, Math.min(n, 6));
    let html = `<h3>Look</h3><div class="grid3">${themes}</div>`;
    html += `<h3>Color palette</h3><p class="muted">"Readable" means the colors used in this chart stay distinguishable on this background, including for color-blind viewers.</p>`;
    html += `<div class="muted" style="margin:8px 0 4px;font-weight:600">Tested</div>` + pals.filter(([, p]) => p.group === 'Tested').map(palRow).join('');
    html += `<div class="muted" style="margin:10px 0 4px;font-weight:600">Themes</div>` + pals.filter(([, p]) => p.group === 'Themes').map(palRow).join('');
    html += `<div class="muted" style="margin:10px 0 4px;font-weight:600">Your colors</div><button class="pal ${o.palette === 'custom' ? 'active' : ''}" data-pal="custom"><span class="strip">${o.customColors.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>Custom</b>${customChk.issues.length ? '<em class="warn">Check</em>' : '<em>Readable</em>'}</button>
      <div class="row" style="margin:6px 0 4px">${o.customColors.map((c, i) => `<input type="color" data-color="${i}" value="${c}" aria-label="Custom color ${i + 1}">`).join('')}</div>
      ${o.palette === 'custom' && customChk.issues.length ? `<p class="err">${esc(customChk.issues[0].msg)}</p>` : ''}`;
    if (['choropleth', 'bubblemap'].includes(o.chart)) {
      html += `<h3>Map colors</h3><div class="chips">${Object.entries(PS.RAMPS).map(([id, r]) => `<button class="chip ${o.ramp === id ? 'active' : ''}" data-ramp="${id}">${r.stops ? `<span style="display:inline-block;width:34px;height:9px;border-radius:3px;margin-right:6px;background:linear-gradient(90deg,${r.stops.join(',')})"></span>` : ''}${r.name}</button>`).join('')}</div><p class="muted">Maps use one hue from light to dark so darker always means more.</p>`;
    }
    html += `<h3>Shape &amp; type</h3>`;
    html += field('Corners', range('radius', 0, 24), OUTFMT.radius(o.radius));
    html += field('Line weight', range('lineWidth', 2, 12), o.lineWidth + 'px');
    html += field('Text size', range('textScale', 0.8, 1.3, 0.05), Math.round(o.textScale * 100) + '%');
    html += field('Gridlines', select('grid', [['light', 'Light'], ['dashed', 'Dashed'], ['none', 'None']]));
    html += `<div class="row">${field('Headline font', select('headFont', Object.entries(PS.FONTS)))}${field('Body font', select('bodyFont', Object.entries(PS.FONTS)))}</div>`;
    html += `<h3>Background &amp; accent</h3><div class="row" style="align-items:flex-end">${field('Background', `<div class="row"><input type="color" data-k="bg" value="${o.bg || T.bg}"><button class="btn" data-act="resetBg" style="flex:none">Reset</button></div>`)}${field('Accent', `<div class="row"><input type="color" data-k="accent" value="${o.accent || palette()[0]}"><button class="btn" data-act="resetAccent" style="flex:none">Reset</button></div>`)}</div>`;
    html += check('bgGradient', 'Subtle accent glow');
    return html;
  };
  ACTIONS.resetBg = () => { o.bg = ''; update(); renderStep(); };
  ACTIONS.resetAccent = () => { o.accent = ''; update(); renderStep(); };

  // ---------- step: story ----------
  const fitText = () => {
    const sec = PS.scriptSeconds(o.script);
    const ok = sec <= o.duration * 1.15;
    return `<span style="color:var(${ok ? '--good' : '--warn'})">${ok ? '✓' : '!'} About ${Math.round(sec)}s to read aloud; video is ${o.duration}s${ok ? '' : '. Shorten it or lengthen the video.'}</span>`;
  };
  STEPS.story = () => {
    if (!S.ds) return '<p class="muted">Pick data first.</p>';
    const box = integrityBox();
    const voices = PS.voices();
    let html = box + `<h3>Headline</h3>
      ${field('Title', `<input type="text" data-k="title" value="${esc(o.title)}">`)}
      ${field('Subtitle', `<input type="text" data-k="subtitle" value="${esc(o.subtitle)}">`)}
      ${field('Kicker', `<input type="text" data-k="kicker" value="${esc(o.kicker)}" placeholder="${esc((S.ds.category + ' · ' + S.ds.source.publisher))}">`)}
      <button class="btn" data-act="resetStory">Reset to suggested</button>
      <h3>Takeaway</h3>${check('takeaway', 'Show the takeaway at the end')}
      ${field('Takeaway text', `<textarea data-k="takeawayText" placeholder="${esc(S.analysis?.headline || '')}">${esc(o.takeawayText)}</textarea><p class="muted">Leave blank to use the computed takeaway. Every number in it comes from the data.</p>`)}
      <h3>Captions &amp; voiceover</h3>${check('captions', 'Burn in captions (most social video is watched muted)')}
      ${field('Script', `<textarea data-k="script" style="min-height:130px">${esc(o.script)}</textarea><p class="muted" id="scriptFit">${fitText()}</p>`)}
      <div class="row"><button class="btn" data-act="regenScript">Regenerate</button><button class="btn" data-act="speak">Listen</button></div>
      ${voices.length ? field('Preview voice', select('voice', [['', 'System default'], ...voices.map(v => [v.name, v.name])])) : ''}
      ${check('speakPreview', 'Read the script aloud during preview')}
      <div class="field"><div class="lbl">Voiceover track for export</div>
        ${S.audio ? `<div class="row"><span class="muted">${esc(S.audio.name)} · ${S.audio.buffer.duration.toFixed(1)}s</span><button class="btn" data-act="removeAudio" style="flex:none">Remove</button></div>` :
        `<div class="row"><button class="btn" data-act="record">Record (reads along with captions)</button></div><label class="muted" style="display:block;margin-top:6px">or upload audio <input type="file" id="audioFile" accept="audio/*"></label>`}
        <p class="muted">Browser voices can preview but can't be embedded in video. Recorded or uploaded audio is mixed into the export.</p></div>
      <h3>Credit</h3>${field('Your handle or outlet', `<input type="text" data-k="handle" value="${esc(o.handle)}" placeholder="@yourhandle">`)}
      ${field('Extra note (appended to the source line)', `<input type="text" data-k="note" value="${esc(o.note)}" placeholder="e.g. Seasonally adjusted.">`)}
      ${check('brand', 'Show "Made with civiccharts.com"')}
      <p class="muted">The source line is always included and can't be removed.</p>`;
    return html;
  };
  AFTER.story = () => {
    $('#audioFile')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { S.audio = { buffer: await PS.decodeAudio(f), name: f.name }; renderStep(); toast('Audio added to the export.'); }
      catch { toast('Could not read that audio file.'); }
    });
  };

  // Render the final frame at another size (for slides and briefs), then restore the user's size.
  async function exportDoc(t, platform, busy, build) {
    if (gate()) return;
    const label = t.textContent; t.disabled = true; t.textContent = busy;
    const prevP = o.platform, prevF = o.format, prevSafe = o.showSafe;
    o.platform = platform; o.format = 'image'; o.showSafe = false; update({ panels: false });
    try {
      renderer.draw(1);
      const [blob, name, type, msg] = await build(renderer.canvas.toDataURL('image/png'), PS.PLATFORMS[platform]);
      S.lastExport = { blob, name, type };
      await PS.download(blob, name); toast(msg);
    } catch (e) { toast(e.message || 'Export failed.'); }
    o.platform = prevP; o.format = prevF; o.showSafe = prevSafe; renderPlatforms(); update({ panels: false });
    t.disabled = false; t.textContent = label; renderStep();
  }
  // Every row behind the current chart (respecting range, focus and overlays).
  function csvRows() {
    const iso = t => { const d = new Date(t); return isNaN(d) ? String(t) : d.toISOString().slice(0, 10); };
    const cd = S.comboDs;
    if (cd?.kind === 'scatter') {
      const head = ['Place', 'Year', `${cd.x.title} (${cd.x.unit.label})`, `${cd.y.title} (${cd.y.unit.label})`], rows = [];
      cd.points.forEach(p => cd.years.forEach((yr, i) => { if (p.xs[i] != null || p.ys[i] != null) rows.push([p.name, yr, p.xs[i], p.ys[i]]); }));
      return { head, rows };
    }
    if (cd?.combo) {
      const rows = [];
      cd.series.forEach(sr => sr.raw.forEach((p, i) => rows.push([sr.name, iso(p.t), p.v, ...(cd.refLine != null ? [sr.pts[i] ? +sr.pts[i].v.toFixed(2) : ''] : []), sr.unit.label])));
      return { head: ['Series', 'Date', 'Value', ...(cd.refLine != null ? ['Index'] : []), 'Unit'], rows };
    }
    const ds = S.ds, v = S.analysis.view, u = ds.unit.label;
    if (ds.kind === 'timeseries') return { head: ['Series', 'Date', `Value (${u})`], rows: v.series.flatMap(sr => sr.pts.map(p => [sr.name, iso(p.t), p.v])) };
    if (ds.kind === 'panel') {
      const idx = v.idx || ds.times.map((_, i) => i);
      return { head: ['Code', 'Name', ...idx.map(i => iso(ds.times[i]))], rows: ds.entities.map(e => [e.code ?? e.id ?? '', e.name, ...idx.map(i => e.values[i])]) };
    }
    return { head: ['Time', 'Location', 'Latitude', 'Longitude', `Value (${u})`], rows: (v.events || ds.events).map(e => [e.t, e.label, e.lat, e.lon, e.value]) };
  }

  // ---------- step: export ----------
  function integrityBox() {
    const b = S.integrity?.blocks || [];
    if (!b.length) return '';
    return `<div class="integrity"><b>Export is paused: your text doesn't match the data</b>${b.map(x => `<p><b>${esc(x.title)}.</b> ${esc(x.detail)}</p><button class="btn" data-act="${x.fix.act}" data-field="${x.fix.field || ''}">${esc(x.fix.label)}</button>`).join('')}
      <p class="muted">Civic Charts checks your title, subtitle, takeaway, script and notes against the data so the tool can't be used to misstate it. Edit the text in Story, or use the suggestion.</p></div>`;
  }
  const blocked = () => (S.integrity?.blocks.length || 0) > 0;
  STEPS.export = () => {
    if (!S.ds) return '<p class="muted">Pick data first.</p>';
    const P = PS.PLATFORMS[o.platform];
    const mime = PS.videoMime();
    const link = PS.shareLink(S.ds.id, o, S.state, DEFAULTS, autoOpts());
    const ds = S.comboDs || viewOf(S.ds);
    const caps = PS.postCaptions(ds.combo ? { ...ds, topic: S.ds.topic } : { ...S.ds, topic: S.ds.topic }, S.analysis, { ...o, title: o.title || S.ds.title }, link);
    const capTab = S.capTab || 'linkedin';
    const dis = blocked() ? 'disabled' : '';
    // Websites want landscape: a phone-shaped size embeds as 16:9.
    const embedP = ['vertical', 'pin', 'feed'].includes(o.platform) ? 'landscape' : o.platform;
    const embed = PS.embedCode(PS.shareLink(S.ds.id, { ...o, platform: embedP }, S.state, DEFAULTS, autoOpts()), PS.PLATFORMS[embedP], o.title || S.ds.title);
    return integrityBox() + `<h3>Format</h3><div class="tabs">${[['video', 'Video'], ['image', 'Image']].map(([k, l]) => `<button data-fmt="${k}" class="${o.format === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <h3>Size</h3><div class="chips">${Object.entries(PS.PLATFORMS).map(([id, p]) => `<button class="chip ${o.platform === id ? 'active' : ''}" data-platform-x="${id}">${p.ratio} · ${esc(p.name)}</button>`).join('')}</div>
      <p class="muted">${P.w}×${P.h}px. Content stays inside the platform's safe area; toggle "Safe zones" under the preview to see it.</p>
      ${o.format === 'video' ? field('Length', range('duration', 6, 90), o.duration + 's') + `<p class="muted">${P.dur}s is the sweet spot for ${esc(P.name.split(':')[0])}.</p>` : ''}
      <h3>Download</h3>
      ${o.format === 'video' ? `<button class="btn primary block" data-act="video" ${mime && !blocked() ? '' : 'disabled'}>Export video${mime ? ` (${mime.startsWith('video/mp4') ? 'MP4' : 'WebM'})` : ''}</button>
        <div class="progress" id="exportProgress"><i></i></div><button class="btn block" id="cancelExport" data-act="cancel" hidden style="margin-top:6px">Cancel</button>
        <p class="muted">Renders in real time (${o.duration}s). Keep this tab visible while it records.${S.audio ? ' Includes your voiceover.' : ''}</p>` : ''}
      <button class="btn ${o.format === 'image' ? 'primary' : ''} block" data-act="png" style="margin-top:6px" ${dis}>Export PNG (final frame, with source details embedded)</button>
      <button class="btn block" data-act="carousel" style="margin-top:6px" ${dis}>LinkedIn carousel (4-page PDF)</button>
      ${o.format === 'video' && o.captions ? `<button class="btn block" data-act="srt" style="margin-top:6px" ${dis}>Captions file (.srt) for LinkedIn and Facebook</button>` : ''}
      <h3>Presentations and reports</h3>
      <div class="export-grid">
        <button class="btn" data-act="pptx" ${dis}>PowerPoint slides<small>Chart + editable takeaway, sources in speaker notes</small></button>
        <button class="btn" data-act="brief" ${dis}>One-page brief (PDF)<small>Chart, what it shows, how to read it, sources</small></button>
        <button class="btn" data-act="csv" ${dis}>Data (CSV)<small>Every number behind this chart, source on top</small></button>
      </div>
      <p class="muted">Slides render at 16:9 and the brief at 3:2, whatever size is selected above. Exported videos drop straight into PowerPoint and Keynote too.</p>
      <h3>Embed on a website</h3>
      ${embed ? `<textarea id="embedCode" readonly style="min-height:80px;font-family:var(--mono, monospace);font-size:12px">${esc(embed)}</textarea><button class="btn block" data-act="copyEmbed" ${dis}>Copy embed code</button>
      <p class="muted">Paste into any site or CMS. ${embedP !== o.platform ? 'Embeds use 16:9 for web pages. ' : ''}The embed rebuilds from the latest official data on every visit, so it stays current, and it flags itself if your text no longer matches a newer release.</p>` : '<p class="muted">Uploaded data can\'t be embedded; export an image instead.</p>'}
      <h3>Share</h3>
      ${S.lastExport ? `<p class="muted">Ready to share: ${esc(S.lastExport.name)}</p>` : '<p class="muted">Export a video or image first, then share it here.</p>'}
      <button class="btn primary block" data-act="shareApps" ${S.lastExport && !blocked() ? '' : 'disabled'}>Share to apps (LinkedIn, Facebook, Instagram…)</button>
      <p class="muted">On phones and Safari this opens your apps with the file and caption attached. Elsewhere, use a button below: the caption is copied and the composer opens; attach the downloaded file.</p>
      <div class="chips">${[['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['x', 'X'], ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['reddit', 'Reddit']].map(([k, l]) => `<button class="chip" data-compose="${k}" ${dis}>${l}</button>`).join('')}</div>
      <h3>Post text</h3><div class="tabs cap-tabs">${[['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['x', 'X'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']].map(([k, l]) => `<button data-captab="${k}" class="${capTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <textarea id="postCaption" style="min-height:170px">${esc(caps[capTab])}</textarea>
      <div class="row"><button class="btn" data-act="copyCaption">Copy text</button><span class="muted" style="flex:none">${caps[capTab].length.toLocaleString()} characters</span></div>
      <h3>Alt text</h3><textarea id="altText" style="min-height:90px">${esc(PS.altText(ds, S.analysis, { ...o, title: o.title || S.ds.title }))}</textarea>
      <button class="btn block" data-act="copyAlt">Copy alt text</button><p class="muted">Paste into the platform's alt text field. It makes the chart readable to screen readers, and platforms use it to understand the post.</p>
      <h3>Share link</h3>${link ? `<input type="text" id="shareLink" readonly value="${esc(link)}"><button class="btn block" data-act="copyLink" style="margin-top:6px">Copy link</button><p class="muted">Opens this exact chart, rebuilt from the official data, so anyone can check that what they saw matches the source.</p>` : '<p class="muted">Uploaded data can\'t be rebuilt from a link.</p>'}
      <h3>Project</h3><div class="row"><button class="btn" data-act="saveProject">Save project</button><button class="btn" data-act="openProject">Open project</button></div>
      <input type="file" id="projFile" accept=".json" hidden>`;
  };
  AFTER.export = () => {
    document.querySelectorAll('[data-platform-x]').forEach(b => b.onclick = () => { $(`[data-platform="${b.dataset.platformX}"]`).click(); });
    $('#projFile').onchange = async e => {
      try {
        const j = JSON.parse(await e.target.files[0].text());
        await selectDataset(j.dataset); o = { ...DEFAULTS, ...j.options }; renderPlatforms(); update(); renderStep(); toast('Project opened.');
      } catch (err) { toast('Could not open project: ' + err.message); }
    };
  };

  // ---------- insight panel ----------
  function renderInsight() {
    const a = S.analysis, ds = S.ds;
    const warn = a.checks.filter(c => c.level === 'warn').length, pass = a.checks.filter(c => c.level === 'pass').length;
    const table = dataTable();
    $('#insight').innerHTML = `<h2>What this shows</h2><p class="headline">${esc(a.headline)}</p>
      ${a.howTo ? `<div class="howto fit"><b>How these fit together</b>${esc(a.howTo)}</div>` : ''}
      <ul class="facts">${a.facts.map(f => `<li>${esc(f.text)}</li>`).join('')}</ul>
      ${ds.howToRead?.length ? `<div class="howto"><b>How to read it</b>${ds.howToRead.map(h => esc(h)).join(' ')}</div>` : ''}
      <h2>Trust check</h2><div class="trust-score"><b>${pass}</b> passed · <b>${warn}</b> to review${S.integrity?.blocks.length ? ` · <b class="bad">${S.integrity.blocks.length}</b> blocking export` : ''}</div>
      <ul class="checks">${a.checks.map(c => `<li><span class="ic ${c.level}">${c.level === 'pass' ? '✓' : c.level === 'warn' ? '!' : c.level === 'block' ? '✕' : 'i'}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p>${c.action ? actionBtn(c.action) : ''}${c.fixAct ? `<button class="btn" data-act="${c.fixAct.act}" data-field="${c.fixAct.field || ''}">${esc(c.fixAct.label)}</button>` : ''}</div></li>`).join('')}</ul>
      <details><summary>View the data</summary>${table}</details>
      ${ds.source.url ? `<p class="muted">Original source: <a href="${esc(ds.source.url)}" target="_blank" rel="noopener">${esc(ds.source.publisher)} ↗</a></p>` : ''}`;
  }
  function actionBtn(a) {
    if (a.type === 'dataset') {
      return a.ids.map(id => { const c = S.catalog.find(x => x.id === id); return c ? `<button class="btn" data-act="applyCheck" data-payload='${esc(JSON.stringify({ type: 'dataset', ids: [id] }))}'>Switch to: ${esc(c.lens || c.title)}</button> ` : ''; }).join('');
    }
    return `<button class="btn" data-act="applyCheck" data-payload='${esc(JSON.stringify(a))}'>${esc(a.label)}</button>`;
  }
  $('#insight').addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (t) ACTIONS[t.dataset.act]?.(t); });

  function dataTable() {
    // Overlays: show the combined numbers, not just the first dataset's.
    const cd = S.comboDs;
    if (cd?.kind === 'scatter') {
      const yi = cd.years.length - 1;
      const rows = cd.points.filter(p => p.xs[yi] != null && p.ys[yi] != null).sort((a, b) => b.ys[yi] - a.ys[yi]);
      return `<table class="data-table"><tr><th>${esc({ 'us-states': 'State', 'us-counties': 'County', world: 'Country' }[cd.geo] || 'Place')} (${cd.years[yi]})</th><th>${esc(cd.x.title)}</th><th>${esc(cd.y.title)}</th></tr>${rows.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(PS.fmt(p.xs[yi], cd.x.unit))}</td><td>${esc(PS.fmt(p.ys[yi], cd.y.unit))}</td></tr>`).join('')}</table>`;
    }
    if (cd?.combo) {
      const fq = cd.frequency === 'weekly' || cd.frequency === 'daily' ? 'monthly' : cd.frequency;
      return cd.series.map(sr => `<p class="muted" style="margin:8px 0 2px"><b>${esc(sr.name)}</b></p><table class="data-table"><tr><th>Date</th><th>${esc(sr.unit.label)}</th>${cd.refLine != null ? '<th>Index</th>' : ''}</tr>${sr.raw.slice(-8).reverse().map((p, i, arr) => { const ix = sr.pts[sr.pts.length - 1 - i]; return `<tr><td>${esc(PS.fmtDate(p.t, fq))}</td><td>${esc(PS.fmt(p.v, sr.unit))}</td>${cd.refLine != null ? `<td>${Math.round(ix.v)}</td>` : ''}</tr>`; }).join('')}</table>`).join('');
    }
    const ds = S.ds, v = S.analysis.view, u = ds.unit;
    let rows = [];
    if (ds.kind === 'timeseries') rows = v.series[0].pts.slice(-15).reverse().map(p => [PS.fmtDate(p.t, ds.frequency), PS.fmt(p.v, u)]);
    else if (ds.kind === 'panel') { const li = v.idx.at(-1); rows = ds.entities.filter(e => e.values[li] != null).sort((a, b) => b.values[li] - a.values[li]).map(e => [e.name, PS.fmt(e.values[li], u)]); }
    else rows = [...v.events].sort((a, b) => b.value - a.value).slice(0, 25).map(e => [e.label, 'M' + e.value.toFixed(1)]);
    return `<table class="data-table"><tr><th>${ds.kind === 'timeseries' ? 'Date' : ds.kind === 'events' ? 'Location' : 'Name'}</th><th>${esc(u.label)}</th></tr>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>`;
  }

  // ---------- UI theme ----------
  $('#themeToggle').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ps-ui-theme', document.documentElement.dataset.theme); } catch { }
  };
  try { const t = localStorage.getItem('ps-ui-theme'); if (t) document.documentElement.dataset.theme = t; } catch { }

  // Sticky offsets follow the topbar's real height (it grows with the iOS safe area).
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const setTopH = () => document.documentElement.style.setProperty('--topbar-h', topbar.getBoundingClientRect().height + 'px');
    setTopH();
    if (window.ResizeObserver) new ResizeObserver(setTopH).observe(topbar);
  }

  // ---------- boot ----------
  const EMBED = new URLSearchParams(location.search).get('embed') === '1';
  PS.ctx = () => ({ dataset_id: S.ds?.id, chart_type: o.chart, size: o.platform, format: o.format, state: S.state || undefined });
  if (EMBED) document.body.classList.add('embed');
  (async function boot() {
    renderPlatforms();
    S.catalog = await PS.loadCatalog();
    const fonts = ['Inter', 'Source Serif 4', 'Archivo', 'IBM Plex Mono'].flatMap(f => [400, 600, 700, 800].map(w => document.fonts.load(`${w} 40px "${f}"`)));
    await Promise.race([Promise.allSettled(fonts), new Promise(r => setTimeout(r, 2500))]);
    const shared = PS.readShareLink();
    const start = shared?.d || new URLSearchParams(location.search).get('d') || 'us-unemployment';
    if (shared?.s) S.state = shared.s;
    await selectDataset(S.catalog.some(c => c.id === start) ? start : S.catalog[0]?.id);
    if (shared && S.ds?.id === shared.d) {
      // Rebuild exactly what was shared, from the official data: settings only, never data.
      Object.assign(o, shared.o);
      for (const id of o.compare || []) { try { S.compareDs.set(id, await PS.loadDataset(id)); } catch { } }
      renderPlatforms(); update(); renderStep();
      if (!EMBED) toast('Rebuilt from the official data.');
    }
    if (EMBED) {
      const ds = S.comboDs || S.ds, full = location.href.replace(/[?&]embed=1/, '');
      const stale = S.integrity?.blocks.length;
      const bar = document.createElement('div'); bar.className = 'embed-bar';
      bar.innerHTML = `${stale ? `<span class="embed-warn">Text on this chart was written for an earlier data release and no longer matches the latest numbers.</span>` : ''}
        <span>Live data: ${esc(ds.source.publisher)}, retrieved ${esc(PS.fmtRetrieved(ds.retrieved))}</span><a href="${esc(full)}" target="_blank" rel="noopener">Open in Civic Charts ↗</a>`;
      document.querySelector('.stage').appendChild(bar);
      play();
    }
    document.fonts.ready.then(() => { renderer.layout = null; update({ panels: false }); });
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => S.step === 'story' && renderStep();
  })();
})(window.PS);
