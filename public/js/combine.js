// Plainsight overlays: put two or more datasets in one visual, honestly.
//
// The method follows from what the datasets are, never from what looks dramatic:
//   shared   one axis      same unit and comparable scale
//   indexed  growth = 100  different units, all values positive
//   stacked  panels        different units, shared timeline (works for anything)
//   scatter  one dot/place two place-level datasets on the same geography
// Two y-axes are never used: with two scales any two lines can be made to look related.
(function (PS) {
  const YEAR = 365.25 * 864e5;
  const yearOf = t => new Date(t).getUTCFullYear();
  const GEO_NAME = { 'us-states': 'state', 'us-counties': 'county', world: 'country' };

  // A dataset as one time series, if it can be: the main series of a time series,
  // the chosen state of a state dataset, or its national line.
  PS.asSeries = function (ds, o = {}) {
    if (ds.kind === 'timeseries') {
      const id = (ds.defaultSeries || [ds.series[0].id])[0];
      const s = ds.series.find(x => x.id === id) || ds.series[0];
      return { key: ds.id, name: shortTitle(ds), unit: ds.unit, pts: s.pts, ds };
    }
    if (ds.kind === 'panel' && !ds.singleTime) {
      const e = o.focus && ds.entities.find(x => x.id === o.focus);
      if (e) return { key: ds.id, name: `${shortTitle(ds)} (${e.name})`, unit: ds.unit, pts: ds._tms.map((t, i) => ({ t, v: e.values[i] })).filter(p => p.v != null), ds, place: e.name };
      if (ds.national) return { key: ds.id, name: `${shortTitle(ds)} (U.S.)`, unit: ds.unit, pts: ds._tms.map((t, i) => ({ t, v: ds.national.values[i] })).filter(p => p.v != null), ds, place: 'United States' };
    }
    return null;
  };
  // Lowercase for mid-sentence use without breaking "U.S.", "GDP", "CO₂" or place names.
  const lc = t => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const both = names => names.map((n, i) => (i ? lc(n) : cap(n))).join(' and ');
  const shortTitle = ds => cap(ds.title.replace(/^U\.S\. /, '').replace(/ by (state|county|country)$/i, '').replace(/, adjusted for inflation$/, ' (inflation-adjusted)'));

  function overlap(series) {
    const lo = Math.max(...series.map(s => s.pts[0].t)), hi = Math.min(...series.map(s => s.pts.at(-1).t));
    return hi > lo ? [lo, hi] : null;
  }
  const median = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const sameFamily = (a, b) => a.id === b.id || (a.reframes && a.reframes.includes(b.id));
  const isNominal = ds => ['usd', 'usdT', 'usdB'].includes(ds.unit.format) && !/inflation|today's dollars|real/i.test(ds.title + ' ' + ds.unit.label + ' ' + (ds.lens || ''));
  const isReal = ds => /inflation-adjusted|inflation|today's dollars|\(real\)/i.test(ds.title + ' ' + ds.unit.label + ' ' + (ds.lens || ''));

  // Common years with values for both place-level datasets.
  function scatterYears(a, b) {
    const ya = new Map(a._tms.map((t, i) => [yearOf(t), i])), yb = new Map(b._tms.map((t, i) => [yearOf(t), i]));
    return [...ya.keys()].filter(y => yb.has(y)).sort((x, y) => x - y).map(y => ({ y, ia: ya.get(y), ib: yb.get(y) }));
  }

  // What can the candidate do with the base dataset(s)? Returns allowed methods and
  // a plain-language reason when nothing is allowed.
  PS.compatibility = function (bases, cand, o = {}) {
    const all = [...bases, cand];
    if (bases.some(b => sameFamily(b, cand))) return { ok: false, reason: 'Same data in a different lens. Use the lens switch instead.' };
    if (cand.kind === 'events' || bases.some(b => b.kind === 'events')) return { ok: false, reason: 'Event records (like earthquakes) are not measurements over time or place, so they can\'t be lined up with other data.' };
    const methods = [];
    // Place-by-place comparison
    if (all.length === 2 && all.every(d => d.kind === 'panel' && d.geo)) {
      const [a, b] = all;
      if (a.geo !== b.geo) return { ok: false, reason: `One is by ${GEO_NAME[a.geo]}, the other by ${GEO_NAME[b.geo]}. Places have to match to compare them.` };
      const years = scatterYears(a, b);
      const ids = new Set(a.entities.map(e => e.id));
      const common = b.entities.filter(e => ids.has(e.id)).length;
      if (!years.length) return { ok: false, reason: `They share no year: ${shortTitle(a)} covers ${yearOf(a._tms[0])}–${yearOf(a._tms.at(-1))}, ${shortTitle(b)} covers ${yearOf(b._tms[0])}–${yearOf(b._tms.at(-1))}.` };
      if (common < 10) return { ok: false, reason: 'Fewer than 10 places appear in both.' };
      methods.push({ id: 'scatter', name: `Scatter: one dot per ${GEO_NAME[a.geo]}`, years, common });
    }
    // Over time
    const ser = all.map(d => PS.asSeries(d, o));
    if (ser.every(Boolean)) {
      const ov = overlap(ser);
      if (!ov) { if (!methods.length) return { ok: false, reason: 'They don\'t cover any of the same dates.' }; }
      else if ((ov[1] - ov[0]) / YEAR < 1.5 && !methods.length) return { ok: false, reason: 'They overlap by less than two years, too short to compare trends.' };
      else {
        const inWin = s => s.pts.filter(p => p.t >= ov[0] && p.t <= ov[1]);
        const fmt0 = all[0].unit.format;
        const sameUnit = all.every(d => d.unit.format === fmt0);
        const meds = ser.map(s => Math.abs(median(inWin(s).map(p => p.v)) || 0));
        const comparable = Math.max(...meds) / Math.max(1e-9, Math.min(...meds)) < 15;
        if (sameUnit && comparable && all.length <= 4) methods.push({ id: 'shared', name: 'One shared axis' });
        // Indexing a rate (4% -> 6% shown as "+50%") misleads, so only quantities get indexed.
        const isLevel = d => d.unit.format !== 'pct' && !d.isRate && !d.zeroLine && !/index/i.test(d.unit.label);
        if (all.every(isLevel) && ser.every(s => inWin(s).every(p => p.v > 0)) && all.length <= 4) methods.push({ id: 'indexed', name: 'Growth, indexed to 100' });
        if (all.length <= 3) methods.push({ id: 'stacked', name: 'Stacked panels, shared timeline' });
      }
    } else if (!methods.length) {
      const bad = all.find((d, i) => !ser[i]);
      return { ok: false, reason: bad.singleTime ? `${shortTitle(bad)} is a single snapshot, so it has no timeline to line up.` : `${shortTitle(bad)} is by ${GEO_NAME[bad.geo] || 'place'} with no national line. Pick a state first, or compare it with another ${GEO_NAME[bad.geo] || 'place'}-level dataset.` };
    }
    if (!methods.length) return { ok: false, reason: 'No honest way to put these together.' };
    return { ok: true, methods };
  };

  // Builds the combined dataset the renderer and explainer work from.
  PS.combine = function (dss, method, o = {}) {
    const srcs = dss.map(d => d.source);
    const source = {
      publisher: [...new Set(srcs.map(s => s.publisher))].join('; '),
      dataset: dss.map(d => `${shortTitle(d)}: ${d.source.dataset || d.source.publisher}`).join('; '),
      via: [...new Set(srcs.map(s => s.via).filter(Boolean))].join('; ') || undefined,
    };
    const base = {
      id: 'combo:' + dss.map(d => d.id).join('+') + ':' + method, combo: { method, parts: dss }, source,
      category: dss[0].category, retrieved: dss.map(d => d.retrieved).sort()[0], lastObservation: dss.map(d => d.lastObservation).sort()[0],
      tier: dss.some(d => d.tier === 'industry') ? 'industry' : dss[0].tier, caveats: [], howToRead: [],
    };
    if (method === 'scatter') {
      const [a, b] = dss, years = scatterYears(a, b);
      const bIdx = new Map(b.entities.map(e => [e.id, e]));
      const points = a.entities.filter(e => bIdx.has(e.id)).map(e => {
        const f = bIdx.get(e.id);
        return { id: e.id, name: e.short || e.name, pop: e.pop ?? f.pop, xs: years.map(y => e.values[y.ia]), ys: years.map(y => f.values[y.ib]) };
      }).filter(p => p.xs.some(v => v != null) && p.ys.some(v => v != null));
      // Very skewed measures (GDP, population) bunch up near zero; show them on a log scale.
      const skewed = vals => { const v = vals.filter(x => x != null).sort((p, q) => p - q); if (!v.length || v[0] <= 0) return false; const med = v[Math.floor(v.length / 2)], hi = v[Math.floor(v.length * 0.99)]; return hi / med > 15; };
      const logX = skewed(points.flatMap(p => p.xs)), logY = skewed(points.flatMap(p => p.ys));
      return { ...base, kind: 'scatter', geo: a.geo, logX, logY, x: { title: shortTitle(a), unit: a.unit }, y: { title: shortTitle(b), unit: b.unit },
        years: years.map(y => y.y), points, frequency: 'annual', title: `${shortTitle(b)} vs. ${lc(shortTitle(a))}`,
        unit: b.unit };
    }
    const ser = dss.map(d => PS.asSeries(d, o));
    const ov = overlap(ser);
    const win = s => s.pts.filter(p => p.t >= ov[0] && p.t <= ov[1]);
    const freqRank = { daily: 0, 'real-time': 0, weekly: 1, monthly: 2, quarterly: 3, annual: 4 };
    const frequency = dss.map(d => d.frequency).sort((x, y) => (freqRank[y] ?? 2) - (freqRank[x] ?? 2))[0];
    let series, unit, baseDate;
    if (method === 'indexed') {
      baseDate = ov[0];
      series = ser.map((s, i) => {
        const pts = win(s), b0 = pts[0].v;
        return { id: 's' + i, name: s.name, unit: s.unit, raw: pts, pts: pts.map(p => ({ t: p.t, v: (p.v / b0) * 100 })), points: [] };
      });
      unit = { label: `Index, ${PS.fmtDate(baseDate, frequency === 'annual' ? 'annual' : 'monthly')} = 100`, format: 'number', decimals: 0 };
    } else {
      series = ser.map((s, i) => ({ id: 's' + i, name: s.name, unit: s.unit, raw: win(s), pts: win(s), points: [] }));
      unit = method === 'shared' ? { ...dss[0].unit, label: dss[0].unit.label } : dss[0].unit;
    }
    return { ...base, kind: 'timeseries', series, defaultSeries: series.map(s => s.id), unit, frequency, baseDate, refLine: method === 'indexed' ? 100 : null,
      title: series.map(s => s.name).join(' vs. '), window: ov };
  };

  // ---------- explanations ----------
  const pearson = (xs, ys) => {
    const n = xs.length; if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  };
  PS.pearson = pearson;
  const strength = r => { const a = Math.abs(r); return a < 0.1 ? 'no meaningful' : a < 0.3 ? 'a weak' : a < 0.6 ? 'a moderate' : 'a strong'; };

  PS.analyzeCombo = function (ds, o) {
    const m = ds.combo.method, parts = ds.combo.parts, checks = [], facts = [];
    const add = (level, title, detail, action) => checks.push({ level, title, detail, action });
    let headline, howTo;
    const f = ds.frequency, d = t => PS.fmtDate(t, f === 'weekly' || f === 'daily' ? 'monthly' : f, true);

    if (m === 'scatter') {
      const yi = ds.years.length - 1, year = ds.years[yi];
      const rank = PS.rankable(o);
      const tx = v => (ds.logX ? Math.log10(v) : v), ty = v => (ds.logY ? Math.log10(v) : v);
      const pts = ds.points.filter(p => rank(p) && p.xs[yi] != null && p.ys[yi] != null && (!ds.logX || p.xs[yi] > 0) && (!ds.logY || p.ys[yi] > 0));
      const r = pearson(pts.map(p => tx(p.xs[yi])), pts.map(p => ty(p.ys[yi])));
      const unitName = { state: 'states', county: 'counties', country: 'countries' }[GEO_NAME[ds.geo]];
      // "median household income (inflation-adjusted)" rather than repeating the title inside the unit.
      const axis = (t, u) => (lc(u.label).toLowerCase().includes(lc(t).toLowerCase()) ? lc(u.label) : `${lc(t)} (${lc(u.label)})`);
      howTo = `Each dot is one ${GEO_NAME[ds.geo]}. Left to right: ${axis(ds.x.title, ds.x.unit)}. Bottom to top: ${axis(ds.y.title, ds.y.unit)}. The dashed line shows the overall pattern.${ds.logX || ds.logY ? ' Log scale: each step is ten times the last.' : ''}`;
      const dir = r > 0 ? `${unitName} with higher ${lc(ds.x.title)} tend to have higher ${lc(ds.y.title)}` : `${unitName} with higher ${lc(ds.x.title)} tend to have lower ${lc(ds.y.title)}`;
      headline = r == null ? `${ds.title}, ${year}.` : Math.abs(r) < 0.1 ? `Across ${pts.length} ${unitName}, ${lc(ds.x.title)} and ${lc(ds.y.title)} show no clear relationship (${year}).` : `Across ${pts.length} ${unitName}, ${dir}: ${strength(r)} relationship (r = ${r.toFixed(2)}) in ${year}.`;
      facts.push({ k: 'r', text: `Correlation: r = ${r == null ? 'n/a' : r.toFixed(2)} (${r == null ? '' : strength(r).replace(/^a /, '')}). It runs from -1 to 1; 0 means no linear relationship.` });
      if (r != null && pts.length > 5) {
        const xs = pts.map(p => tx(p.xs[yi])), ys = pts.map(p => ty(p.ys[yi]));
        const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
        const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        const res = pts.map((p, i) => ({ p, e: ys[i] - (my + slope * (xs[i] - mx)) })).sort((a, b) => Math.abs(b.e) - Math.abs(a.e));
        facts.push({ k: 'out', text: `Furthest from the pattern: ${res.slice(0, 3).map(x => `${x.p.name} (${x.e > 0 ? 'higher' : 'lower'} than expected)`).join(', ')}.` });
        if (o.highlight) {
          const h = pts.find(p => p.id === o.highlight);
          if (h) facts.push({ k: 'focus', text: `${h.name}: ${PS.fmt(h.xs[yi], ds.x.unit)} and ${PS.fmt(h.ys[yi], ds.y.unit)}.` });
        }
      }
      if (ds.years.length > 1) {
        const r0 = (() => { const p0 = ds.points.filter(p => rank(p) && p.xs[0] > (ds.logX ? 0 : -Infinity) && p.ys[0] > (ds.logY ? 0 : -Infinity)); return pearson(p0.map(p => tx(p.xs[0])), p0.map(p => ty(p.ys[0]))); })();
        if (r0 != null && r != null) facts.push({ k: 'trend', text: `In ${ds.years[0]} the correlation was ${r0.toFixed(2)}; in ${year} it is ${r.toFixed(2)}.` });
      }
      add('warn', 'Correlation, not cause', `A pattern across ${unitName} does not show that one causes the other. Both may follow something else, like cost of living, population density or age. It also says nothing about individuals within each ${GEO_NAME[ds.geo]}.`);
      if (ds.logX || ds.logY) add('info', 'Log scale', `${[ds.logX && ds.x.title, ds.logY && ds.y.title].filter(Boolean).join(' and ')} ${ds.logX && ds.logY ? 'are' : 'is'} spread so unevenly that a normal scale would pile almost every ${GEO_NAME[ds.geo]} into one corner. Each step on a log scale is ten times the last, and the correlation is computed on the same scale.`);
      if (pts.length < 20) add('info', 'Few data points', `Only ${pts.length} ${unitName}, so one unusual ${GEO_NAME[ds.geo]} can swing the pattern.`);
      add('pass', 'Matched place by place, year by year', `Only ${unitName} and years present in both datasets are shown (${ds.years[0]}${ds.years.length > 1 ? '–' + year : ''}).`);
    } else {
      const S = ds.series, ov = ds.window;
      const span = `${d(ov[0])} to ${d(ov[1])}`;
      if (m === 'shared') {
        howTo = `Both are measured in ${parts[0].unit.format === 'pct' ? 'percent' : 'the same unit'} at a similar scale, so they share one axis. ${parts[0].unit.label !== parts[1].unit.label ? 'They measure different things that happen to use the same unit.' : ''}`;
        const last = S.map(s => s.pts.at(-1));
        const gap = last[0].v - last[1].v;
        let cross = 0, above = 0, n = 0;
        const b = new Map(S[1].pts.map(p => [Math.round(p.t / 864e5 / 28), p.v]));
        let prev = null;
        for (const p of S[0].pts) { const v2 = b.get(Math.round(p.t / 864e5 / 28)); if (v2 == null) continue; const sgn = Math.sign(p.v - v2); if (prev != null && sgn && sgn !== prev) cross++; if (sgn) prev = sgn; if (p.v > v2) above++; n++; }
        headline = `${cap(S[0].name)} was ${PS.fmt(last[0].v, S[0].unit)} and ${lc(S[1].name)} ${PS.fmt(last[1].v, S[1].unit)} as of ${d(Math.min(last[0].t, last[1].t))}, a gap of ${PS.fmtChange(last[1].v, last[0].v, S[0].unit).replace(/^[+-]/, '').replace(/ \(.*\)$/, '')}.`;
        if (n) facts.push({ k: 'above', text: `${cap(S[0].name)} was higher ${Math.round(above / n * 100)}% of the time between ${span}.` });
        if (n) facts.push({ k: 'cross', text: `The lines crossed ${cross} time${cross === 1 ? '' : 's'}.` });
      } else if (m === 'indexed') {
        const sameFmt = parts.every(p => p.unit.format === parts[0].unit.format);
        howTo = (sameFmt ? `Both are in ${parts[0].unit.format.startsWith('usd') ? 'dollars' : 'the same unit'}, but at very different levels, so` : `They use different units (${parts.map(p => lc(p.unit.label)).join(' vs. ')}), so`) + ` each line starts at 100 in ${d(ov[0])} and shows growth from there. Compare how fast they grew, not their levels.`;
        const g = S.map(s => ({ s, pct: s.pts.at(-1).v - 100 }));
        const [a, b] = g;
        const fmtPct = x => `${x >= 0 ? '+' : ''}${Math.round(x)}%`;
        const ratio = a.pct > 0 && b.pct > 0 ? Math.max(a.pct, b.pct) / Math.min(a.pct, b.pct) : null;
        const fast = a.pct >= b.pct ? a : b, slow = fast === a ? b : a;
        headline = `Since ${d(ov[0])}, ${lc(a.s.name)} changed ${fmtPct(a.pct)} while ${lc(b.s.name)} changed ${fmtPct(b.pct)}.` + (ratio && ratio >= 1.3 ? ` ${cap(fast.s.name)} grew ${ratio.toFixed(1)} times as fast.` : '');
        g.forEach(x => facts.push({ k: 'g', text: `${x.s.name}: ${PS.fmt(x.s.raw[0].v, x.s.unit)} → ${PS.fmt(x.s.raw.at(-1).v, x.s.unit)} (${fmtPct(x.pct)}).` }));
        if (g.length === 2) facts.push({ k: 'slow', text: `For every 1% rise in ${lc(slow.s.name)}, ${lc(fast.s.name)} rose about ${(fast.pct / Math.max(0.01, slow.pct)).toFixed(1)}%.` });
        const nom = parts.filter(isNominal), real = parts.filter(isReal);
        if (nom.length && real.length) add('warn', 'Mixes adjusted and unadjusted dollars', `${nom.map(shortTitle).join(', ')} ${nom.length > 1 ? 'are' : 'is'} in nominal dollars while ${real.map(shortTitle).join(', ')} ${real.length > 1 ? 'are' : 'is'} adjusted for inflation, which exaggerates the gap. Switch one to the same lens.`);
        add('info', 'Index starts at a chosen date', `Growth comparisons depend on the start date. Starting in a boom or a slump can change the story; try a different time range to check.`);
      } else {
        howTo = `They use different units, so each gets its own panel with its own scale, on one shared timeline. Compare timing and direction, not heights.`;
        const yearly = S.map(s => { const m2 = new Map(); s.pts.forEach(p => { const y = yearOf(p.t); if (!m2.has(y)) m2.set(y, []); m2.get(y).push(p.v); }); return new Map([...m2].map(([y, a]) => [y, a.reduce((x, z) => x + z, 0) / a.length])); });
        const ys = [...yearly[0].keys()].filter(y => yearly.every(m2 => m2.has(y))).sort();
        let same = 0, n = 0;
        for (let i = 1; i < ys.length; i++) { const dirs = yearly.map(m2 => Math.sign(m2.get(ys[i]) - m2.get(ys[i - 1]))); if (dirs.every(x => x)) { n++; if (dirs.every(x => x === dirs[0])) same++; } }
        const peaks = S.map(s => s.pts.reduce((a, p) => (p.v > a.v ? p : a)));
        headline = n >= 3 ? `${both(S.map(s => s.name))} moved in the same direction in ${same} of ${n} years between ${yearOf(ov[0])} and ${yearOf(ov[1])}.` : `${both(S.map(s => s.name))}, ${span}.`;
        S.forEach((s, i) => facts.push({ k: 'peak', text: `${s.name} peaked at ${PS.fmt(peaks[i].v, s.unit)} in ${d(peaks[i].t)}; latest ${PS.fmt(s.pts.at(-1).v, s.unit)}.` }));
      }
      if (m !== 'scatter') add('pass', 'No second y-axis', 'Two y-axes can make any two lines look related, so they are never used. Shared axes, indexes and stacked panels keep the comparison honest.');
      add('info', 'Shared years only', `Shown only for the period both datasets cover: ${span}.`);
      add('info', 'Moving together is not cause', 'Two measures can rise and fall together because both respond to the same forces (the economy, population growth, prices) without one driving the other.');
    }
    parts.filter(p => p.tier === 'industry').forEach(p => add('warn', 'Company data', `${shortTitle(p)} comes from ${p.source.publisher}, a company. ${(PS.REGISTRY?.thirdParty || []).find(x => x.id === p.sourceId)?.disclosure || ''}`));
    add('pass', 'Every source cited', `${parts.map(p => p.source.publisher).filter((v, i, a) => a.indexOf(v) === i).join('; ')}. Retrieved ${PS.fmtRetrieved(ds.retrieved)}.`);
    parts.forEach(p => (p.caveats || []).slice(0, 1).forEach(c => add('info', `About ${lc(shortTitle(p))}`, c)));
    const script = [o.title || ds.title, headline, howTo, facts[0]?.text || '', `Sources: ${ds.source.publisher}.`].filter(Boolean).join(' ');
    const view = m === 'scatter' ? { scatter: true } : { series: ds.series };
    return { headline, facts, checks, script, view, howTo, trend: 0 };
  };
})(window.PS);
