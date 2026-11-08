// Plainsight post kit and sharing: per-platform captions, alt text, SRT captions,
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
  const loadScript = src => new Promise((res, rej) => { if (window.jspdf) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF library.')); document.head.appendChild(s); });
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
    ], o.handle ? `${o.handle} · Made with Plainsight` : 'Made with Plainsight'));
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'px', format: [W, H], hotfixes: ['px_scaling'] });
    pages.forEach((p, i) => { if (i) doc.addPage([W, H], 'portrait'); doc.addImage(p, 'JPEG', 0, 0, W, H); });
    doc.setProperties({ title: o.title, subject: analysis.headline, author: o.handle || 'Plainsight', keywords: `${ds.source.publisher}, open data`, creator: 'Plainsight' });
    return doc.output('blob');
  };

  // ---------- share to installed apps / composers ----------
  PS.canShareFiles = file => { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; } };
  PS.composerUrl = (platform, text, link) => ({
    linkedin: `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
    facebook: link ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}` : 'https://www.facebook.com/',
    reddit: link ? `https://www.reddit.com/submit?url=${encodeURIComponent(link)}` : 'https://www.reddit.com/submit',
  }[platform]);
})(window.PS);
