// Civic Charts claim check: keeps the tool from being an easy way to misstate data.
//
// Everything the creator types (title, subtitle, kicker, takeaway, voiceover script,
// note) is checked against the data on screen. Clear contradictions BLOCK export:
//   - a number that appears nowhere in the data or its computed facts
//   - a "now / currently / hits" number that doesn't match the latest value
//   - a direction ("rises", "falls", "since 2010 ... doubled") the data contradicts
//   - a "record" that isn't one
// Softer problems (cause-and-effect wording) are warnings.
// Someone determined to mislead can still edit a file elsewhere; this removes the
// low-hanging fruit inside the tool, and the share link always rebuilds from source.
(function (PS) {
  const UP = /\b(ris(e|es|ing|en)|rose|increas\w*|grow(s|ing|n)?|grew|climb\w*|jump\w*|soar\w*|surg\w*|spik\w*|skyrocket\w*|balloon\w*|up|higher|gain\w*|boom\w*|rebound\w*)\b/i;
  const DOWN = /\b(fall(s|ing|en)?|fell|drop\w*|declin\w*|decreas\w*|shrink\w*|shrank|plung\w*|plummet\w*|crash\w*|collaps\w*|tumbl\w*|sink\w*|sank|down|lower|cut|slump\w*|dip(s|ped)?)\b/i;
  const NEG = /\b(not|no longer|never|isn't|aren't|wasn't|didn't|doesn't|don't|hasn't|haven't|without)\b/i;
  const RECORD = /\b(record|all[- ]time|highest ever|lowest ever|never been (higher|lower)|unprecedented|historic (high|low))\b/i;
  const RECORD_LOW = /\b(record low|all[- ]time low|lowest ever|never been lower|historic low)\b/i;
  const CURRENT = /\b(now|currently|today|latest|this (year|month|week)|stands? at|is at|hits?|reach(es|ed)?|tops?)\b/i;
  const CAUSAL = /\b(because( of)?|caused?|causing|due to|thanks to|leads? to|led to|results? (of|in)|resulted in|driven by|blame[sd]?|fault of|responsible for)\b/i;
  const MULT = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, mn: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };

  // Numbers in free text, with their scale. Skips years, ordinals and "per 100,000".
  function numbersIn(text) {
    const out = [], re = /(\$)?(-?\d[\d,]*(?:\.\d+)?)\s*(%|percentage points|percent|points|pts|thousand|million|billion|trillion|mn|bn|tn|k|m|b|t|°c|°f)?(?![\w.-]*\d)/gi;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[2].replace(/,/g, ''), v = parseFloat(raw), unit = (m[3] || '').toLowerCase();
      if (!Number.isFinite(v)) continue;
      const before = text.slice(Math.max(0, m.index - 6), m.index).toLowerCase(), after = text.slice(m.index + m[0].length, m.index + m[0].length + 3).toLowerCase();
      if (/per\s*$/.test(before) || /^(st|nd|rd|th)\b/.test(after) || /^-?(year|month|day|week)/.test(after)) continue;
      if (!m[1] && !unit && /^(1[89]|20|21)\d{2}$/.test(raw)) continue; // a year
      if (/[a-z]-$/.test(before)) continue; // "U-3", "COVID-19"
      const dec = raw.includes('.') ? raw.split('.')[1].length : 0;
      out.push({ v: v * (MULT[unit] || 1), unit, dollar: !!m[1], dec, mult: MULT[unit] || 1, text: m[0].trim(), index: m.index });
    }
    return out;
  }
  const scaled = (v, unit) => (unit?.format === 'usdT' ? v * 1e12 : v);

  // Every number the creator may legitimately use: data values, computed facts, and the
  // source's own wording (titles, labels, caveats).
  function allowedNumbers(ds, a, o, full) {
    const vals = [];
    const push = (v, unit) => { if (v != null && Number.isFinite(v)) { vals.push(v); const s = scaled(v, unit); if (s !== v) vals.push(s); } };
    const u = ds.unit || {};
    if (ds.kind === 'timeseries') ds.series.forEach(s => (s.raw || s.pts).forEach(p => push(p.v, s.unit || u)));
    if (ds.kind === 'timeseries' && ds.series.some(s => s.raw)) ds.series.forEach(s => s.pts.forEach(p => push(p.v, { format: 'number' })));
    if (ds.kind === 'panel') { ds.entities.forEach(e => e.values.forEach(v => push(v, u))); ds.national?.values.forEach(v => push(v, u)); vals.push(ds.entities.length); }
    if (ds.kind === 'events') { ds.events.forEach(e => push(e.value, u)); vals.push(ds.events.length); }
    if (ds.kind === 'scatter') ds.points.forEach(p => { p.xs.forEach(v => push(v, ds.x.unit)); p.ys.forEach(v => push(v, ds.y.unit)); });
    if (full?.kind === 'timeseries') full.series.forEach(s => s.pts.forEach(p => push(p.v, full.unit)));
    // Facts Civic Charts computed, and the source's own wording, are fair game.
    const texts = [ds.title, ds.description, ds.unit?.label, ds.lens, ds.source?.dataset, ...(ds.howToRead || []), ...(ds.caveats || []),
      a.headline, a.howTo, ...(a.facts || []).map(f => f.text), ...(a.checks || []).map(c => c.detail), o._autoSubtitle, o._autoTitle];
    texts.filter(Boolean).forEach(t => numbersIn(t).forEach(n => vals.push(n.v)));
    for (let i = 1; i <= Math.min(500, ds.entities?.length || 0); i++) vals.push(i); // ranks
    return vals;
  }
  function matches(n, vals) {
    const step = 0.5 * Math.pow(10, -n.dec) * n.mult;
    return vals.some(a => { const tol = Math.max(step, Math.abs(a) * 0.02, 1e-9); return Math.abs(Math.abs(n.v) - Math.abs(a)) <= tol; });
  }

  // The main measure as one series (focused place, national line, or main series).
  function mainSeries(ds, o) {
    if (ds.kind === 'timeseries' && !ds.combo) { const id = (o.series?.length ? o.series : ds.defaultSeries || [ds.series[0].id])[0]; const s = ds.series.find(x => x.id === id) || ds.series[0]; return { name: ds.title, pts: s.pts, current: true }; }
    if (ds.kind === 'panel' && !ds.singleTime) {
      const e = o.focus && ds.entities.find(x => x.id === o.focus);
      if (e) return { name: e.name, pts: ds._tms.map((t, i) => ({ t, v: e.values[i] })).filter(p => p.v != null), current: true };
      if (ds.national) return { name: 'the U.S.', pts: ds._tms.map((t, i) => ({ t, v: ds.national.values[i] })).filter(p => p.v != null) };
    }
    return null;
  }
  // A place named in the sentence ("California unemployment hits 9%") is what the claim is about.
  function placeSeries(ds, sentence) {
    if (ds.kind !== 'panel' || ds.singleTime) return null;
    const low = sentence.toLowerCase();
    const hit = ds.entities.map(e => ({ e, n: [e.name, e.short].filter(Boolean).map(x => x.toLowerCase()).find(x => x.length > 3 && new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low)) }))
      .filter(x => x.n).sort((a, b) => b.n.length - a.n.length)[0];
    return hit ? { name: hit.e.name, pts: ds._tms.map((t, i) => ({ t, v: hit.e.values[i] })).filter(p => p.v != null), current: true } : null;
  }
  const inWindow = (pts, o) => pts.filter(p => p.t >= (o.rangeStart ?? -Infinity) && p.t <= (o.rangeEnd ?? Infinity));

  PS.checkClaims = function (ds, analysis, o, fullDs) {
    const blocks = [], warns = [];
    const fields = [
      ['title', 'Title', o.titleEdited ? o.title : ''], ['subtitle', 'Subtitle', o.subtitle !== o._autoSubtitle ? o.subtitle : ''],
      ['kicker', 'Kicker', o.kicker], ['takeawayText', 'Takeaway', o.takeawayText], ['script', 'Voiceover script', o.scriptEdited ? o.script : ''], ['note', 'Note', o.note],
    ].filter(f => f[2] && String(f[2]).trim());
    if (!fields.length) return { blocks, warns };
    const unit = ds.unit || {};
    const allowed = allowedNumbers(ds, analysis, o, fullDs);
    const mainAll = mainSeries(ds, o), full = fullDs && mainSeries(fullDs, o);
    const fmt = v => PS.fmt(v, unit);
    const sinceChange = (txt, pts) => { const m = /\bsince (\d{4})\b/i.exec(txt); if (!m || !pts.length) return null; const y = +m[1]; const from = pts.find(p => new Date(p.t).getUTCFullYear() >= y); return from ? { from, to: pts.at(-1), year: y } : null; };

    for (const [key, label, text] of fields) {
      const fix = key === 'takeawayText' ? { act: 'clearTakeaway', label: 'Use the computed takeaway' } : key === 'title' ? { act: 'resetTitle', label: 'Use the suggested title' }
        : key === 'script' ? { act: 'regenScript', label: 'Use the computed script' } : key === 'subtitle' ? { act: 'resetSubtitle', label: 'Use the suggested subtitle' } : { act: 'clearField', field: key, label: `Clear the ${label.toLowerCase()}` };
      for (const sentence of String(text).split(/(?<=[.!?])\s+/)) {
        // "Deficit" talks about the size of a negative balance: a bigger deficit is a lower value.
        const flip = ds.unit?.signWords && new RegExp(ds.unit.signWords.neg, 'i').test(sentence) && !new RegExp(ds.unit.signWords.pos, 'i').test(sentence);
        const neg = sr => sr && { ...sr, pts: sr.pts.map(p => ({ ...p, v: -p.v })) };
        const main = (flip ? neg : x => x)(placeSeries(ds, sentence) || mainAll), win = main ? inWindow(main.pts, o) : [];
        const fullS = flip ? neg(full) : full;
        // 1. numbers that appear nowhere in the data or its facts
        for (const n of numbersIn(sentence)) {
          if (!matches(n, allowed)) blocks.push({ field: key, title: `${label}: "${n.text}" isn't in the data`, detail: `No value or computed figure in this dataset matches ${n.text}. Use a number from the data or the facts panel.`, fix });
          else if (main && main.current && win.length && CURRENT.test(sentence) && n.unit !== 'k' && !/\b(since|from|peak|peaked|record)\b|\bin (?:\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)\b/i.test(sentence)) {
            // "Now" may lag one release, so the latest two observations both count.
            const last = win.at(-1), prev = win.at(-2) || last;
            const sameKind = unit.format === 'pct' ? ['%', 'percent', ''].includes(n.unit) : true;
            if (sameKind && !matches(n, [last.v, scaled(last.v, unit), prev.v, scaled(prev.v, unit)])) blocks.push({ field: key, title: `${label}: the latest value isn't ${n.text}`, detail: `"${sentence.trim()}" reads as a current figure, but the latest value is ${fmt(last.v)} (${PS.fmtDate(last.t, ['annual', 'fiscal'].includes(ds.frequency) ? ds.frequency : 'monthly')}).`, fix });
          }
        }
        if (!main || win.length < 2) continue;
        // 2. direction vs. what the data did (over the shown range, or "since YYYY")
        const up = UP.test(sentence), down = DOWN.test(sentence);
        if (up !== down && !NEG.test(sentence)) {
          const sc = sinceChange(sentence, main.pts);
          const a = sc ? sc.from : win[0], b = sc ? sc.to : win.at(-1);
          const ch = b.v - a.v, rel = Math.abs(ch) / Math.max(Math.abs(a.v), 1e-9);
          const meaningful = unit.format === 'pct' ? Math.abs(ch) >= 0.15 : rel >= 0.01;
          if (meaningful && ((up && ch < 0) || (down && ch > 0)))
            blocks.push({ field: key, title: `${label} says ${up ? 'up' : 'down'}, the data went ${ch > 0 ? 'up' : 'down'}`, detail: `${main.name === ds.title ? 'It' : main.name} went from ${fmt(a.v)} to ${fmt(b.v)} ${sc ? `since ${sc.year}` : `over the period shown`}.`, fix });
        }
        // 3. "doubled / tripled / halved"
        const mult = /\b(doubl|tripl|quadrupl|halv)\w*/i.exec(sentence);
        if (mult) {
          const sc = sinceChange(sentence, main.pts); const a = sc ? sc.from : win[0], b = sc ? sc.to : win.at(-1);
          const r = b.v / a.v, need = { doubl: [1.8, Infinity], tripl: [2.7, Infinity], quadrupl: [3.6, Infinity], halv: [-Infinity, 0.56] }[mult[1].toLowerCase()];
          // A multiple of zero or a negative start (a surplus, for deficits) is meaningless.
          if (a.v <= 0) blocks.push({ field: key, title: `${label}: "${mult[0]}" doesn't fit the data`, detail: `The starting value, ${flip ? (a.v < 0 ? `a ${ds.unit.signWords.pos} of ${fmt(-a.v)}` : 'zero') : fmt(a.v)}${sc ? ` in ${sc.year}` : ''}, can't be ${mult[0].toLowerCase()}.`, fix });
          else if (!(r >= need[0] && r <= need[1])) blocks.push({ field: key, title: `${label}: "${mult[0]}" doesn't fit the data`, detail: `${fmt(a.v)} to ${fmt(b.v)} is ${r >= 1 ? `${r.toFixed(2)} times` : `${Math.round(r * 100)}% of`} the starting value.`, fix });
        }
        // 4. records, judged on the full history, not a cropped window
        if (RECORD.test(sentence) && fullS?.pts.length > 2) {
          const pts = fullS.pts, last = pts.at(-1), hi = pts.reduce((m, p) => (p.v > m.v ? p : m)), lo = pts.reduce((m, p) => (p.v < m.v ? p : m));
          const wantLow = RECORD_LOW.test(sentence) || (DOWN.test(sentence) && !UP.test(sentence));
          const ok = wantLow ? last.v <= lo.v : last.v >= hi.v;
          if (!ok) { const rec = wantLow ? lo : hi; blocks.push({ field: key, title: `${label}: not a record`, detail: `The record ${wantLow ? 'low' : 'high'} is ${fmt(rec.v)} in ${PS.fmtDate(rec.t, 'annual')}; the latest is ${fmt(last.v)}.`, fix }); }
        }
      }
      // 5. cause and effect (warning only)
      if (CAUSAL.test(text)) warns.push({ field: key, title: `${label} claims a cause`, detail: `This data shows what happened, not why. "${CAUSAL.exec(text)[0]}" needs evidence from outside the chart; consider rewording or citing that evidence.` });
    }
    // De-duplicate identical messages
    const uniq = list => list.filter((x, i) => list.findIndex(y => y.title === x.title && y.field === x.field) === i);
    return { blocks: uniq(blocks), warns: uniq(warns) };
  };
  PS._numbersIn = numbersIn;
})(window.PS);
