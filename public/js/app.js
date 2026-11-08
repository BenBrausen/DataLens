// Plainsight app: state, step panels, preview loop, export.
(function (PS) {
  const $ = s => document.querySelector(s);
  const esc = PS.esc;
  const canvas = $('#canvas');
  const renderer = new PS.Renderer(canvas);

  const S = {
    catalog: [], ds: null, step: 'data', dataTab: 'featured', playing: false, p: 1, t0: 0,
    analysis: null, audio: null, imported: null, search: { q: '', results: [], busy: false, err: '' }, exporting: false, custom: [],
  };
  const DEFAULTS = {
    chart: 'line', platform: 'vertical', format: 'video', duration: 20, theme: 'newsroom', palette: 'plainsight',
    customColors: ['#1d4e89', '#e4572e', '#29a36a', '#f2a541', '#7d5ba6', '#5c5c5c'], ramp: 'auto', headFont: 'theme', bodyFont: 'theme',
    accent: '', bg: '', bgGradient: false, radius: 6, lineWidth: 5, grid: 'light', textScale: 1, annotate: true, zeroBase: true,
    series: [], entities: [], topN: 10, highlight: '', sortAsc: false, rangeStart: null, rangeEnd: null, handle: '', brand: true,
    motion: 'steady', takeaway: true, takeawayText: '', captions: true, script: '', scriptEdited: false, voice: '', speakPreview: false,
    kicker: '', title: '', subtitle: '', note: '', colorZero: false,
  };
  let o = { ...DEFAULTS };

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

  // ---------- core update ----------
  function update({ relayout = true, panels = true } = {}) {
    if (!S.ds) return;
    const ds = S.ds;
    const T = PS.THEMES[o.theme];
    const pc = PS.checkPalette(palette(), o.bg || T.bg, colorsInUse());
    S.analysis = PS.analyze(ds, { ...o, paletteCheck: colorsInUse() > 1 ? pc : null });
    if (!o.scriptEdited) o.script = S.analysis.script;
    const platform = PS.PLATFORMS[o.platform];
    renderer.setScene({
      ds, platform, analysis: S.analysis, script: o.script,
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
    S.ds = ds;
    const charts = PS.chartsFor(ds).map(c => c.id);
    o.chart = charts.includes(o.chart) && keepStory ? o.chart : PS.defaultChart(ds);
    Object.assign(o, { series: [], entities: [], highlight: '', rangeStart: null, rangeEnd: null, takeawayText: '', scriptEdited: false });
    o.title = ds.title; o.subtitle = autoSubtitle(ds); o.kicker = '';
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

  STEPS.data = () => {
    const tabs = `<div class="tabs">${[['featured', 'Featured'], ['search', 'Search data.gov'], ['upload', 'Upload']].map(([k, l]) => `<button data-tab="${k}" class="${S.dataTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (S.dataTab === 'featured') {
      const lens = S.ds?.reframes ? `<div class="lens"><p><b>Same data, different lens.</b> The lens changes the story; pick the one that answers the question honestly.</p><div class="chips">${S.ds.reframes.map(id => { const c = S.catalog.find(x => x.id === id); return c ? `<button class="chip ${S.ds.id === id ? 'active' : ''}" data-ds="${id}">${esc(c.lens || c.title)}</button>` : ''; }).join('')}</div></div>` : '';
      const groups = {};
      S.catalog.filter(c => !c.reframes || c.reframes[0] === c.id).forEach(c => (groups[c.category] ||= []).push(c));
      if (S.custom.length) groups['Your data'] = S.custom;
      body = lens + Object.entries(groups).map(([g, list]) => `<div class="ds-group"><h3>${esc(g)}</h3>${list.map(c => {
        const active = S.ds && (S.ds.id === c.id || c.reframes?.includes(S.ds.id));
        const kind = c.kind === 'events' ? '<span class="badge live">Live</span>' : c.geo ? '<span class="badge">Map</span>' : c.kind === 'panel' ? '<span class="badge">Compare</span>' : '';
        return `<button class="ds ${active ? 'active' : ''}" data-ds="${c.id}"><b>${esc(c.title)}${kind}</b><span>${esc(c.source.publisher)} · through ${esc(PS.fmtDate(c.lastObservation, c.frequency === 'real-time' ? 'daily' : c.frequency))}</span></button>`;
      }).join('')}</div>`).join('');
      if (S.ds?.id === 'earthquakes') body = `<button class="btn block" data-act="live">Refresh live from USGS</button>` + body;
    } else if (S.dataTab === 'search') {
      body = `<p class="muted">Search ${'300,000+'} federal, state and city datasets in the official data.gov catalog. Plainsight loads the CSV and suggests a chart.</p>
        <form id="searchForm" class="row"><input type="search" id="q" placeholder="e.g. electric vehicles, crime, school enrollment" value="${esc(S.search.q)}"><button class="btn primary" style="flex:none">Search</button></form>
        <div class="results">${S.search.busy ? '<p class="muted">Searching…</p>' : ''}${S.search.err ? `<p class="err">${esc(S.search.err)}</p>` : ''}
        ${S.search.results.map((r, i) => `<div class="result"><b>${esc(r.title)}</b><div class="meta">${esc(r.publisher)}${r.orgType ? ' · ' + esc(r.orgType) : ''}${r.modified ? ' · updated ' + esc(String(r.modified).slice(0, 10)) : ''}</div><p>${esc(r.description)}</p><div class="row"><button class="btn" data-load="${i}">Load data</button><a class="muted" href="${esc(r.landing)}" target="_blank" rel="noopener" style="flex:none">Source page ↗</a></div></div>`).join('')}</div>` + mapperHTML();
    } else {
      body = `<p class="muted">Upload a CSV. Plainsight detects dates, numbers, states and countries automatically. Uploaded files are labeled as unverified in the citation.</p>
        <input type="file" id="file" accept=".csv,.tsv,.txt,text/csv"><p class="muted">Tip: one row per date (and place), one column per measure.</p>` + mapperHTML();
    }
    return tabs + body;
  };

  function mapperHTML() {
    const im = S.imported; if (!im) return '';
    const opt = (k, types, none) => `<select data-map="${k}">${none ? `<option value="-1">${none}</option>` : ''}${im.cols.filter(c => types.includes(c.type)).map(c => `<option value="${c.i}" ${im.map[k] === c.i ? 'selected' : ''}>${esc(c.name)} (${c.type})</option>`).join('')}</select>`;
    return `<div class="mapper"><b>${esc(im.meta.title)}</b><p class="muted">${im.table.rows.length.toLocaleString()} rows · ${im.cols.length} columns</p>
      ${field('Time', opt('time', ['date'], 'None (one moment)'))}
      ${field('Place or category', opt('category', ['state', 'country', 'text'], 'None (single series)'))}
      ${field('Value', opt('value', ['number'], ''))}
      ${field('Combine duplicate rows by', `<select data-map="agg">${['sum', 'mean', 'max', 'min', 'count'].map(a => `<option ${im.map.agg === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`)}
      <button class="btn primary block" data-act="build">Build chart</button>
      <table><tr>${im.table.header.slice(0, 5).map(h => `<th>${esc(h)}</th>`).join('')}</tr>${im.table.rows.slice(0, 4).map(r => `<tr>${r.slice(0, 5).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  }

  AFTER.data = () => {
    $('#searchForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      S.search = { q: $('#q').value.trim(), results: [], busy: true, err: '' }; renderStep();
      try { const r = await PS.searchCatalog(S.search.q); S.search.results = r.results; if (!r.results.length) S.search.err = 'No downloadable datasets matched. Try broader words.'; }
      catch (err) { S.search.err = err.message; }
      S.search.busy = false; renderStep();
    });
    $('#file')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 40e6) { toast('That file is over 40 MB. Filter it first.'); return; }
      importTable(await f.text(), { title: f.name.replace(/\.[^.]+$/, ''), category: 'Your data', source: { publisher: 'Uploaded by user', dataset: f.name, unverified: true }, caveats: ['Plainsight could not verify where this file came from. Cite the original publisher before sharing.'] });
    });
  };

  function importTable(text, meta) {
    try {
      const table = PS.parseCSV(text);
      if (!table.rows.length) throw new Error('No rows found.');
      const cols = PS.profile(table);
      S.imported = { table, cols, map: PS.guessMapping(cols), meta };
      renderStep();
    } catch (e) { toast('Could not read that file: ' + e.message); }
  }

  $('#stepBody').addEventListener('click', async e => {
    const t = e.target.closest('button, [data-ds]'); if (!t) return;
    if (t.dataset.tab) { S.dataTab = t.dataset.tab; renderStep(); return; }
    if (t.dataset.ds) { selectDataset(t.dataset.ds); return; }
    if (t.dataset.load != null) {
      const r = S.search.results[+t.dataset.load];
      t.disabled = true; t.textContent = 'Loading…';
      try {
        const text = await PS.fetchRemoteText(r.files[0].url);
        importTable(text, { title: r.title, category: 'data.gov', description: r.description, source: { publisher: r.publisher, dataset: r.title, url: r.landing }, howToRead: [r.description.slice(0, 220)] });
      } catch (err) { toast(err.message); t.disabled = false; t.textContent = 'Load data'; }
      return;
    }
    if (t.dataset.chart) { o.chart = t.dataset.chart; Object.assign(o, { takeawayText: '' }); update(); renderStep(); return; }
    if (t.dataset.theme) { o.theme = t.dataset.theme; o.bg = ''; update(); renderStep(); return; }
    if (t.dataset.pal) { o.palette = t.dataset.pal; update(); renderStep(); return; }
    if (t.dataset.ramp) { o.ramp = t.dataset.ramp; update(); renderStep(); return; }
    if (t.dataset.fmt) { o.format = t.dataset.fmt; S.p = 1; update(); renderStep(); return; }
    const act = t.dataset.act; if (!act) return;
    ACTIONS[act]?.(t);
  });

  const ACTIONS = {
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
        S.imported = null; S.dataTab = 'featured';
        selectDataset(ds.id);
        if (skipped) toast(`${skipped.toLocaleString()} rows skipped (missing or unreadable values).`);
      } catch (e) { toast(e.message); }
    },
    resetStory: () => { o.title = S.ds.title; o.subtitle = autoSubtitle(S.ds); o.kicker = ''; o.takeawayText = ''; o.scriptEdited = false; update(); renderStep(); },
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
    png: async () => { const prev = o.format; o.format = 'image'; update({ panels: false }); await PS.exportPNG(renderer, `${PS.slug(o.title)}-${o.platform}`); o.format = prev; update({ panels: false }); toast('PNG saved.'); },
    video: async t => {
      pause(); S.exporting = true; t.disabled = true;
      const bar = $('#exportProgress i'), ctrl = new AbortController(); S.abort = ctrl;
      $('#cancelExport').hidden = false;
      try {
        const prev = o.format; o.format = 'video'; update({ panels: false });
        const { blob, ext } = await PS.exportVideo({ renderer, duration: o.duration, audioBuffer: S.audio?.buffer, signal: ctrl.signal, onProgress: p => (bar.style.width = (p * 100).toFixed(1) + '%') });
        o.format = prev;
        await PS.download(blob, `${PS.slug(o.title)}-${o.platform}.${ext}`);
        toast(`Video saved (${ext.toUpperCase()}, ${(blob.size / 1e6).toFixed(1)} MB).`);
      } catch (e) { toast(e.message); }
      S.exporting = false; t.disabled = false; $('#cancelExport').hidden = true; bar.style.width = '0'; S.p = 1; update({ panels: false });
    },
    cancel: () => S.abort?.abort(),
    copyCaption: () => { navigator.clipboard.writeText($('#postCaption').value).then(() => toast('Caption copied.')); },
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
    if (el.dataset.map) { S.imported.map[el.dataset.map] = el.dataset.map === 'agg' ? el.value : +el.value; return; }
    if (el.dataset.color != null) { o.customColors[+el.dataset.color] = el.value; o.palette = 'custom'; update(); return; }
    const k = el.dataset.k; if (!k) return;
    let v = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? +el.value : el.value;
    if (k === 'script') o.scriptEdited = true;
    if (k === 'rangeStart' || k === 'rangeEnd') v = v === '' ? null : +v;
    o[k] = v;
    const out = el.closest('.field')?.querySelector('output');
    if (out) out.textContent = OUTFMT[k] ? OUTFMT[k](v) : v;
    if (k === 'rangeStart' || k === 'rangeEnd') o.subtitle = autoSubtitle(S.ds);
    update({ panels: !['title', 'subtitle', 'kicker', 'handle', 'note'].includes(k) || true });
    if (el.dataset.rerender != null) renderStep();
    if (k === 'script') { const f = $('#scriptFit'); if (f) f.innerHTML = fitText(); }
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
    let html = `<h3>Chart type</h3><div class="chart-grid">${charts.map(c => `<button class="chart-opt ${o.chart === c.id ? 'active' : ''}" data-chart="${c.id}"><svg viewBox="0 0 24 24"><path d="${c.icon}"/></svg><b>${c.name}${PS.defaultChart(ds) === c.id ? ' <span class="badge">Best fit</span>' : ''}</b><span>${c.desc}</span></button>`).join('')}</div>`;
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
    if (['line', 'area'].includes(o.chart)) html += check('zeroBase', 'Start axis at zero (recommended)') + check('annotate', 'Label the peak');
    if (o.chart === 'columns' && ds.kind !== 'events') html += check('highlightLast', 'Highlight latest year');
    if (o.chart === 'choropleth') html += check('colorZero', 'Color scale starts at zero');
    if (ds.kind !== 'events' && !ds.singleTime) {
      const [a, b] = timeBounds(ds), y0 = yearOf(a), y1 = yearOf(b);
      const years = d3.range(y0, y1 + 1);
      const sv = o.rangeStart != null ? yearOf(o.rangeStart) : '', ev = o.rangeEnd != null ? yearOf(o.rangeEnd) : '';
      html += field('Time range', `<div class="row"><select id="rs"><option value="">From ${y0}</option>${years.map(y => `<option ${y === sv ? 'selected' : ''}>${y}</option>`).join('')}</select><select id="re"><option value="">To ${y1}</option>${years.map(y => `<option ${y === ev ? 'selected' : ''}>${y}</option>`).join('')}</select></div><p class="muted">Plainsight warns you if a shorter range flips the long-term trend.</p>`);
    }
    html += '<h3>Motion</h3>' + field('Pacing', select('motion', [['steady', 'Steady (best for reading values)'], ['smooth', 'Smooth (eases in and out)']]));
    return html;
  };
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
    const voices = PS.voices();
    let html = `<h3>Headline</h3>
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
      ${check('brand', 'Show "Made with Plainsight"')}
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

  // ---------- step: export ----------
  STEPS.export = () => {
    if (!S.ds) return '<p class="muted">Pick data first.</p>';
    const P = PS.PLATFORMS[o.platform];
    const mime = PS.videoMime();
    const caption = `${o.title}\n\n${o.takeawayText || S.analysis.headline}\n\nSource: ${S.ds.source.publisher}${S.ds.source.dataset ? ', ' + S.ds.source.dataset : ''}${S.ds.source.url ? ' ' + S.ds.source.url : ''} (retrieved ${PS.fmtRetrieved(S.ds.retrieved)}).`;
    return `<h3>Format</h3><div class="tabs">${[['video', 'Video'], ['image', 'Image']].map(([k, l]) => `<button data-fmt="${k}" class="${o.format === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <h3>Platform</h3><div class="chips">${Object.entries(PS.PLATFORMS).map(([id, p]) => `<button class="chip ${o.platform === id ? 'active' : ''}" data-platform-x="${id}">${p.ratio} · ${esc(p.name)}</button>`).join('')}</div>
      <p class="muted">${P.w}×${P.h}px. Content stays inside the platform's safe area; toggle "Safe zones" under the preview to see it.</p>
      ${o.format === 'video' ? field('Length', range('duration', 6, 90), o.duration + 's') + `<p class="muted">${P.dur}s is the sweet spot for ${esc(P.name.split(' (')[0])}.</p>` : ''}
      <h3>Download</h3>
      ${o.format === 'video' ? `<button class="btn primary block" data-act="video" ${mime ? '' : 'disabled'}>Export video${mime ? ` (${mime.startsWith('video/mp4') ? 'MP4' : 'WebM'})` : ''}</button>
        <div class="progress" id="exportProgress"><i></i></div><button class="btn block" id="cancelExport" data-act="cancel" hidden style="margin-top:6px">Cancel</button>
        <p class="muted">Renders in real time (${o.duration}s). Keep this tab visible while it records.${S.audio ? ' Includes your voiceover.' : ''}</p>` : ''}
      <button class="btn ${o.format === 'image' ? 'primary' : ''} block" data-act="png" style="margin-top:6px">Export PNG (final frame)</button>
      <h3>Post caption</h3><textarea id="postCaption" style="min-height:140px">${esc(caption)}</textarea>
      <button class="btn block" data-act="copyCaption">Copy caption</button>
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
      <ul class="facts">${a.facts.map(f => `<li>${esc(f.text)}</li>`).join('')}</ul>
      ${ds.howToRead?.length ? `<div class="howto"><b>How to read it</b>${ds.howToRead.map(h => esc(h)).join(' ')}</div>` : ''}
      <h2>Trust check</h2><div class="trust-score"><b>${pass}</b> passed · <b>${warn}</b> to review</div>
      <ul class="checks">${a.checks.map(c => `<li><span class="ic ${c.level}">${c.level === 'pass' ? '✓' : c.level === 'warn' ? '!' : 'i'}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p>${c.action ? actionBtn(c.action) : ''}</div></li>`).join('')}</ul>
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

  // ---------- boot ----------
  (async function boot() {
    renderPlatforms();
    S.catalog = await PS.loadCatalog();
    const fonts = ['Inter', 'Source Serif 4', 'Archivo', 'IBM Plex Mono'].flatMap(f => [400, 600, 700, 800].map(w => document.fonts.load(`${w} 40px "${f}"`)));
    await Promise.race([Promise.allSettled(fonts), new Promise(r => setTimeout(r, 2500))]);
    const start = new URLSearchParams(location.search).get('d') || 'us-unemployment';
    await selectDataset(S.catalog.some(c => c.id === start) ? start : S.catalog[0]?.id);
    document.fonts.ready.then(() => { renderer.layout = null; update({ panels: false }); });
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => S.step === 'story' && renderStep();
  })();
})(window.PS);
