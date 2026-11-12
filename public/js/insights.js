// Civic Charts explanation engine.
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

  // Budget balances: below zero is a deficit. Say "a $1.99T deficit", never "-$1.99T",
  // and treat a bigger deficit as bigger, not as a fall.
  function balanceFacts(ds, view) {
    const pts = view.series[0].pts, u = ds.unit, sw = u.signWords, f = ds.frequency;
    const last = pts.at(-1), first = pts[0], d = t => PS.fmtDate(t, f, true);
    const amt = x => PS.fmt(Math.abs(x), u) + (sw.of || '');
    const bal = x => (x < 0 ? `a ${sw.neg} of ${amt(x)}` : x > 0 ? `a ${sw.pos} of ${amt(x)}` : 'a balanced budget');
    const when = sw.trailing ? `over the 12 months through ${d(last.t)}` : `${f === 'fiscal' ? 'in' : 'in'} ${d(last.t)}`;
    const yearAgo = pts.reduce((b, p) => (Math.abs(p.t - (last.t - 365 * DAY)) < Math.abs(b.t - (last.t - 365 * DAY)) ? p : b), first);
    let cmp = '';
    if (yearAgo !== last && yearAgo.v < 0 && last.v < 0) cmp = `, ${-last.v > -yearAgo.v ? 'up' : 'down'} from ${amt(yearAgo.v)} a year earlier`;
    else if (yearAgo !== last && Math.sign(yearAgo.v) !== Math.sign(last.v)) cmp = `, after ${bal(yearAgo.v).replace(/^a /, 'a ')} a year earlier`;
    const headline = `${sw.subject} ran ${bal(last.v)} ${when}${cmp}.`;
    const at = t => (sw.trailing ? `the 12 months through ${d(t)}` : d(t));
    const facts = [{ k: 'latest', text: `Latest: ${bal(last.v).replace(/^a /, '')} (${at(last.t)}).` }];
    const worst = pts.reduce((m, p) => (p.v < m.v ? p : m)), best = pts.reduce((m, p) => (p.v > m.v ? p : m));
    if (worst.v < 0 && worst !== last) facts.push({ k: 'trough', text: `Largest ${sw.neg}: ${amt(worst.v)} in ${at(worst.t)}.` });
    const lastSurplus = [...pts].reverse().find(p => p.v > 0);
    if (lastSurplus && last.v < 0) facts.push({ k: 'peak', text: `Last ${sw.pos}: ${amt(lastSurplus.v)} in ${at(lastSurplus.t)}.` });
    else if (best.v > 0 && best !== last) facts.push({ k: 'peak', text: `Largest ${sw.pos}: ${amt(best.v)} in ${at(best.t)}.` });
    const unit = f === 'fiscal' || f === 'annual' ? 'years' : f === 'quarterly' ? 'quarters' : 'months';
    const nDef = pts.filter(p => p.v < 0).length;
    if (!sw.trailing) facts.push({ k: 'count', text: `${sw.neg[0].toUpperCase() + sw.neg.slice(1)}s in ${nDef} of ${pts.length} ${unit} since ${yr(first.t)}.` });
    if (last.v < 0 && pts.length > 24) {
      const bigger = pts.filter(p => p.v < last.v).length;
      facts.push({ k: 'pctile', text: bigger ? `Only ${bigger} of ${pts.length} ${unit} since ${yr(first.t)} had a larger ${sw.neg}.` : `The largest ${sw.neg} since ${yr(first.t)}.` });
    }
    const avg = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    if (u.format === 'pct') facts.push({ k: 'avg', text: `Average since ${yr(first.t)}: ${bal(avg).replace(/^a /, '')}.` });
    return { headline, facts, trend: Math.sign(last.v - first.v), stats: { first, last, peak: best, trough: worst, avg } };
  }
  // Two lines whose gap is the story (spending vs. revenue): describe both and the gap.
  function gapFacts(ds, view) {
    const g = ds.gap, A = view.series.find(s => s.id === g.a), B = view.series.find(s => s.id === g.b), u = ds.unit, f = ds.frequency, d = t => PS.fmtDate(t, f, true), v = x => PS.fmt(x, u);
    const bMap = new Map(B.pts.map(p => [p.t, p.v])), both = A.pts.filter(p => bMap.has(p.t)).map(p => ({ t: p.t, a: p.v, b: bMap.get(p.t) }));
    const last = both.at(-1), gap = last.a - last.b;
    // Gaps between two rates are percentage points, not percent ("1.0 percentage points").
    const gv = x => (u.format === 'pct' && g.points ? `${PS.fmt(x, { format: 'number', decimals: u.decimals ?? 1 })} percentage point${Math.abs(x).toFixed(u.decimals ?? 1) === (1).toFixed(u.decimals ?? 1) ? '' : 's'}` : v(x) + (g.of || ''));
    const gapText = gap > 0 ? (g.posPhrase ? g.posPhrase.replace('{v}', gv(gap)) : `a ${g.posWord} of ${gv(gap)}`) : gap < 0 ? (g.negPhrase ? g.negPhrase.replace('{v}', gv(-gap)) : `a ${g.negWord} of ${gv(-gap)}`) : 'balanced';
    const headline = `In ${d(last.t)}, ${g.aName} was ${v(last.a)}${g.of || ''} and ${g.bName} ${v(last.b)}: ${gapText}.`;
    const facts = [];
    const avgA = both.reduce((s, p) => s + p.a, 0) / both.length, avgB = both.reduce((s, p) => s + p.b, 0) / both.length;
    facts.push({ k: 'avg', text: `Averages since ${yr(both[0].t)}: ${g.aName} ${v(avgA)}, ${g.bName} ${v(avgB)}.` });
    const pkA = both.reduce((m, p) => (p.a > m.a ? p : m)); facts.push({ k: 'peak', text: `Highest ${g.aName}: ${v(pkA.a)} in ${d(pkA.t)}.` });
    const pkB = both.reduce((m, p) => (p.b > m.b ? p : m)); facts.push({ k: 'peak2', text: `Highest ${g.bName}: ${v(pkB.b)} in ${d(pkB.t)}.` });
    const lastNeg = [...both].reverse().find(p => p.a < p.b), cap = x => x[0].toUpperCase() + x.slice(1);
    // If the latest point is itself one where b leads, describe the current streak instead of "last exceeded ... [this month]".
    let streak = null;
    if (lastNeg === last) { let i = both.length - 1; while (i > 0 && both[i - 1].a < both[i - 1].b) i--; streak = both[i]; }
    if (streak) facts.push({ k: 'count', text: streak === both[0] ? `${cap(g.bName)} exceeded ${g.aName} in every period shown.` : `${cap(g.bName)} has exceeded ${g.aName} since ${d(streak.t)}.` });
    else facts.push({ k: 'count', text: lastNeg ? `${g.bName[0].toUpperCase() + g.bName.slice(1)} last exceeded ${g.aName} in ${d(lastNeg.t)}.` : `${g.aName[0].toUpperCase() + g.aName.slice(1)} exceeded ${g.bName} in every year shown.` });
    return { headline, facts, trend: Math.sign(gap), stats: { first: { t: both[0].t, v: both[0].a }, last: { t: last.t, v: last.a }, peak: { t: pkA.t, v: pkA.a }, trough: { t: last.t, v: last.a }, avg: avgA } };
  }

  function tsFacts(ds, view) {
    if (ds.unit.signWords && !ds.combo) return balanceFacts(ds, view);
    if (ds.gap && !ds.combo && view.series.some(s => s.id === ds.gap.a) && view.series.some(s => s.id === ds.gap.b)) return gapFacts(ds, view);
    const s = view.series[0], pts = s.pts, u = ds.unit, f = ds.frequency;
    const first = pts[0], last = pts[pts.length - 1];
    let peak = first, trough = first, sum = 0;
    for (const p of pts) { if (p.v > peak.v) peak = p; if (p.v < trough.v) trough = p; sum += p.v; }
    const avg = sum / pts.length;
    const below = pts.filter(p => p.v < last.v).length / pts.length;
    const yearAgo = pts.reduce((best, p) => (Math.abs(p.t - (last.t - 365 * DAY)) < Math.abs(best.t - (last.t - 365 * DAY)) ? p : best), first);
    const d = t => PS.fmtDate(t, f, true), v = x => PS.fmt(x, u);
    const at = ['weekly', 'daily', 'real-time'].includes(f) ? 'on' : 'in'; // "on November 2, 2026", "in October 2026"
    // Multi-item datasets (grocery prices, inflation by category) name the item: "The average price of a dozen eggs".
    const noun = ds.seriesTitle && ds.series?.find(x => x.id === s.id)?.noun;
    const name = noun ? ds.seriesTitle.replace('{s}', noun) : short(ds), startY = yr(first.t);
    const facts = [];
    let headline;
    if (last.t === peak.t && pts.length > 10) headline = `${name} hit ${v(last.v)} ${at} ${d(last.t)}, the highest on record since ${startY}.`;
    else if (last.t === trough.t && pts.length > 10) headline = `${name} fell to ${v(last.v)} ${at} ${d(last.t)}, the lowest since ${startY}.`;
    else if (u.format === 'usdT' || ds.unit.format === 'usd' && first.v > 0 && last.v / first.v > 1.5)
      headline = `${name} reached ${v(last.v)} ${at} ${d(last.t)}, ${PS.fmtChange(first.v, last.v, u).replace(/^\+/, 'up ')} since ${startY}.`;
    else headline = `${name} was ${v(last.v)} ${at} ${d(last.t)}, ${last.v > avg ? 'above' : 'below'} its ${startY}–${yr(last.t)} average of ${v(avg)}.`;
    facts.push({ k: 'latest', text: `Latest: ${v(last.v)} (${d(last.t)}).` });
    facts.push({ k: 'change', text: `Since ${d(first.t)}: ${PS.fmtChange(first.v, last.v, u)}.` });
    if (peak.t !== last.t) facts.push({ k: 'peak', text: `Peak: ${v(peak.v)} ${at} ${d(peak.t)}.` });
    if (trough.t !== last.t) facts.push({ k: 'trough', text: `Low: ${v(trough.v)} ${at} ${d(trough.t)}.` });
    if (last.t - first.t > 2 * 365 * DAY && yearAgo !== last) facts.push({ k: 'yoy', text: `One year earlier it was ${v(yearAgo.v)} (${PS.fmtChange(yearAgo.v, last.v, u).replace(' (', ', ').replace(/\)$/, '')}).` });
    if (pts.length > 24) facts.push({ k: 'pctile', text: `The latest reading is higher than ${Math.round(below * 100)}% of all ${f === 'weekly' ? 'weeks' : f === 'quarterly' ? 'quarters' : f === 'annual' || f === 'fiscal' ? 'years' : 'months'} since ${startY}.` });
    if (view.series[1]) {
      const s2 = view.series[1], l2 = s2.pts.at(-1);
      facts.push({ k: 'compare', text: `${s2.name}: ${v(l2.v)} in ${d(l2.t)}.` });
    }
    return { headline, facts, trend: Math.sign(last.v - first.v), stats: { first, last, peak, trough, avg } };
  }

  // Places too small to rank fairly (rates swing on a handful of people) stay on the
  // map but are left out of rankings.
  PS.rankable = o => e => !(o.minPop > 0 && e.pop != null && e.pop < o.minPop);
  const vals0 = now => { const a = now.map(x => x.v).sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  function panelFacts(ds, view, o) {
    const u = ds.unit, f = ds.frequency, idx = view.idx;
    const li = idx[idx.length - 1], fi = idx[0];
    const at = i => ds.entities.filter(PS.rankable(o)).filter(e => e.values[i] != null).map(e => ({ e, v: e.values[i] })).sort((a, b) => b.v - a.v);
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
    else headline = `${ds.scopeName ? `In ${ds.scopeName}, ` : ''}${top.e.name} ranks highest (${v(top.v)}) and ${bot.e.name} lowest (${v(bot.v)}) for ${lbl}, as of ${d(li)}.`;
    // Elections: say how many places each side led AND how many votes those places hold,
    // because a shaded map gives empty land the same weight as cities.
    if (ds.election) {
      const ents = ds.entities.filter(e => e.values[li] != null);
      const dLed = ents.filter(e => e.values[li] > 0), rLed = ents.filter(e => e.values[li] < 0);
      const votes = list => list.reduce((a, e) => a + (e.votes?.[li] || 0), 0), all = votes(ents) || 1;
      const unitWord = ds.geo === 'us-counties' ? 'counties' : 'states', yr = new Date(ds._tms[li]).getUTCFullYear();
      const where = ds.scopeName ? ` in ${ds.scopeName}` : '';
      const nat = ds.national?.values[li];
      headline = `In ${yr}${where}, the Republican candidate led in ${rLed.length.toLocaleString()} ${unitWord} holding ${Math.round(votes(rLed) / all * 100)}% of the votes cast; the Democratic candidate led in ${dLed.length.toLocaleString()} holding ${Math.round(votes(dLed) / all * 100)}%.`;
      const fe = o.focus && ds.entities.find(e => e.id === o.focus);
      if (fe && fe.values[li] != null) headline = `${fe.name} voted ${v(fe.values[li])} for president in ${yr}${nat != null ? `; the national popular vote was ${v(nat)}` : ''}.`;
      const facts2 = [];
      if (nat != null && !ds.scopeName) facts2.push({ k: 'nat', text: `National popular vote: ${v(nat)}.` });
      if (fi !== li) {
        const pi = idx[idx.length - 2];
        const sh = ents.filter(e => e.values[pi] != null).map(e => ({ e, d: e.values[li] - e.values[pi] })).sort((a, b) => a.d - b.d);
        if (sh.length) {
          const toR = sh[0], toD = sh[sh.length - 1], prevYr = new Date(ds._tms[pi]).getUTCFullYear();
          const moved = sh.filter(x => x.d < 0).length;
          facts2.push({ k: 'shift', text: `Since ${prevYr}, ${moved.toLocaleString()} of ${sh.length.toLocaleString()} ${unitWord} shifted toward the Republican candidate and ${(sh.length - moved).toLocaleString()} toward the Democratic candidate.` });
          if (toR.d < 0) facts2.push({ k: 'shiftR', text: `Biggest shift toward Republicans: ${toR.e.name}, ${Math.abs(toR.d).toFixed(1)} points.` });
          if (toD.d > 0) facts2.push({ k: 'shiftD', text: `Biggest shift toward Democrats: ${toD.e.name}, ${toD.d.toFixed(1)} points.` });
        }
      }
      return { headline, facts: [...facts2, { k: 'top', text: `Largest Democratic margins: ${now.slice(0, 3).map(x => `${x.e.name} (${v(x.v)})`).join(', ')}.` }, { k: 'bottom', text: `Largest Republican margins: ${now.slice(-3).reverse().map(x => `${x.e.name} (${v(x.v)})`).join(', ')}.` }], trend: 0 };
    }
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
    const unitName = ds.geo === 'world' ? 'country' : ds.geo === 'us-states' ? 'state' : ds.geo === 'us-counties' ? 'county' : 'entry';
    facts.push({ k: 'median', text: `The typical (median) ${unitName}${ds.scopeName ? ` in ${ds.scopeName}` : ''}: ${v(med)} across ${now.length.toLocaleString()} ${unitName === 'county' ? 'counties' : unitName === 'country' ? 'countries' : unitName + 's'}.` });
    let trend = 0;
    if (fi !== li) {
      const ch = ds.entities.filter(PS.rankable(o)).map(e => ({ e, a: e.values[fi], b: e.values[li] })).filter(x => x.a != null && x.b != null && x.a !== 0)
        .map(x => ({ ...x, d: u.format === 'pct' || ds.isRate ? x.b - x.a : (x.b - x.a) / Math.abs(x.a) }));
      if (ch.length) {
        ch.sort((a, b) => b.d - a.d);
        const up = ch[0], dn = ch[ch.length - 1];
        // When nothing rose, "biggest rise" would name a decline; say what actually happened.
        if (up.d > 0) facts.push({ k: 'mover', text: `Biggest rise since ${PS.fmtDate(ds._tms[fi], f)}: ${up.e.name}, ${PS.fmtChange(up.a, up.b, u, { noRel: ds.zeroLine })}.` });
        else facts.push({ k: 'mover', text: `None rose since ${PS.fmtDate(ds._tms[fi], f)}. Smallest ${up.d === 0 ? 'change' : 'drop'}: ${up.e.name}, ${PS.fmtChange(up.a, up.b, u, { noRel: ds.zeroLine })}.` });
        if (dn.d < 0) facts.push({ k: 'faller', text: `Biggest drop: ${dn.e.name}, ${PS.fmtChange(dn.a, dn.b, u, { noRel: ds.zeroLine })}.` });
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
    if (ds.combo) return PS.analyzeCombo(ds, o);
    const view = PS.windowed(ds, o);
    const r = ds.kind === 'timeseries' ? tsFacts(ds, view) : ds.kind === 'panel' ? panelFacts(ds, view, o) : eventFacts(ds, view);
    const checks = [];
    const add = (level, title, detail, action) => checks.push({ level, title, detail, action });

    if (ds.source.unverified) add('warn', 'Unverified source', 'This data was uploaded, so Civic Charts cannot confirm where it came from. Name the original publisher in the note before sharing.');
    else add('pass', 'Source cited on every frame',`${ds.source.publisher}${ds.source.via ? ', via ' + ds.source.via : ''}. Retrieved ${PS.fmtRetrieved(ds.retrieved)}. Citations can be restyled but not removed.`);

    if (ds.aggWarning) add('warn', `Rows were ${ds.aggWarning.agg === 'sum' ? 'added together' : 'averaged'}`, `${ds.aggWarning.rows.toLocaleString()} rows shared a date or place and were combined. If the file mixes totals with their parts (a state total plus its counties), the result double counts. Check the "Only rows where" filter.`);
    if (o.minPop > 0 && ds.kind === 'panel') {
      const skipped = ds.entities.filter(e => e.pop != null && e.pop < o.minPop).length;
      if (skipped) add('info', `Rankings skip ${skipped.toLocaleString()} small ${ds.geo === 'us-counties' ? 'counties' : 'places'}`, `Places with fewer than ${o.minPop.toLocaleString()} residents still appear on the map, but are left out of "highest" and "lowest", where a few people can swing a rate wildly.`, { type: 'set', key: 'minPop', value: 0, label: 'Rank every place' });
    } else if (ds.geo === 'us-counties' && ds.isRate && !ds.election && !o.minPop) {
      add('warn', 'Tiny counties can top the rankings', 'Rates in counties with a few hundred people swing on a handful of residents.', { type: 'set', key: 'minPop', value: 5000, label: 'Skip counties under 5,000' });
    }
    if (ds.election) {
      if (o.chart === 'choropleth') add('warn', 'Land area is not voters', 'Big, sparsely populated places dominate a shaded map. The takeaway reports each side\'s share of votes cast, not just places won.');
      add('info', 'Official results, compiled', `${ds.source.publisher} compiles certified results from state election offices. Each state's certified canvass is the final authority.`);
    }
    // Source tier
    const TP = (PS.REGISTRY?.thirdParty || []).find(x => x.id === ds.sourceId);
    if (ds.tier === 'industry') add('warn', 'Company data', `${TP?.disclosure || 'This comes from a company with a business interest in the topic.'} The citation labels it as company data.`);
    else if (ds.tier === 'academic' || ds.tier === 'nonprofit') add('info', ds.tier === 'academic' ? 'Academic source' : 'Nonprofit research source', `${TP?.org ? TP.org + '. ' : ''}${TP?.why || ''} ${TP?.disclosure || ''}`.trim());
    else if (ds.tier === 'local') add('pass', 'Official local government source', `Published by ${ds.source.publisher} on ${ds.source.portal || 'its open-data portal'}. Local data often covers only one city or county; check the boundaries before comparing places.`);
    else if (ds.tier === 'state') add('pass', 'Official state source', `Published by ${ds.source.publisher} on ${ds.source.portal || 'its open-data portal'}.`);

    // Freshness
    if (ds.lastObservation) {
      const age = (Date.now() - +PS.parseDate(ds.lastObservation)) / DAY;
      // releaseLagDays: sources that publish well after the period ends (EIA-861M runs ~2.5 months behind).
      const allowed = ({ 'real-time': 2, daily: 7, weekly: 21, monthly: 75, quarterly: 200, annual: 730, fiscal: 730, quadrennial: 4 * 365 + 120 }[ds.frequency] || 400) + (ds.releaseLagDays || 0);
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
