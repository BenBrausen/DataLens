// Plainsight explanation engine.
// Every sentence is computed from the data on screen (no generated guesses), so the
// takeaway, captions and voiceover can always be traced back to a number.
(function (PS) {
  const DAY = 864e5;
  const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
  const short = ds => ds.shortTitle || ds.title.replace(/^U\.S\. /, 'The U.S. ').replace(/, adjusted for inflation$/, ' (inflation-adjusted)');
  const yr = t => new Date(t).getUTCFullYear();

  // Applies the user's time window to a dataset view.
  PS.windowed = function (ds, o) {
    const lo = o.rangeStart ?? -Infinity, hi = o.rangeEnd ?? Infinity;
    if (ds.kind === 'timeseries') {
      const ids = o.series?.length ? o.series : (ds.defaultSeries || [ds.series[0].id]);
      const series = ds.series.filter(s => ids.includes(s.id)).map(s => ({ ...s, pts: s.pts.filter(p => p.t >= lo && p.t <= hi) })).filter(s => s.pts.length);
      return { series: series.length ? series : [ds.series[0]] };
    }
    if (ds.kind === 'panel') {
      const idx = ds._tms.map((t, i) => (t >= lo && t <= hi ? i : -1)).filter(i => i >= 0);
      const use = idx.length ? idx : ds._tms.map((_, i) => i);
      return { idx: use, tms: use.map(i => ds._tms[i]) };
    }
    return { events: ds.events.filter(e => e.tm >= lo && e.tm <= hi) };
  };

  function tsFacts(ds, view) {
    const s = view.series[0], pts = s.pts, u = ds.unit, f = ds.frequency;
    const first = pts[0], last = pts[pts.length - 1];
    let peak = first, trough = first, sum = 0;
    for (const p of pts) { if (p.v > peak.v) peak = p; if (p.v < trough.v) trough = p; sum += p.v; }
    const avg = sum / pts.length;
    const below = pts.filter(p => p.v < last.v).length / pts.length;
    const yearAgo = pts.reduce((best, p) => (Math.abs(p.t - (last.t - 365 * DAY)) < Math.abs(best.t - (last.t - 365 * DAY)) ? p : best), first);
    const d = t => PS.fmtDate(t, f, true), v = x => PS.fmt(x, u);
    const name = short(ds), startY = yr(first.t);
    const facts = [];
    let headline;
    if (last.t === peak.t && pts.length > 10) headline = `${name} hit ${v(last.v)} in ${d(last.t)}, the highest on record since ${startY}.`;
    else if (last.t === trough.t && pts.length > 10) headline = `${name} fell to ${v(last.v)} in ${d(last.t)}, the lowest since ${startY}.`;
    else if (u.format === 'usdT' || ds.unit.format === 'usd' && first.v > 0 && last.v / first.v > 1.5)
      headline = `${name} reached ${v(last.v)} in ${d(last.t)}, ${PS.fmtChange(first.v, last.v, u).replace(/^\+/, 'up ')} since ${startY}.`;
    else headline = `${name} was ${v(last.v)} in ${d(last.t)}, ${last.v > avg ? 'above' : 'below'} its ${startY}–${yr(last.t)} average of ${v(avg)}.`;
    facts.push({ k: 'latest', text: `Latest: ${v(last.v)} (${d(last.t)}).` });
    facts.push({ k: 'change', text: `Since ${d(first.t)}: ${PS.fmtChange(first.v, last.v, u)}.` });
    if (peak.t !== last.t) facts.push({ k: 'peak', text: `Peak: ${v(peak.v)} in ${d(peak.t)}.` });
    if (trough.t !== last.t) facts.push({ k: 'trough', text: `Low: ${v(trough.v)} in ${d(trough.t)}.` });
    if (last.t - first.t > 2 * 365 * DAY && yearAgo !== last) facts.push({ k: 'yoy', text: `One year earlier it was ${v(yearAgo.v)} (${PS.fmtChange(yearAgo.v, last.v, u)}).` });
    if (pts.length > 24) facts.push({ k: 'pctile', text: `The latest reading is higher than ${Math.round(below * 100)}% of all ${f === 'weekly' ? 'weeks' : f === 'quarterly' ? 'quarters' : f === 'annual' ? 'years' : 'months'} since ${startY}.` });
    if (view.series[1]) {
      const s2 = view.series[1], l2 = s2.pts.at(-1);
      facts.push({ k: 'compare', text: `${s2.name}: ${v(l2.v)} in ${d(l2.t)}.` });
    }
    return { headline, facts, trend: Math.sign(last.v - first.v), stats: { first, last, peak, trough, avg } };
  }

  const vals0 = now => { const a = now.map(x => x.v).sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  function panelFacts(ds, view, o) {
    const u = ds.unit, f = ds.frequency, idx = view.idx;
    const li = idx[idx.length - 1], fi = idx[0];
    const at = i => ds.entities.filter(e => e.values[i] != null).map(e => ({ e, v: e.values[i] })).sort((a, b) => b.v - a.v);
    const now = at(li), then = at(fi);
    const d = i => PS.fmtDate(ds._tms[i], f, true), v = x => PS.fmt(x, u);
    const facts = [];
    if (!now.length) return { headline: ds.title, facts, trend: 0 };
    const top = now[0], bot = now[now.length - 1];
    const lbl = lc(u.label.replace(/\s*\([^)]*\)/g, ''));
    let headline;
    const race = o.chart === 'barrace' || o.chart === 'bars';
    if (race && then.length && then[0].e.id !== top.e.id && fi !== li)
      headline = `${top.e.name} now ranks first in ${lbl} at ${v(top.v)}. In ${PS.fmtDate(ds._tms[fi], f)}, ${then[0].e.name} led.`;
    else headline = `${top.e.name} has the highest ${lbl} (${v(top.v)}) and ${bot.e.name} the lowest (${v(bot.v)}) as of ${d(li)}.`;
    // A chosen state leads the story.
    const fe = o.focus && ds.entities.find(e => e.id === o.focus);
    if (fe && fe.values[li] != null) {
      const val = fe.values[li], rank = now.findIndex(x => x.e.id === fe.id) + 1, n = now.length;
      const us = ds.national?.values[li];
      const ord = k => k + (['th', 'st', 'nd', 'rd'][(k % 100 > 10 && k % 100 < 14) ? 0 : Math.min(k % 10, 4) % 4] || 'th');
      const pos = rank === 1 ? `the highest of ${n}` : rank === n ? `the lowest of ${n}` : rank <= n / 2 ? `${ord(rank)} highest of ${n}` : `${ord(n - rank + 1)} lowest of ${n}`;
      const cmp = us != null ? `${val > us ? 'above' : val < us ? 'below' : 'equal to'} the U.S. (${v(us)})` : `compared with a typical ${ds.geo === 'world' ? 'country' : 'state'} at ${v(vals0(now))}`;
      headline = `${fe.name}'s ${lbl} was ${v(val)} in ${d(li)}, ${cmp}. It ranks ${pos}.`;
      const fa = fe.values[fi];
      if (fi !== li && fa != null) facts.push({ k: 'focus', text: `${fe.name} since ${PS.fmtDate(ds._tms[fi], f)}: ${PS.fmtChange(fa, val, u)}${us != null && ds.national.values[fi] != null ? ` (U.S.: ${PS.fmtChange(ds.national.values[fi], us, u)})` : ''}.` });
    }
    facts.push({ k: 'top', text: `Highest: ${now.slice(0, 3).map(x => `${x.e.name} (${v(x.v)})`).join(', ')}.` });
    facts.push({ k: 'bottom', text: `Lowest: ${now.slice(-3).reverse().map(x => `${x.e.name} (${v(x.v)})`).join(', ')}.` });
    const vals = now.map(x => x.v).sort((a, b) => a - b), med = vals[Math.floor(vals.length / 2)];
    facts.push({ k: 'median', text: `The typical (median) ${ds.geo === 'world' ? 'country' : ds.geo === 'us-states' ? 'state' : 'entry'}: ${v(med)}.` });
    let trend = 0;
    if (fi !== li) {
      const ch = ds.entities.map(e => ({ e, a: e.values[fi], b: e.values[li] })).filter(x => x.a != null && x.b != null && x.a !== 0)
        .map(x => ({ ...x, d: u.format === 'pct' || ds.isRate ? x.b - x.a : (x.b - x.a) / Math.abs(x.a) }));
      if (ch.length) {
        ch.sort((a, b) => b.d - a.d);
        const up = ch[0], dn = ch[ch.length - 1];
        facts.push({ k: 'mover', text: `Biggest rise since ${PS.fmtDate(ds._tms[fi], f)}: ${up.e.name}, ${PS.fmtChange(up.a, up.b, u)}.` });
        if (dn.d < 0) facts.push({ k: 'faller', text: `Biggest drop: ${dn.e.name}, ${PS.fmtChange(dn.a, dn.b, u)}.` });
        const medA = ch.map(x => x.a).sort((a, b) => a - b)[Math.floor(ch.length / 2)], medB = ch.map(x => x.b).sort((a, b) => a - b)[Math.floor(ch.length / 2)];
        trend = Math.sign(medB - medA);
      }
    }
    if (!ds.isRate && u.format !== 'pct' && now.length > 5) {
      const total = vals.reduce((a, b) => a + b, 0), top5 = now.slice(0, 5).reduce((a, x) => a + x.v, 0);
      facts.push({ k: 'share', text: `The top 5 account for ${Math.round(top5 / total * 100)}% of the total across all ${now.length} shown.` });
    }
    return { headline, facts, trend };
  }

  function eventFacts(ds, view) {
    const ev = view.events;
    if (!ev.length) return { headline: 'No events in this range.', facts: [], trend: 0 };
    const big = ev.reduce((a, b) => (b.value > a.value ? b : a));
    const days = Math.max(1, (ev.at(-1).tm - ev[0].tm) / DAY);
    const regions = new Map();
    ev.forEach(e => { const r = (e.label || '').split(', ').pop().replace(/ region$/i, '').trim(); if (r) regions.set(r, (regions.get(r) || 0) + 1); });
    const busiest = [...regions.entries()].sort((a, b) => b[1] - a[1])[0];
    const m5 = ev.filter(e => e.value >= 5).length, m6 = ev.filter(e => e.value >= 6).length;
    const headline = `${ev.length.toLocaleString()} earthquakes of magnitude 2.5 or greater were recorded in ${Math.round(days)} days. The strongest, magnitude ${big.value.toFixed(1)}, struck ${big.label}.`;
    const facts = [
      { k: 'count', text: `${ev.length.toLocaleString()} events, about ${Math.round(ev.length / days)} a day.` },
      { k: 'strong', text: `${m5} reached magnitude 5 or higher; ${m6} reached 6 or higher.` },
      { k: 'big', text: `Largest: M${big.value.toFixed(1)}, ${big.label} (${PS.fmtDate(big.tm, 'daily', true)}).` },
    ];
    if (busiest) facts.push({ k: 'region', text: `Most recorded events: ${busiest[0]} (${busiest[1]}). Dense sensor networks detect more small quakes.` });
    return { headline, facts, trend: 0 };
  }

  const HYPE = /\b(skyrocket\w*|soar\w*|plummet\w*|explod\w*|collaps\w*|crash\w*|surg\w*|spik\w*|crisis|record[- ]breaking|unprecedented|massive|huge)\b/i;

  PS.analyze = function (ds, o) {
    const view = PS.windowed(ds, o);
    const r = ds.kind === 'timeseries' ? tsFacts(ds, view) : ds.kind === 'panel' ? panelFacts(ds, view, o) : eventFacts(ds, view);
    const checks = [];
    const add = (level, title, detail, action) => checks.push({ level, title, detail, action });

    if (ds.source.unverified) add('warn', 'Unverified source', 'This data was uploaded, so Plainsight cannot confirm where it came from. Name the original publisher in the note before sharing.');
    else add('pass', 'Source cited on every frame',`${ds.source.publisher}${ds.source.via ? ', via ' + ds.source.via : ''}. Retrieved ${PS.fmtRetrieved(ds.retrieved)}. Citations can be restyled but not removed.`);

    if (ds.aggWarning) add('warn', `Rows were ${ds.aggWarning.agg === 'sum' ? 'added together' : 'averaged'}`, `${ds.aggWarning.rows.toLocaleString()} rows shared a date or place and were combined. If the file mixes totals with their parts (a state total plus its counties), the result double counts. Check the "Only rows where" filter.`);
    // Source tier
    const TP = (PS.REGISTRY?.thirdParty || []).find(x => x.id === ds.sourceId);
    if (ds.tier === 'industry') add('warn', 'Company data', `${TP?.disclosure || 'This comes from a company with a business interest in the topic.'} The citation labels it as company data.`);
    else if (ds.tier === 'academic' || ds.tier === 'nonprofit') add('info', ds.tier === 'academic' ? 'Academic source' : 'Nonprofit research source', `${TP?.org ? TP.org + '. ' : ''}${TP?.why || ''} ${TP?.disclosure || ''}`.trim());
    else if (ds.tier === 'state') add('pass', 'Official state source', `Published by ${ds.source.publisher} on ${ds.source.portal || 'its open-data portal'}.`);

    // Freshness
    if (ds.lastObservation) {
      const age = (Date.now() - +PS.parseDate(ds.lastObservation)) / DAY;
      const allowed = { 'real-time': 2, daily: 7, weekly: 21, monthly: 75, quarterly: 200, annual: 730 }[ds.frequency] || 400;
      if (age > allowed) add('warn', 'Data may be out of date', `Latest observation is ${PS.fmtDate(ds.lastObservation, ds.frequency, true)}. Check the publisher for a newer release before publishing.`);
      else add('pass', 'Data is current', `Latest observation: ${PS.fmtDate(ds.lastObservation, ds.frequency, true)} (${ds.frequency} release).`);
    }

    // Axis honesty
    if (['line', 'area'].includes(o.chart)) {
      if (o.zeroBase) add('pass', 'Axis starts at zero', 'Changes are shown at true proportion.');
      else add('warn', 'Axis is zoomed in', 'The y-axis does not start at zero, which makes changes look bigger. The chart labels this so viewers know.', { type: 'set', key: 'zeroBase', value: true, label: 'Start at zero' });
    } else if (['bars', 'barrace', 'columns'].includes(o.chart)) add('pass', 'Bars start at zero', 'Always enforced. Truncated bars exaggerate differences.');
    if (o.chart === 'choropleth') add('pass', 'One color scale for every frame', 'Colors mean the same value in every year, so changes on the map are real changes.');

    // Lens checks
    if (ds.reframes && ds.lens === 'Nominal dollars') {
      const alt = ds.reframes.filter(x => x !== ds.id);
      add('warn', 'Not adjusted for inflation', 'Dollar amounts from different years are not directly comparable. Consider another lens of the same data.', { type: 'dataset', ids: alt });
    }
    if (ds.isCount && ds.geo && ['choropleth', 'bars', 'barrace'].includes(o.chart)) {
      add('warn', 'Totals mostly reflect population', 'Big states rank high almost automatically. A per-person rate shows where the problem is actually worse.', { type: 'dataset', ids: (ds.reframes || []).filter(x => x !== ds.id) });
    }

    // Cherry-pick guard
    if ((o.rangeStart != null || o.rangeEnd != null) && ds.kind !== 'events') {
      const full = ds.kind === 'timeseries' ? tsFacts(ds, PS.windowed(ds, { ...o, rangeStart: null, rangeEnd: null })) : panelFacts(ds, PS.windowed(ds, { ...o, rangeStart: null, rangeEnd: null }), o);
      if (full.trend && r.trend && full.trend !== r.trend) add('warn', 'Selected range reverses the long-term trend', `Your range shows ${r.trend > 0 ? 'a rise' : 'a decline'}, but the full record shows ${full.trend > 0 ? 'a rise' : 'a decline'}. Make sure that's the story you mean to tell.`, { type: 'set', key: 'range', value: null, label: 'Show full history' });
      else add('info', 'Custom time range', 'Showing part of the record. The trend direction matches the full history.');
    }

    // Headline language vs. actual size of change
    const title = o.title || '';
    if (HYPE.test(title)) {
      const m = title.match(HYPE)[0];
      let modest = false;
      if (ds.kind === 'timeseries') { const { first, last } = r.stats; modest = Math.abs(last.v - first.v) / Math.abs(first.v || 1) < 0.1; }
      add(modest ? 'warn' : 'info', `"${m}" in the headline`, modest ? 'The data shows a change of under 10%. Strong verbs can make viewers distrust the whole chart.' : 'Make sure the visual supports the word. Viewers notice when it doesn\'t.');
    }

    (ds.caveats || []).forEach(c => add('info', 'Context', c));
    if (o.paletteCheck?.issues.length) {
      const iss = o.paletteCheck.issues, fail = iss.some(i => i.level === 'fail');
      add(fail ? 'warn' : 'info', 'Color accessibility', iss.length === 1 ? iss[0].msg : `${iss.length} color pairs are hard to tell apart${fail ? ', some for everyone' : ' for color-blind viewers'}. Direct labels carry identity here; the "Color-blind safe" palette avoids it.`);
    }

    // Voiceover script, short enough to read in the chosen duration.
    const src = ds.source.publisher;
    const script = [
      (o.title || ds.title).replace(/[.:]$/, '') + '.',
      r.headline,
      ...r.facts.filter(f => ['peak', 'mover', 'strong', 'yoy', 'faller'].includes(f.k)).slice(0, 1).map(f => f.text.replace(/^Peak: /, 'It peaked at ').replace(/^Biggest rise since/, 'The biggest rise since')),
      ds.howToRead?.[0] || '',
      `Source: ${src}.`,
    ].filter(Boolean).join(' ');

    return { ...r, checks, script, view };
  };
})(window.PS);
