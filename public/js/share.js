// Civic Charts post kit and sharing: per-platform captions, alt text, SRT captions,
// PNG provenance metadata, the LinkedIn carousel PDF, share links that rebuild a
// chart from official data, and sharing to installed apps.
(function (PS) {
  const TOPIC_TAGS = {
    economy: ['Economy', 'Jobs'], prices: ['Inflation', 'CostOfLiving'], housing: ['Housing', 'RealEstate'], health: ['PublicHealth'],
    education: ['Education'], safety: ['PublicSafety'], environment: ['Climate', 'Environment'], energy: ['Energy'], transportation: ['Transportation'],
    government: ['PublicPolicy', 'Budget'], people: ['Census', 'Demographics'], world: ['GlobalData'], elections: ['Elections', 'Vote'],
  };
  const tags = ds => ['DataViz', 'OpenData', ...(TOPIC_TAGS[ds.topic] || [])].map(t => '#' + t);
  const sourceText = ds => `${ds.source.publisher}${ds.source.dataset ? ', ' + ds.source.dataset : ''}`;
  const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

  // ---------- share links: settings only, rebuilt from official data on open ----------
  const LINK_KEYS = ['chart', 'platform', 'format', 'duration', 'theme', 'palette', 'customColors', 'ramp', 'headFont', 'bodyFont', 'accent', 'bg', 'bgGradient', 'radius',
    'lineWidth', 'grid', 'textScale', 'annotate', 'zeroBase', 'series', 'entities', 'topN', 'highlight', 'sortAsc', 'rangeStart', 'rangeEnd', 'handle', 'brand', 'motion',
    'takeaway', 'takeawayText', 'captions', 'kicker', 'title', 'subtitle', 'note', 'colorZero', 'minPop', 'compare', 'combineMethod', 'titleEdited'];
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  // Only settings that differ from the defaults and from what the dataset suggests travel in the link.
  PS.shareLink = (dsId, o, state, defaults = PS.DEFAULT_OPTIONS || {}, auto = {}) => {
    if (String(dsId).startsWith('custom-')) return null; // uploaded data can't be rebuilt from a link
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const keep = k => o[k] !== undefined && !same(o[k], defaults[k]) && !(k in auto && same(o[k], auto[k])) && !(Array.isArray(o[k]) && !o[k].length) && o[k] !== '';
    const cfg = { d: dsId, ...(state ? { s: state } : {}), o: Object.fromEntries(LINK_KEYS.filter(keep).map(k => [k, o[k]])) };
    return `${location.origin}${location.pathname}#c=${b64(JSON.stringify(cfg))}`;
  };
  PS.readShareLink = () => { const m = /#c=([\w-]+)/.exec(location.hash); if (!m) return null; try { return JSON.parse(unb64(m[1])); } catch { return null; } };

  // ---------- captions, alt text, SRT ----------
  PS.altText = (ds, a, o) => {
    const kind = { line: 'Line chart', area: 'Area chart', bignumber: 'Large number with a small line chart', columns: 'Column chart', barrace: 'Animated bar chart race', bars: 'Bar chart',
      choropleth: 'Map', bubblemap: 'Map with circles', stacked: 'Stacked line charts', scatter: 'Scatter plot' }[o.chart] || 'Chart';
    return cut(`${kind}: ${o.title}. ${o.subtitle ? o.subtitle + '. ' : ''}${a.headline} ${(a.facts || []).slice(0, 2).map(f => f.text).join(' ')} Source: ${sourceText(ds)}.`, 1000);
  };
  PS.postCaptions = (ds, a, o, link) => {
    const take = o.takeawayText || a.headline;
    const facts = (a.facts || []).slice(0, 3).map(f => f.text);
    const read = ds.howToRead?.[0] || a.howTo || '';
    const src = `Source: ${sourceText(ds)}${ds.source.url ? ' ' + ds.source.url : ''}`;
    const T = tags(ds).join(' ');
    const linkLine = link ? `Explore the data: ${link}` : '';
    return {
      linkedin: cut([o.title, '', take, '', ...facts.map(f => '• ' + f), read ? `\nHow to read it: ${read}` : '', '', src, linkLine, '', T].filter(x => x !== null).join('\n').replace(/\n{3,}/g, '\n\n'), 3000),
      facebook: cut([o.title, '', take, '', ...facts.slice(0, 2), '', src, linkLine].join('\n').replace(/\n{3,}/g, '\n\n'), 2000),
      x: (() => { const tail = `\n\nSource: ${ds.source.publisher}${link ? '\n' + link : ''}`; const room = 280 - (link ? 23 + 1 : 0) - `\n\nSource: ${ds.source.publisher}`.length; return cut(take, room) + tail; })(),
      instagram: cut([o.title, '', take, '', ...facts, '', `Data: ${sourceText(ds)}`, '', T].join('\n'), 2200),
      tiktok: cut(`${take} Data: ${ds.source.publisher}. ${T}`, 2200),
      // Threads: 500 characters, one topic tag works best.
      threads: (() => { const tail = `\n\nData: ${ds.source.publisher}${link ? '\n' + link : ''}`; const extra = (a.facts || []).map(f => f.text).find(t => !/^Latest:/.test(t)); return cut([take, extra ? '\n\n' + extra : ''].join(''), 500 - tail.length) + tail; })(),
      // Bluesky: 300 characters including the link.
      bluesky: (() => { const tail = `\n\nData: ${ds.source.publisher}${link ? '\n' + link : ''}`; return cut(take, 300 - tail.length) + tail; })(),
      // YouTube Shorts: title line (100 max), then the description.
      // Reddit (r/dataisbeautiful and similar): an image post titled "[OC] ...", then a first
      // comment citing the source and the tool. This text is that comment; the title is redditTitle.
      reddit: [`Source: ${sourceText(ds)}${ds.source.url ? ' (' + ds.source.url + ')' : ''}. Retrieved ${PS.fmtRetrieved(ds.retrieved)}.`,
        `Tool: Civic Charts (civiccharts.com), built directly from the official data.${link ? ' Rebuild or check this exact chart: ' + link : ''}`,
        read ? `How to read it: ${read}` : ''].filter(Boolean).join('\n\n'),
      // Descriptive, not a conclusion: "[OC] Unemployment rate by state, 1976–2026".
      redditTitle: cut(`[OC] ${o.title}${(/\d{4}\s*[–-]\s*\d{4}/.exec(o.subtitle || '') || [''])[0] && !/\d{4}\s*[–-]\s*\d{4}/.test(o.title) ? ', ' + /\d{4}\s*[–-]\s*\d{4}/.exec(o.subtitle)[0] : ''}`, 300),
      youtube: [cut(o.title, 100), '', take, '', ...facts.map(f => '• ' + f), '', src, linkLine, '', `${T} #Shorts`].join('\n').replace(/\n{3,}/g, '\n\n'),
    };
  };
  PS.captionChunks = script => {
    const words = script.split(/\s+/).filter(Boolean), chunks = []; let cur = [];
    for (const w of words) { cur.push(w); if (cur.length >= 7 || (/[.!?]$/.test(w) && cur.length >= 3) || (/,$/.test(w) && cur.length >= 5)) { chunks.push(cur.join(' ')); cur = []; } }
    if (cur.length) chunks.push(cur.join(' '));
    const total = chunks.reduce((s, c) => s + c.split(' ').length, 0); let acc = 0;
    return chunks.map(c => { const n = c.split(' ').length; const r = { text: c, a: acc / total, b: (acc + n) / total }; acc += n; return r; });
  };
  // Same timing the renderer uses for burned-in captions.
  PS.srt = (script, duration) => {
    const ts = s => { const ms = Math.round(s * 1000), h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    const at = f => (0.03 + f * (0.985 - 0.03)) * duration;
    return PS.captionChunks(script).map((c, i) => `${i + 1}\n${ts(at(c.a))} --> ${ts(at(c.b))}\n${c.text}\n`).join('\n');
  };

  // ---------- PNG provenance metadata (tEXt chunks) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  PS.pngWithMeta = async (blob, meta) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const latin = s => new Uint8Array([...String(s).normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '')].map(ch => ch.charCodeAt(0)));
    const chunks = Object.entries(meta).filter(([, v]) => v).map(([k, v]) => {
      const data = new Uint8Array([...latin(k), 0, ...latin(v)]), type = latin('tEXt');
      const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
      dv.setUint32(0, data.length); out.set(type, 4); out.set(data, 8); dv.setUint32(8 + data.length, crc32(new Uint8Array([...type, ...data])));
      return out;
    });
    const iend = buf.length - 12; // IEND chunk is always last
    return new Blob([buf.slice(0, iend), ...chunks, buf.slice(iend)], { type: 'image/png' });
  };

  // ---------- LinkedIn carousel (PDF document post) ----------
  const loadScript = (src, global = 'jspdf') => new Promise((res, rej) => { if (window[global]) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the export library. Check your connection and try again.')); document.head.appendChild(s); });
  // Text-only slide drawn in the chart's own look.
  function textSlide(st, W, H, heading, items, footer) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'); const T = st.T, S = W / 1080;
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    const pad = 80 * S; let y = 110 * S;
    ctx.fillStyle = st.accent; ctx.fillRect(pad, y, 14 * S, 50 * S);
    ctx.font = `${st.T.headWeight} ${56 * S}px "${st.head}", serif`; ctx.fillStyle = T.ink; ctx.textBaseline = 'top';
    PS.wrap(ctx, heading, W - pad * 2 - 30 * S, 3).forEach((l, i) => ctx.fillText(l, pad + 30 * S, y + i * 64 * S)); y += 220 * S;
    for (const it of items) {
      ctx.font = `${it.bold ? 700 : 400} ${(it.size || 36) * S}px "${st.body}", sans-serif`; ctx.fillStyle = it.muted ? T.muted : T.ink;
      const lines = PS.wrap(ctx, it.text, W - pad * 2, 8);
      if (it.bullet) { ctx.fillStyle = st.accent; ctx.beginPath(); ctx.arc(pad + 8 * S, y + 22 * S, 7 * S, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = T.ink; }
      lines.forEach((l, i) => ctx.fillText(l, pad + (it.bullet ? 34 * S : 0), y + i * (it.size || 36) * 1.35 * S)); y += lines.length * (it.size || 36) * 1.35 * S + 34 * S;
      if (y > H - 220 * S) break;
    }
    ctx.font = `400 ${24 * S}px "${st.body}", sans-serif`; ctx.fillStyle = T.muted;
    PS.wrap(ctx, footer, W - pad * 2, 4).forEach((l, i) => ctx.fillText(l, pad, H - 170 * S + i * 32 * S));
    return cv.toDataURL('image/jpeg', 0.92);
  }
  PS.exportCarousel = async ({ renderer, ds, analysis, o, link, vendorBase = '' }) => {
    await loadScript(`${vendorBase}vendor/jspdf.umd.min.js`);
    const W = 1080, H = 1350, st = renderer.st;
    renderer.draw(1);
    const pages = [renderer.canvas.toDataURL('image/jpeg', 0.92)];
    const src = `Source: ${sourceText(ds)}. Retrieved ${PS.fmtRetrieved(ds.retrieved)}.`;
    pages.push(textSlide(st, W, H, 'What the data shows', [{ text: o.takeawayText || analysis.headline, bold: true, size: 40 }, ...(analysis.facts || []).slice(0, 4).map(f => ({ text: f.text, bullet: true, size: 32 }))], src));
    const read = [...(ds.howToRead || []), analysis.howTo].filter(Boolean).slice(0, 2).map(t => ({ text: t, size: 32 }));
    const care = (analysis.checks || []).filter(c => c.level === 'warn' || c.title === 'Context').slice(0, 3).map(c => ({ text: `${c.title}: ${c.detail}`, bullet: true, size: 28, muted: true }));
    pages.push(textSlide(st, W, H, 'How to read it', [...read, ...care], src));
    pages.push(textSlide(st, W, H, 'Sources & method', [
      { text: src, size: 32 }, ...(ds.source.url ? [{ text: ds.source.url, size: 28, muted: true }] : []),
      { text: 'Every number on these slides comes from the source data. Nothing is estimated by AI.', size: 30 },
      ...(link ? [{ text: `Rebuild this chart from the official data at ${link.split('#')[0].replace(/^https?:\/\//, '').replace(/\/$/, '')} (full link in the post).`, size: 26, muted: true }] : []),
    ], o.handle ? `${o.handle} · Made with ${PS.SITE}` : `Made with ${PS.SITE}`));
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'px', format: [W, H], hotfixes: ['px_scaling'] });
    pages.forEach((p, i) => { if (i) doc.addPage([W, H], 'portrait'); doc.addImage(p, 'JPEG', 0, 0, W, H); });
    doc.setProperties({ title: o.title, subject: analysis.headline, author: o.handle || 'Civic Charts', keywords: `${ds.source.publisher}, open data`, creator: 'Civic Charts' });
    return doc.output('blob');
  };

  // ---------- presentation and report exports ----------
  // Shared text for slides, briefs and notes, so every format says the same thing.
  function storyParts(ds, analysis, o, link) {
    const src = `${sourceText(ds)}${ds.source.via ? ' (via ' + ds.source.via + ')' : ''}`;
    return {
      title: o.title || ds.title,
      takeaway: o.takeawayText || analysis.headline,
      facts: (analysis.facts || []).slice(0, 5).map(f => f.text),
      read: [...(ds.howToRead || []), analysis.howTo].filter(Boolean).slice(0, 3),
      care: (analysis.checks || []).filter(c => c.level === 'warn' || c.title === 'Context').slice(0, 4).map(c => `${c.title}: ${c.detail}`),
      caveats: (ds.caveats || []).filter(c => !(analysis.checks || []).some(k => k.detail && (k.detail.includes(c) || c.includes(k.detail)))).slice(0, 3),
      source: src, url: ds.source.url || '', retrieved: PS.fmtRetrieved(ds.retrieved),
      link: link || '', unverified: !!ds.source.unverified,
    };
  }
  // jsPDF's built-in fonts cover Latin-1 only; map the rest so nothing renders as junk.
  const latin = t => String(t ?? '').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/•/g, '-').replace(/→/g, '->').replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080)).replace(/ /g, ' ').replace(/[^\x00-\xFF]/g, '');
  const hex = c => (/^#?([0-9a-f]{6})$/i.exec(String(c).trim()) || [, '2A78D6'])[1].toUpperCase();

  // PowerPoint: the chart full-bleed, then editable text slides; speaker notes carry the
  // takeaway, facts and sources so a presenter can't lose the context.
  PS.exportPptx = async ({ chartPng, ds, analysis, o, link, st, vendorBase = '' }) => {
    await loadScript(`${vendorBase}vendor/pptxgen.bundle.js`, 'PptxGenJS');
    const k = storyParts(ds, analysis, o, link), accent = hex(st?.accent), ink = '1A1A1A', muted = '5B6470', face = 'Arial';
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in, 16:9
    pptx.title = k.title; pptx.subject = k.takeaway; pptx.author = o.handle || 'Civic Charts'; pptx.company = `Made with ${PS.SITE}`;
    const notes = [k.takeaway, '', ...k.facts.map(f => '- ' + f), '', ...k.read, ...(k.care.length ? ['', 'Keep in mind:', ...k.care.map(c => '- ' + c)] : []), '',
      `Source: ${k.source}. Retrieved ${k.retrieved}.`, k.url, k.link ? `Rebuild this chart from the official data: ${k.link}` : ''].filter(x => x != null).join('\n');
    const foot = (slide, text) => slide.addText(text, { x: 0.6, y: 6.75, w: 12.1, h: 0.45, fontFace: face, fontSize: 11, color: muted, valign: 'bottom' });
    const head = (slide, text) => {
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.62, w: 0.09, h: 0.5, fill: { color: accent }, line: { color: accent } });
      slide.addText(text, { x: 0.85, y: 0.5, w: 11.9, h: 0.75, fontFace: face, fontSize: 30, bold: true, color: ink, valign: 'middle' });
    };
    const srcLine = `Source: ${k.source}. Retrieved ${k.retrieved}.`;
    // 1. The chart, exactly as exported (title, source line and stamps included).
    const s1 = pptx.addSlide(); s1.background = { color: 'FFFFFF' };
    s1.addImage({ data: chartPng.replace(/^data:/, ''), x: 0, y: 0, w: 13.333, h: 7.5, altText: PS.altText(ds, analysis, o) });
    s1.addNotes(notes);
    // 2. What the data shows (editable).
    const s2 = pptx.addSlide(); head(s2, 'What the data shows');
    s2.addText(k.takeaway, { x: 0.85, y: 1.45, w: 11.9, h: 1.3, fontFace: face, fontSize: 24, bold: true, color: ink, valign: 'top' });
    if (k.facts.length) s2.addText(k.facts.map(f => ({ text: f, options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 10 } })), { x: 0.85, y: 2.9, w: 11.9, h: 3.7, fontFace: face, fontSize: 18, color: ink, valign: 'top' });
    foot(s2, srcLine); s2.addNotes(notes);
    // 3. How to read it, only when there is something to say.
    if (k.read.length || k.care.length) {
      const s3 = pptx.addSlide(); head(s3, 'How to read it');
      const items = [...k.read.map(t => ({ text: t, options: { breakLine: true, paraSpaceAfter: 12 } })), ...k.care.map(t => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true, color: muted, fontSize: 15, paraSpaceAfter: 8 } }))];
      s3.addText(items, { x: 0.85, y: 1.45, w: 11.9, h: 5.2, fontFace: face, fontSize: 18, color: ink, valign: 'top' });
      foot(s3, srcLine); s3.addNotes(notes);
    }
    // 4. Sources and method.
    const s4 = pptx.addSlide(); head(s4, 'Sources and method');
    const rows = [{ text: k.unverified ? `Data provided by the presenter (${ds.source.dataset}); not verified by Civic Charts.` : `${k.source}. Retrieved ${k.retrieved}.`, options: { breakLine: true, paraSpaceAfter: 10 } }];
    if (k.url) rows.push({ text: k.url, options: { hyperlink: { url: k.url }, color: accent, fontSize: 15, breakLine: true, paraSpaceAfter: 14 } });
    k.caveats.forEach(c => rows.push({ text: c, options: { bullet: { indent: 18 }, color: muted, fontSize: 15, breakLine: true, paraSpaceAfter: 8 } }));
    rows.push({ text: `Spot an error? ${PS.CONTACT.corrections}`, options: { hyperlink: { url: `mailto:${PS.CONTACT.corrections}` }, color: muted, fontSize: 14, breakLine: true, paraSpaceAfter: 10 } });
    rows.push({ text: 'Every number in this deck comes from the source data. Nothing is estimated by AI.', options: { breakLine: true, paraSpaceAfter: 10 } });
    if (k.link) rows.push({ text: 'Rebuild this chart from the official data', options: { hyperlink: { url: k.link }, color: accent, fontSize: 15, breakLine: true } });
    s4.addText(rows, { x: 0.85, y: 1.45, w: 11.9, h: 5.2, fontFace: face, fontSize: 18, color: ink, valign: 'top' });
    foot(s4, o.handle ? `${o.handle} · Made with ${PS.SITE}` : `Made with ${PS.SITE}`); s4.addNotes(notes);
    return pptx.write({ outputType: 'blob' });
  };

  // One-page brief (US Letter PDF) with real, selectable text: for reports, newsrooms, handouts.
  PS.exportBrief = async ({ chartPng, chartW, chartH, ds, analysis, o, link, st, vendorBase = '' }) => {
    await loadScript(`${vendorBase}vendor/jspdf.umd.min.js`);
    const k = storyParts(ds, analysis, o, link);
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    const W = 612, H = 792, M = 50, CW = W - M * 2, acc = hex(st?.accent), rgb = [0, 2, 4].map(i => parseInt(acc.slice(i, i + 2), 16));
    // Lay out twice: measure the text first, then size the chart so everything fits one page.
    let y = M, dry = true;
    const BOTTOM = H - 56;
    const para = (text, { size = 10.5, style = 'normal', color = [26, 26, 26], gap = 6, indent = 0, bullet = false } = {}) => {
      doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
      const lines = doc.splitTextToSize(latin(text), CW - indent - (bullet ? 12 : 0)), lh = size * 1.32;
      if (!dry) {
        if (bullet) { doc.setFillColor(...rgb); doc.circle(M + indent + 3, y + size * 0.62, 2, 'F'); }
        doc.text(lines, M + indent + (bullet ? 12 : 0), y, { baseline: 'top' });
      }
      y += lines.length * lh + gap;
    };
    const heading = text => { y += 6; if (!dry) { doc.setFillColor(...rgb); doc.rect(M, y + 1, 3, 11, 'F'); } para(text.toUpperCase(), { size: 9.5, style: 'bold', color: [91, 100, 112], indent: 10, gap: 6 }); };
    const body = () => {
      heading('What the data shows');
      para(k.takeaway, { size: 13, style: 'bold', gap: 8 });
      k.facts.forEach(f => para(f, { bullet: true, gap: 4 }));
      if (k.read.length) { heading('How to read it'); k.read.forEach(t => para(t)); }
      if (k.care.length) { heading('Keep in mind'); k.care.forEach(t => para(t, { bullet: true, size: 9.5, color: [70, 76, 84], gap: 3 })); }
      heading('Source');
      para(k.unverified ? `Data provided by the creator (${ds.source.dataset}); not verified by Civic Charts.` : `${k.source}. Retrieved ${k.retrieved}.`, { size: 9.5 });
      if (k.url) { if (!dry) { doc.setTextColor(...rgb); doc.setFontSize(9.5); doc.textWithLink(latin(k.url).slice(0, 110), M, y, { url: k.url, baseline: 'top' }); } y += 16; }
      para(`Spot an error? ${PS.CONTACT.corrections}`, { size: 9, color: [91, 100, 112], gap: 4 });
    };
    y = 0; body(); const textH = y;
    // Chart takes the full width unless that would push the text off the page (min 55% width).
    let iw = CW, ih = CW * chartH / chartW;
    const room = BOTTOM - M - 18 - textH;
    if (ih > room) { ih = Math.max(room, CW * 0.55 * chartH / chartW); iw = ih * chartW / chartH; }
    dry = false; y = M;
    const ix = M + (CW - iw) / 2;
    doc.addImage(chartPng, 'PNG', ix, y, iw, ih, undefined, 'FAST'); doc.setDrawColor(225, 228, 232); doc.rect(ix, y, iw, ih); y += ih + 18;
    body();
    // Caveats only if they fit: the brief is meant to stay one page.
    for (const c of k.caveats) { doc.setFontSize(9); if (y + doc.splitTextToSize(latin(c), CW).length * 9 * 1.32 > BOTTOM) break; para(c, { size: 9, color: [91, 100, 112], gap: 3 }); }
    // Footer on every page.
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(120, 126, 134);
      doc.text(latin(`${o.handle ? o.handle + ' · ' : ''}Made with ${PS.SITE} · ${new Date().toISOString().slice(0, 10)}${n > 1 ? ` · ${i}/${n}` : ''}`), M, H - 34);
      if (k.link) { doc.setTextColor(...rgb); doc.textWithLink('Rebuild this chart from the official data', W - M - doc.getTextWidth('Rebuild this chart from the official data'), H - 34, { url: k.link }); }
    }
    doc.setProperties({ title: k.title, subject: k.takeaway, author: o.handle || 'Civic Charts', keywords: `${ds.source.publisher}, open data`, creator: 'Civic Charts' });
    return doc.output('blob');
  };

  // CSV of exactly what the chart shows, with the source on top so it travels with the numbers.
  PS.toCsv = (head, rows, ds) => {
    const q = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const meta = [['# ' + (ds.title || '')], [`# Source: ${sourceText(ds)}${ds.source.url ? ' ' + ds.source.url : ''}`], [`# Retrieved: ${PS.fmtRetrieved(ds.retrieved)}`], ...(ds.source.unverified ? [['# Uploaded by the creator; not verified by Civic Charts']] : [])];
    return '﻿' + [...meta, head, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  };

  // Embed: same share link, chart-only view, re-checked against the latest data on every load.
  PS.embedCode = (link, P, title) => {
    if (!link) return null;
    const url = link.replace('#', (link.includes('?') ? '&' : '?') + 'embed=1#');
    return `<iframe src="${url}" title="${String(title || 'Chart').replace(/"/g, '&quot;')}" style="width:100%;aspect-ratio:${P.w}/${P.h + Math.round(P.w * 0.06)};border:0" loading="lazy" allowfullscreen></iframe>`;
  };

  // ---------- share to installed apps / composers ----------
  PS.canShareFiles = file => { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; } };
  PS.composerUrl = (platform, text, link) => ({
    linkedin: `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
    facebook: link ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}` : 'https://www.facebook.com/',
    // Opens an image post with the title filled in; the user attaches the exported image.
    reddit: `https://www.reddit.com/submit?type=IMAGE&title=${encodeURIComponent(text)}`,
  }[platform]);
})(window.PS);
