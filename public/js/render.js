// Civic Charts frame renderer.
// draw(p) renders the whole composition at timeline position p in [0, 1].
// Preview, PNG export and video export all call the same function, so what you
// see is exactly what ships.
(function (PS) {
  const { clamp, lerp, ease, seg, fmt, wrap, roundRect, rgba } = PS;
  const INTRO = 0.08;

  // ---------- geometry caches ----------
  const geoCache = {};
  function geo(kind, scope) {
    const key = kind + '|' + (scope || '');
    if (geoCache[key]) return geoCache[key];
    const G = window.PS_GEO;
    let out;
    if (kind === 'us-counties') {
      const C = window.PS_GEO_COUNTIES;
      if (!C) throw new Error('County map is still loading.');
      if (!geoCache.countiesAll) {
        const path = d3.geoPath();
        geoCache.countiesAll = {
          features: topojson.feature(C, C.objects.counties).features.map(f => ({ id: String(f.id), name: f.properties.name, p: new Path2D(path(f)), b: path.bounds(f) })),
          states: topojson.feature(C, C.objects.states).features.map(f => ({ id: String(f.id), p: new Path2D(path(f)), b: path.bounds(f) })),
          stateMesh: new Path2D(path(topojson.mesh(C, C.objects.states, (a, b) => a !== b))),
        };
      }
      const A = geoCache.countiesAll;
      // A chosen state zooms the map to that state's counties.
      const feats = scope ? A.features.filter(f => f.id.startsWith(scope)) : A.features;
      const st = scope && A.states.find(s => s.id === scope);
      const bb = st ? st.b : [[0, 0], [975, 610]];
      out = { w: bb[1][0] - bb[0][0], h: bb[1][1] - bb[0][1], x0: bb[0][0], y0: bb[0][1], features: feats, borders: scope ? (st && st.p) : A.stateMesh, outline: !!scope };
    } else if (kind === 'us-states') {
      const fc = topojson.feature(G.states, G.states.objects.states);
      const path = d3.geoPath();
      out = { w: 975, h: 610, features: fc.features.map(f => ({ id: f.id, name: f.properties.name, p: new Path2D(path(f)), c: path.centroid(f) })) };
      out.outline = new Path2D(path(topojson.mesh(G.states, G.states.objects.states, (a, b) => a === b)));
    } else {
      const fc = topojson.feature(G.world, G.world.objects.countries);
      fc.features = fc.features.filter(f => f.properties.name !== 'Antarctica');
      const proj = d3.geoEqualEarth().fitWidth(1000, { type: 'Sphere' });
      const path = d3.geoPath(proj);
      const [[, by0], [, by1]] = path.bounds(fc);
      out = { w: 1000, h: by1 - by0 + 8, y0: by0 - 4, proj, features: fc.features.map(f => ({ id: String(f.id), name: f.properties.name, p: new Path2D(path(f)) })) };
    }
    return (geoCache[key] = out);
  }
  PS.geoReady = kind => kind !== 'us-counties' || !!window.PS_GEO_COUNTIES;

  // ---------- style resolution ----------
  PS.resolveStyle = function (o, platform) {
    const T = { ...PS.THEMES[o.theme] };
    if (o.bg) { T.bg = o.bg; }
    const dark = T.mode === 'dark';
    const pal = o.palette === 'custom' ? o.customColors.filter(Boolean) : PS.PALETTES[o.palette][dark ? 'dark' : 'colors'];
    let stops;
    if (o.ramp === 'auto' || !PS.RAMPS[o.ramp]?.stops) {
      const c = pal[0];
      const mix = d3.interpolateLab(T.bg, c);
      stops = dark ? [mix(0.18), mix(0.45), c, d3.interpolateLab(c, '#ffffff')(0.45), d3.interpolateLab(c, '#ffffff')(0.8)]
        : [mix(0.12), mix(0.4), c, d3.interpolateLab(c, '#000000')(0.35), d3.interpolateLab(c, '#000000')(0.62)];
    } else {
      stops = PS.RAMPS[o.ramp].stops.slice();
      if (dark && o.ramp !== 'viridis' && o.ramp !== 'magma') stops.reverse();
      if (dark && (o.ramp === 'viridis' || o.ramp === 'magma')) stops.reverse();
    }
    const ramp = d3.scaleLinear().domain(stops.map((_, i) => i / (stops.length - 1))).range(stops).interpolate(d3.interpolateLab).clamp(true);
    // Diverging scale for data with a meaningful zero: red for losses, blue for gains, gray at zero.
    const div = d3.scaleLinear().domain([-1, -0.5, 0, 0.5, 1])
      .range(dark ? ['#e66767', '#8f4c4a', '#383835', '#2f5a8f', '#5598e7'] : ['#b02a2a', '#ef8a7a', '#f0efec', '#86b6ef', '#1c5cab'])
      .interpolate(d3.interpolateLab).clamp(true);
    const S = Math.min(platform.w, platform.h) / 1080;
    const ts = (o.textScale || 1) * (platform.h / platform.w > 1.6 ? 1.12 : 1);
    const head = o.headFont === 'theme' ? T.head : o.headFont;
    const body = o.bodyFont === 'theme' ? T.body : o.bodyFont;
    const accent = o.accent || pal[0];
    return { T, pal, ramp, div, S, ts, head, body, accent, dark, r: (o.radius ?? 6) * S, lw: (o.lineWidth ?? 5) * S, upper: T.upper };
  };

  const font = (st, weight, size, fam) => `${weight} ${Math.round(size)}px "${fam || st.body}", "Inter", system-ui, -apple-system, sans-serif`;
  const colorFor = (st, id, i) => st.pal[(i ?? hash(id)) % st.pal.length];
  function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
  function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  // ---------- captions ----------
  function captionChunks(script) {
    const words = script.split(/\s+/).filter(Boolean), chunks = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (cur.length >= 7 || (/[.!?]$/.test(w) && cur.length >= 3) || (/,$/.test(w) && cur.length >= 5)) { chunks.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) chunks.push(cur.join(' '));
    const total = chunks.reduce((a, c) => a + c.split(' ').length, 0);
    let acc = 0;
    return chunks.map(c => { const n = c.split(' ').length; const r = { text: c, a: acc / total, b: (acc + n) / total }; acc += n; return r; });
  }

  // ---------- main renderer ----------
  class Renderer {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); }

    setScene(scene) {
      this.scene = scene;
      const { platform } = scene;
      if (this.canvas.width !== platform.w || this.canvas.height !== platform.h) { this.canvas.width = platform.w; this.canvas.height = platform.h; }
      this.st = PS.resolveStyle(scene.o, platform);
      this.captions = scene.o.captions && scene.script ? captionChunks(scene.script) : null;
      this.layout = null;
    }

    computeLayout() {
      const { ctx } = this, { platform: P, o, ds } = this.scene, st = this.st, S = st.S, ts = st.ts;
      const W = P.w, H = P.h, sf = o.static && !P.uiOverlay ? { t: 0.05, r: 0.06, b: 0.04, l: 0.06 } : P.safe;
      const land = W > H * 1.2;
      const R = { x: W * sf.l, y: H * sf.t, w: W * (1 - sf.l - sf.r), h: H * (1 - sf.t - sf.b) };
      const L = { W, H, R, land };
      let y = R.y;
      // kicker
      L.kickerSize = 24 * S * ts; L.kickerY = y; y += L.kickerSize * 1.9;
      // title
      L.titleSize = (land ? 58 : W / H < 0.7 ? 70 : 64) * S * ts;
      ctx.font = font(st, st.T.headWeight, L.titleSize, st.head);
      const tt = st.upper ? o.title.toUpperCase() : o.title;
      L.titleLines = wrap(ctx, tt, R.w, 3); L.titleY = y; y += L.titleLines.length * L.titleSize * 1.12 + 10 * S;
      // subtitle
      L.subSize = (land ? 28 : 32) * S * ts;
      ctx.font = font(st, 400, L.subSize);
      L.subLines = o.subtitle ? wrap(ctx, o.subtitle, R.w, 3) : [];
      L.subY = y; y += L.subLines.length * L.subSize * 1.32 + 22 * S;
      // footer (bottom-up)
      L.footSize = 21 * S * ts;
      ctx.font = font(st, 400, L.footSize);
      const brandW = (o.handle || o.brand) ? Math.min(R.w * 0.32, 340 * S) : 0;
      L.footLines = wrap(ctx, this.sourceLine(), R.w - brandW - (brandW ? 24 * S : 0), 4);
      L.footH = L.footLines.length * L.footSize * 1.35;
      L.footY = R.y + R.h - L.footH;
      L.brandW = brandW;
      let bottom = L.footY - 22 * S;
      // takeaway / caption band
      L.bandSize = (land ? 30 : 36) * S * ts;
      if (o.takeaway || this.captions) {
        ctx.font = font(st, 600, L.bandSize);
        const tk = o.takeawayText || this.scene.analysis.headline;
        const pad = 26 * S;
        L.takeLines = o.takeaway ? wrap(ctx, tk, R.w - pad * 2 - 8 * S, land ? 2 : 4) : [];
        const capLines = this.captions ? 2 : 0;
        const lines = Math.max(L.takeLines.length, capLines);
        L.bandH = lines * L.bandSize * 1.3 + pad * 2;
        L.bandY = bottom - L.bandH; L.bandPad = pad;
        bottom = L.bandY - 26 * S;
      }
      L.chart = { x: R.x, y, w: R.w, h: Math.max(120 * S, bottom - y) };
      this.layout = L;
    }

    sourceLine() {
      const { ds, o } = this.scene;
      const s = ds.source;
      const tierLbl = { academic: ' (academic research)', nonprofit: ' (nonprofit research)', industry: ' (company data)' }[ds.tier] || '';
      // Permanent context the creator can't remove: unverified uploads, cropped ranges.
      if (s.unverified) return `Data provided by the creator (${s.dataset}); not verified by Civic Charts.${o.note ? ' ' + o.note : ''}`;
      let txt = `Source: ${s.publisher}${tierLbl}${s.dataset ? ', ' + s.dataset : ''}${s.via ? ' (via ' + s.via + ')' : ''}. Retrieved ${PS.fmtRetrieved(ds.retrieved)}.`;
      if (ds.lens && ds.lens !== 'Nominal dollars' && /computed by Civic Charts/.test((ds.caveats || []).join(' '))) txt += ' Adjusted by Civic Charts.';
      if (o.note) txt += ' ' + o.note;
      if (this._axisNote) txt += ' Note: y-axis does not start at zero.';
      if ((o.rangeStart != null || o.rangeEnd != null) && this.scene.fullRange) {
        const [a, b] = this.scene.fullRange, yr = t => new Date(t).getUTCFullYear();
        txt += ` Shows ${yr(o.rangeStart ?? a)}-${yr(o.rangeEnd ?? b)} of the ${yr(a)}-${yr(b)} record.`;
        const flip = this.scene.analysis.checks?.find(c => c.title === 'Selected range reverses the long-term trend');
        if (flip) txt += ' The full record shows the opposite trend.';
      }
      return txt;
    }

    draw(p) {
      const { ctx } = this, s = this.scene, st = this.st, o = s.o;
      if (o.static) p = 1;
      this._axisNote = ['line', 'area'].includes(o.chart) && !o.zeroBase && s.ds.refLine == null;
      if (!this.layout) this.computeLayout();
      const L = this.layout, T = st.T, S = st.S;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // background
      ctx.fillStyle = T.bg; ctx.fillRect(0, 0, L.W, L.H);
      if (o.bgGradient) {
        const g = ctx.createLinearGradient(0, 0, 0, L.H);
        g.addColorStop(0, rgba(st.accent, st.dark ? 0.16 : 0.07)); g.addColorStop(0.6, rgba(st.accent, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, L.W, L.H);
      }
      const mainEnd = o.takeaway ? 0.8 : 0.94;
      const raw = seg(p, INTRO, mainEnd);
      const q = o.static ? 1 : (s.o.motion === 'smooth' ? ease.inOut(raw) : 0.75 * raw + 0.25 * ease.inOut(raw));
      const aHead = o.static ? 1 : ease.out(seg(p, 0, 0.05));
      const aSub = o.static ? 1 : ease.out(seg(p, 0.02, 0.07));
      const aChart = o.static ? 1 : ease.out(seg(p, 0.04, 0.1));

      // kicker
      ctx.globalAlpha = aHead;
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      const kick = (o.kicker || `${s.ds.category} · ${s.ds.source.publisher}`).toUpperCase();
      ctx.font = font(st, 700, L.kickerSize); spaced(ctx, 2.2 * S);
      ctx.fillStyle = st.accent;
      roundRect(ctx, L.R.x, L.kickerY + L.kickerSize * 0.12, 10 * S, L.kickerSize * 0.78, 2 * S); ctx.fill();
      ctx.fillStyle = T.muted; ctx.fillText(kick, L.R.x + 22 * S, L.kickerY);
      spaced(ctx, 0);
      // title
      ctx.font = font(st, st.T.headWeight, L.titleSize, st.head); ctx.fillStyle = T.ink;
      const rise = (1 - aHead) * 18 * S;
      L.titleLines.forEach((ln, i) => ctx.fillText(ln, L.R.x, L.titleY + i * L.titleSize * 1.12 + rise));
      ctx.globalAlpha = aSub;
      ctx.font = font(st, 400, L.subSize); ctx.fillStyle = T.muted;
      L.subLines.forEach((ln, i) => ctx.fillText(ln, L.R.x, L.subY + i * L.subSize * 1.32));

      // chart
      ctx.globalAlpha = aChart;
      const st2 = { ...st, q, p, o, ds: s.ds, view: s.analysis.view, analysis: s.analysis, aChart, statik: !!o.static };
      ctx.save();
      const C = L.chart;
      try { (CHART_DRAW[o.chart] || CHART_DRAW.line)(ctx, C, st2); }
      catch (e) { console.error(e); ctx.fillStyle = T.muted; ctx.font = font(st, 400, 28 * S); ctx.fillText('This chart type does not fit this data.', C.x, C.y + 40 * S); }
      ctx.restore();
      ctx.globalAlpha = 1;

      // band: captions during the build, takeaway at the end
      if (L.bandH) this.drawBand(p, mainEnd);
      this.drawFooter();
      if (o.showSafe) this.drawSafe();
      ctx.restore();
    }

    drawBand(p, mainEnd) {
      const { ctx } = this, L = this.layout, st = this.st, T = st.T, S = st.S, o = this.scene.o;
      const aTake = o.static ? 1 : ease.out(seg(p, mainEnd, mainEnd + 0.05));
      const x = L.R.x, y = L.bandY, w = L.R.w, h = L.bandH, pad = L.bandPad;
      if (o.takeaway && aTake > 0) {
        ctx.globalAlpha = aTake;
        const slide = (1 - aTake) * 30 * S;
        ctx.fillStyle = T.card; roundRect(ctx, x, y + slide, w, h, Math.max(st.r, 4 * S)); ctx.fill();
        ctx.fillStyle = st.accent; roundRect(ctx, x, y + slide, 8 * S, h, Math.min(st.r, 4 * S)); ctx.fill();
        ctx.fillStyle = T.ink; ctx.font = font(st, 600, L.bandSize); ctx.textBaseline = 'top';
        const lh = L.bandSize * 1.3, top = y + slide + (h - L.takeLines.length * lh) / 2;
        L.takeLines.forEach((ln, i) => ctx.fillText(ln, x + pad + 8 * S, top + i * lh));
        ctx.globalAlpha = 1;
      }
      if (this.captions && !o.static && aTake < 1) {
        const tp = seg(p, 0.03, 0.985);
        const c = this.captions.find(c => tp >= c.a && tp < c.b) || (tp >= 1 ? null : this.captions[0]);
        if (!c) return;
        ctx.globalAlpha = 1 - aTake;
        ctx.font = font(st, 700, L.bandSize * 1.04);
        const lines = wrap(ctx, c.text, w - pad * 2, 2), lh = L.bandSize * 1.3;
        const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 1.4;
        const bh = lines.length * lh + pad * 0.9;
        const bx = x + (w - bw) / 2, by = y + (h - bh) / 2;
        ctx.fillStyle = st.dark ? 'rgba(0,0,0,0.72)' : 'rgba(15,15,15,0.86)';
        roundRect(ctx, bx, by, bw, bh, 12 * S); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        lines.forEach((ln, i) => ctx.fillText(ln, x + w / 2, by + pad * 0.45 + i * lh + L.bandSize * 0.08));
        ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      }
    }

    drawFooter() {
      const { ctx } = this, L = this.layout, st = this.st, T = st.T, S = st.S, o = this.scene.o;
      ctx.strokeStyle = T.grid; ctx.lineWidth = 2 * S;
      ctx.beginPath(); ctx.moveTo(L.R.x, L.footY - 12 * S); ctx.lineTo(L.R.x + L.R.w, L.footY - 12 * S); ctx.stroke();
      ctx.font = font(st, 400, L.footSize); ctx.fillStyle = T.muted; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      L.footLines.forEach((ln, i) => ctx.fillText(ln, L.R.x, L.footY + i * L.footSize * 1.35));
      if (L.brandW) {
        ctx.textAlign = 'right';
        let yy = L.footY;
        if (o.handle) { ctx.font = font(st, 700, L.footSize * 1.1); ctx.fillStyle = T.ink; ctx.fillText(o.handle, L.R.x + L.R.w, yy); yy += L.footSize * 1.4; }
        if (o.brand) { ctx.font = font(st, 600, L.footSize * 0.9); ctx.fillStyle = T.faint; ctx.fillText(`Made with ${PS.SITE}`, L.R.x + L.R.w, yy); }
        ctx.textAlign = 'left';
      }
    }

    drawSafe() {
      const { ctx } = this, L = this.layout, P = this.scene.platform, S = this.st.S;
      const { W, H } = L, s = (this.scene.o.static && !P.uiOverlay) ? { t: L.R.y / H, r: 1 - (L.R.x + L.R.w) / W, b: 1 - (L.R.y + L.R.h) / H, l: L.R.x / W } : P.safe;
      const rect = { t: [0, 0, W, H * s.t], b: [0, H * (1 - s.b), W, H * s.b], l: [0, H * s.t, W * s.l, H * (1 - s.t - s.b)], r: [W * (1 - s.r), H * s.t, W * s.r, H * (1 - s.t - s.b)] };
      ctx.save();
      ctx.fillStyle = 'rgba(255,0,90,0.14)';
      Object.values(rect).forEach(r => ctx.fillRect(...r));
      ctx.strokeStyle = 'rgba(255,0,90,0.75)'; ctx.setLineDash([12 * S, 8 * S]); ctx.lineWidth = 3 * S;
      ctx.strokeRect(L.R.x, L.R.y, L.R.w, L.R.h);
      ctx.setLineDash([]);
      const fs = 20 * S; ctx.font = `700 ${fs}px Inter, sans-serif`; ctx.textBaseline = 'middle';
      const tag = (text, x, y, align = 'left') => {
        const w = ctx.measureText(text).width + fs, h = fs * 1.6, x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
        ctx.fillStyle = 'rgba(255,0,90,0.92)'; roundRect(ctx, x0, y - h / 2, w, h, h / 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, x0 + w / 2, y);
      };
      const zones = P.zones || [{ side: 'b', label: 'Edges may be cropped or covered' }];
      for (const z of zones) {
        if (z.side === 't') tag(z.label, W / 2, H * s.t / 2 + fs * 0.6, 'center');
        if (z.side === 'b') tag(z.label, W / 2, H * (1 - s.b / 2), 'center');
        if (z.side === 'r') {
          // Mimic the button stack so it is obvious what sits there.
          const cx = W * (1 - s.r / 2), r = Math.min(W * s.r * 0.3, 34 * S);
          ctx.fillStyle = 'rgba(255,0,90,0.55)';
          for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx, H * 0.48 + i * r * 3.4, r, 0, Math.PI * 2); ctx.fill(); }
          ctx.save(); ctx.translate(cx, H * 0.33); ctx.rotate(-Math.PI / 2); tag(z.label, 0, 0, 'center'); ctx.restore();
        }
      }
      ctx.restore();
    }
  }
  PS.Renderer = Renderer;

  // ---------- shared chart pieces ----------
  function bigDate(ctx, st, text, x, y, size, align = 'left') {
    ctx.save();
    ctx.font = font(st, 800, size, st.head); ctx.fillStyle = st.T.ink; ctx.globalAlpha *= st.dark ? 0.2 : 0.13;
    ctx.textAlign = align; ctx.textBaseline = 'top'; ctx.fillText(text, x, y);
    ctx.restore();
  }
  function legendRow(ctx, st, items, x, y, maxW) {
    const S = st.S;
    ctx.font = font(st, 500, 24 * S * st.ts); ctx.textBaseline = 'middle';
    let cx = x;
    for (const it of items) {
      const w = ctx.measureText(it.name).width + 46 * S;
      if (cx + w > x + maxW && cx > x) { cx = x; y += 36 * S; }
      ctx.fillStyle = it.color; roundRect(ctx, cx, y - 6 * S, 26 * S, 12 * S, 6 * S); ctx.fill();
      ctx.fillStyle = st.T.muted; ctx.fillText(it.name, cx + 34 * S, y);
      cx += w;
    }
    return y + 30 * S;
  }
  function pill(ctx, st, text, x, y, opts = {}) {
    const S = st.S, size = (opts.size || 26) * S * st.ts;
    ctx.font = font(st, 700, size);
    const w = ctx.measureText(text).width + 24 * S, h = size * 1.55;
    let px = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
    px = clamp(px, opts.minX ?? -1e9, (opts.maxX ?? 1e9) - w);
    const py = y - h / 2;
    ctx.fillStyle = opts.bg || st.T.ink; roundRect(ctx, px, py, w, h, Math.min(h / 2, Math.max(st.r, 6 * S))); ctx.fill();
    ctx.fillStyle = opts.fg || st.T.bg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, px + 12 * S, y + 1 * S);
    return { x: px, y: py, w, h };
  }
  function gridY(ctx, st, ticks, y, x0, x1, fmtTick) {
    const S = st.S, T = st.T;
    ctx.font = font(st, 400, 22 * S * st.ts); ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const t of ticks) {
      const yy = y(t);
      if (st.o.grid !== 'none') {
        ctx.strokeStyle = t === 0 ? T.axis : T.grid; ctx.lineWidth = (t === 0 ? 2.5 : 1.5) * S;
        if (st.o.grid === 'dashed' && t !== 0) ctx.setLineDash([6 * S, 6 * S]);
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = T.faint; ctx.fillText(fmtTick(t), x0 - 14 * S, yy);
    }
    ctx.textAlign = 'left';
  }
  function interpAt(pts, t) {
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) if (pts[i].t >= t) { const a = pts[i - 1], b = pts[i]; return lerp(a.v, b.v, (t - a.t) / (b.t - a.t || 1)); }
    return pts[pts.length - 1].v;
  }
  function tickFormat(st) { const u = st.ds.unit; return v => fmt(v, u, { short: true, decimals: u.format === 'pct' && Math.abs(v) >= 10 ? 0 : u.format === 'usdT' ? 0 : undefined }); }

  // ---------- chart types ----------
  const CHART_DRAW = {};

  CHART_DRAW.line = CHART_DRAW.area = function (ctx, C, st) {
    const S = st.S, T = st.T, o = st.o, ds = st.ds, area = o.chart === 'area';
    let series = st.view.series;
    if (ds.kind === 'panel') series = panelToSeries(ds, st.view, o);
    const multi = series.length > 1;
    let top = C.y;
    const colorOf = (s, i) => (s.ref ? T.muted : st.pal[i % st.pal.length]);
    if (multi) top = legendRow(ctx, st, series.map((s, i) => ({ name: s.name, color: colorOf(s, i) })), C.x, C.y + 12 * S, C.w) + 6 * S;
    const all = series.flatMap(s => s.pts);
    const t0 = d3.min(all, p => p.t), t1 = d3.max(all, p => p.t);
    let lo = d3.min(all, p => p.v), hi = d3.max(all, p => p.v);
    if (o.zeroBase) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const pad = (hi - lo) * 0.06 || 1;
    const y = d3.scaleLinear().domain([o.zeroBase && lo >= 0 ? 0 : lo - pad, hi + pad]).nice(5);
    const tf = tickFormat(st);
    ctx.font = font(st, 400, 22 * S * st.ts);
    const ticks = y.ticks(5);
    const left = C.x + Math.max(...ticks.map(t => ctx.measureText(tf(t)).width)) + 18 * S;
    const right = C.x + C.w - 8 * S, bottom = C.y + C.h - 44 * S;
    y.range([bottom, top + 30 * S]);
    const x = d3.scaleUtc().domain([t0, t1]).range([left, right]);
    gridY(ctx, st, ticks, y, left, right, tf);
    if (ds.refLine != null && ds.refLine >= y.domain()[0] && ds.refLine <= y.domain()[1]) {
      ctx.save(); ctx.strokeStyle = T.muted; ctx.lineWidth = 2 * S; ctx.setLineDash([8 * S, 6 * S]);
      ctx.beginPath(); ctx.moveTo(left, y(ds.refLine)); ctx.lineTo(right, y(ds.refLine)); ctx.stroke(); ctx.restore();
      ctx.font = font(st, 600, 20 * S * st.ts); ctx.fillStyle = T.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${ds.refLine} = starting level`, left + 10 * S, y(ds.refLine) + 6 * S);
    }
    // x ticks
    ctx.fillStyle = T.faint; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xt = x.ticks(Math.max(2, Math.floor((right - left) / (170 * S))));
    const yrs = (t1 - t0) / 31536e6;
    xt.forEach(t => ctx.fillText(yrs > 3 ? t.getUTCFullYear() : PS.fmtDate(t, 'monthly'), x(t), bottom + 12 * S));
    ctx.textAlign = 'left';
    if (!o.zeroBase && y.domain()[0] > 0 && ds.refLine == null) {
      ctx.strokeStyle = T.axis; ctx.lineWidth = 2 * S;
      ctx.beginPath(); ctx.moveTo(left - 10 * S, bottom + 4 * S); ctx.lineTo(left + 4 * S, bottom - 6 * S); ctx.moveTo(left - 10 * S, bottom + 12 * S); ctx.lineTo(left + 4 * S, bottom + 2 * S); ctx.stroke();
    }
    const tq = t0 + (t1 - t0) * st.q;
    if (!st.statik) bigDate(ctx, st, PS.fmtDate(tq, ds.frequency === 'weekly' || ds.frequency === 'daily' ? 'monthly' : ds.frequency), left + 16 * S, top + 30 * S, 76 * S * st.ts);
    const base = y(Math.max(y.domain()[0], Math.min(0, y.domain()[1])));
    const ends = [];
    series.forEach((s, si) => {
      const color = colorOf(s, si);
      const pts = s.pts.filter(p => p.t <= tq);
      if (!pts.length) return;
      const endV = interpAt(s.pts, tq);
      const path = new Path2D();
      pts.forEach((p, i) => (i ? path.lineTo(x(p.t), y(p.v)) : path.moveTo(x(p.t), y(p.v))));
      path.lineTo(x(tq), y(endV));
      if (area) {
        const a = new Path2D(path); a.lineTo(x(tq), base); a.lineTo(x(pts[0].t), base); a.closePath();
        const g = ctx.createLinearGradient(0, y.range()[1], 0, base);
        g.addColorStop(0, rgba(color, multi ? 0.22 : 0.42)); g.addColorStop(1, rgba(color, 0.03));
        ctx.fillStyle = g; ctx.fill(a);
      }
      ctx.strokeStyle = color; ctx.lineWidth = st.lw * (s.ref ? 0.6 : multi && si > 0 ? 0.8 : 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (s.ref) ctx.setLineDash([st.lw * 2.2, st.lw * 1.6]);
      ctx.stroke(path); ctx.setLineDash([]);
      ends.push({ s, si, color, x: x(tq), y: y(endV), v: endV });
    });
    // peak annotation for the primary series
    if (o.annotate && series[0]) {
      const s = series[0];
      // Budget balances: the notable extreme is the largest deficit (lowest value), labeled below the point.
      const sw = !ds.combo && ds.unit.signWords;
      const pk = s.pts.reduce((a, b) => (sw ? b.v < a.v : b.v > a.v) ? b : a);
      if (pk.t <= tq && pk.t < s.pts.at(-1).t - (t1 - t0) * 0.02) {
        const a = st.statik ? 1 : seg(tq, pk.t, pk.t + (t1 - t0) * 0.04);
        ctx.save(); ctx.globalAlpha *= a;
        const px = x(pk.t), py = y(pk.v);
        ctx.strokeStyle = T.muted; ctx.lineWidth = 2 * S;
        ctx.beginPath(); ctx.arc(px, py, 9 * S, 0, Math.PI * 2); ctx.stroke();
        const when = PS.fmtDate(pk.t, ds.frequency === 'weekly' ? 'monthly' : ds.frequency);
        const label = sw ? `Largest ${sw.neg} ${fmt(Math.abs(pk.v), ds.unit)}${sw.of || ''} · ${when}` : `Peak ${fmt(pk.v, ds.unit)} · ${when}`;
        ctx.font = font(st, 600, 22 * S * st.ts);
        const lw = ctx.measureText(label).width;
        const lx = clamp(px - lw / 2, left, right - lw);
        const ly = sw ? Math.min(y.range()[0] - 26 * S, py + 20 * S) : Math.max(y.range()[1] - 26 * S, py - 46 * S);
        ctx.beginPath(); if (sw) { ctx.moveTo(px, py + 10 * S); ctx.lineTo(px, ly); } else { ctx.moveTo(px, py - 10 * S); ctx.lineTo(px, ly + 26 * S); } ctx.stroke();
        ctx.fillStyle = T.ink; ctx.textBaseline = 'top'; ctx.fillText(label, lx, ly);
        ctx.restore();
      }
    }
    // leading dots + value labels (labels use ink, never the series color)
    ends.sort((a, b) => a.y - b.y);
    let lastY = -1e9;
    ends.forEach(e => {
      ctx.fillStyle = T.bg; ctx.beginPath(); ctx.arc(e.x, e.y, st.lw * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(e.x, e.y, st.lw * 1.35, 0, Math.PI * 2); ctx.fill();
      let ly = Math.max(e.y - 44 * S, lastY + 48 * S);
      const b = pill(ctx, st, fmt(e.v, ds.unit), e.x, ly, { align: e.x > right - 160 * S ? 'right' : 'center', minX: left, maxX: right + 4 * S });
      lastY = ly;
    });
  };

  function panelToSeries(ds, view, o) {
    const ids = o.entities?.length ? o.entities : o.focus ? [o.focus] : (() => {
      const li = view.idx.at(-1);
      return ds.entities.filter(e => e.values[li] != null).sort((a, b) => b.values[li] - a.values[li]).slice(0, 3).map(e => e.id);
    })();
    return ids.map(id => ds.entities.find(e => e.id === id)).filter(Boolean).map(e => ({
      id: e.id, name: e.name, pts: view.idx.map(i => ({ t: ds._tms[i], v: e.values[i] })).filter(p => p.v != null),
    })).filter(s => s.pts.length).concat(ds.national && o.compareNational !== false ? [{
      id: '__national', name: ds.national.name, ref: true, pts: view.idx.map(i => ({ t: ds._tms[i], v: ds.national.values[i] })).filter(p => p.v != null),
    }] : []).filter(s => s.pts.length);
  }

  CHART_DRAW.bignumber = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, s = st.view.series[0], pts = s.pts;
    const t0 = pts[0].t, t1 = pts.at(-1).t, tq = t0 + (t1 - t0) * st.q;
    const v = interpAt(pts, tq);
    const cx = C.x + C.w / 2;
    const numSize = Math.min(C.w / 5.2, C.h * 0.3) * st.ts;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = font(st, 400, 30 * S * st.ts); ctx.fillStyle = T.muted;
    ctx.fillText(PS.fmtDate(tq, ds.frequency === 'weekly' ? 'daily' : ds.frequency, true), cx, C.y + C.h * 0.12);
    ctx.font = font(st, 800, numSize, st.head); ctx.fillStyle = T.ink;
    const txt = fmt(v, ds.unit, { short: false });
    if (ctx.measureText(txt).width > C.w) ctx.font = font(st, 800, numSize * C.w / ctx.measureText(txt).width * 0.95, st.head);
    ctx.fillText(txt, cx, C.y + C.h * 0.12 + numSize * 1.1);
    ctx.font = font(st, 500, 28 * S * st.ts); ctx.fillStyle = T.muted;
    ctx.fillText(ds.unit.label, cx, C.y + C.h * 0.12 + numSize * 1.1 + 46 * S);
    const ch = PS.fmtChange(pts[0].v, v, ds.unit);
    ctx.fillStyle = T.ink; ctx.font = font(st, 700, 30 * S * st.ts);
    ctx.globalAlpha *= st.statik ? 1 : seg(st.q, 0.15, 0.3);
    ctx.fillText(`${ch} since ${PS.fmtDate(t0, ds.frequency === 'weekly' ? 'monthly' : ds.frequency)}`, cx, C.y + C.h * 0.12 + numSize * 1.1 + 92 * S);
    ctx.globalAlpha = st.aChart;
    // sparkline
    const sy0 = C.y + C.h * 0.62, sy1 = C.y + C.h - 10 * S;
    const x = d3.scaleUtc().domain([t0, t1]).range([C.x + 20 * S, C.x + C.w - 20 * S]);
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(pts, p => p.v)), d3.max(pts, p => p.v)]).range([sy1, sy0]);
    const shown = pts.filter(p => p.t <= tq);
    const path = new Path2D();
    shown.forEach((p, i) => (i ? path.lineTo(x(p.t), y(p.v)) : path.moveTo(x(p.t), y(p.v))));
    path.lineTo(x(tq), y(v));
    const a = new Path2D(path); a.lineTo(x(tq), sy1); a.lineTo(x(t0), sy1); a.closePath();
    const g = ctx.createLinearGradient(0, sy0, 0, sy1); g.addColorStop(0, rgba(st.pal[0], 0.35)); g.addColorStop(1, rgba(st.pal[0], 0.02));
    ctx.fillStyle = g; ctx.fill(a);
    ctx.strokeStyle = st.pal[0]; ctx.lineWidth = st.lw * 0.8; ctx.lineJoin = 'round'; ctx.stroke(path);
    ctx.fillStyle = st.pal[0]; ctx.beginPath(); ctx.arc(x(tq), y(v), st.lw * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.font = font(st, 400, 22 * S); ctx.fillStyle = T.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(new Date(t0).getUTCFullYear(), x(t0), sy1 + 8 * S); ctx.textAlign = 'right'; ctx.fillText(new Date(t1).getUTCFullYear(), x(t1), sy1 + 8 * S);
    ctx.textAlign = 'left';
  };

  CHART_DRAW.columns = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, o = st.o;
    let bars, label;
    if (ds.kind === 'events') {
      const by = d3.rollup(st.view.events, v => v.length, e => e.t.slice(0, 10));
      bars = [...by.entries()].sort().map(([k, v]) => ({ k, label: PS.fmtDate(k, 'daily').replace(/, \d{4}$/, ''), v }));
      label = 'Events per day';
    } else {
      const pts = st.view.series[0].pts;
      const by = d3.rollup(pts, v => d3.mean(v, p => p.v), p => new Date(p.t).getUTCFullYear());
      bars = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ k, label: String(k), v }));
      // Long records (NASA's starts in 1880) keep every year; bars just get thinner.
      if (bars.length > 160) bars = bars.slice(-160);
      label = ds.frequency === 'annual' || ds.frequency === 'fiscal' ? '' : 'Annual average';
    }
    const n = bars.length;
    const tf = v => fmt(v, ds.kind === 'events' ? { format: 'number', decimals: 0 } : ds.unit, { short: true });
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(bars, b => b.v)), d3.max(bars, b => b.v)]).nice(5);
    ctx.font = font(st, 400, 22 * S * st.ts);
    const ticks = y.ticks(5);
    const left = C.x + Math.max(...ticks.map(t => ctx.measureText(tf(t)).width)) + 18 * S, right = C.x + C.w;
    const top = C.y + (label ? 44 * S : 12 * S), bottom = C.y + C.h - 44 * S;
    y.range([bottom, top + 34 * S]);
    if (label) { ctx.fillStyle = T.muted; ctx.font = font(st, 600, 24 * S * st.ts); ctx.textBaseline = 'top'; ctx.fillText(label, C.x, C.y); }
    gridY(ctx, st, ticks, y, left, right, tf);
    const band = (right - left) / n, gap = Math.max(2 * S, band * 0.18), bw = band - gap;
    const maxI = bars.reduce((m, b, i) => (b.v > bars[m].v ? i : m), 0);
    const y0 = y(0);
    let shown = -1;
    bars.forEach((b, i) => {
      const a = st.statik ? 1 : ease.out(seg(st.q, (i / n) * 0.85, (i / n) * 0.85 + 0.15));
      if (a <= 0) return;
      shown = i;
      const bx = left + i * band + gap / 2, by = y(b.v * a);
      const hl = o.highlightLast && i === n - 1;
      ctx.fillStyle = hl || !o.highlightLast ? st.pal[0] : rgba(st.pal[0], 0.45);
      const h = y0 - by, r = Math.min(st.r, bw / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, h >= 0 ? by : y0, bw, Math.abs(h), h >= 0 ? [r, r, 0, 0] : [0, 0, r, r]); else ctx.rect(bx, by, bw, h);
      ctx.fill();
    });
    // x labels (thinned)
    ctx.fillStyle = T.faint; ctx.font = font(st, 400, 21 * S * st.ts); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const every = Math.ceil(n / Math.max(2, Math.floor((right - left) / (110 * S))));
    bars.forEach((b, i) => { if ((n - 1 - i) % every === 0) ctx.fillText(b.label, left + i * band + band / 2, bottom + 12 * S); });
    // labels: max and latest shown
    const lbl = i => { const b = bars[i]; pill(ctx, st, tf(b.v), left + i * band + band / 2, y(b.v) - 28 * S, { align: 'center', minX: left, maxX: right, size: 22 }); };
    if (shown >= 0) { if (maxI <= shown && maxI !== shown && (shown - maxI) * band > 120 * S) lbl(maxI); lbl(shown); }
    ctx.textAlign = 'left';
  };

  // Value of entity at fractional time index tau (within view.idx), skipping gaps.
  function valAt(e, idx, tau) {
    const i0 = Math.floor(tau), i1 = Math.min(idx.length - 1, i0 + 1), f = tau - i0;
    const a = e.values[idx[i0]], b = e.values[idx[i1]];
    if (a == null && b == null) return null;
    if (a == null) return f > 0.5 ? b : null;
    if (b == null) return a;
    return lerp(a, b, f);
  }

  CHART_DRAW.barrace = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, o = st.o, idx = st.view.idx;
    const N = Math.min(o.topN || 10, ds.entities.length);
    const tau = st.q * (idx.length - 1);
    const i0 = Math.floor(tau), i1 = Math.min(idx.length - 1, i0 + 1), f = ease.inOut(tau - i0);
    const rankAt = i => { const m = new Map(); ds.entities.filter(PS.rankable(o)).filter(e => e.values[idx[i]] != null).sort((a, b) => b.values[idx[i]] - a.values[idx[i]]).forEach((e, r) => m.set(e.id, r)); return m; };
    const r0 = rankAt(i0), r1 = rankAt(i1);
    const rows = ds.entities.filter(PS.rankable(o)).map((e, ei) => {
      const ra = r0.get(e.id) ?? N + 1, rb = r1.get(e.id) ?? N + 1;
      return { e, ei, v: valAt(e, idx, tau), rank: lerp(ra, rb, f) };
    }).filter(r => r.v != null && r.rank < N);
    const max = d3.max(rows, r => r.v) || 1;
    const dateTxt = PS.fmtDate(ds._tms[idx[Math.round(tau)]], ds.frequency);
    const labelW = Math.min(C.w * 0.3, 300 * S);
    const left = C.x + labelW + 16 * S, right = C.x + C.w - 130 * S;
    const top = C.y + 46 * S, bottom = C.y + C.h - 6 * S;
    const rowH = (bottom - top) / N, bh = rowH * 0.74;
    const x = d3.scaleLinear().domain([0, max * 1.02]).range([left, right]);
    // moving grid
    ctx.font = font(st, 400, 21 * S * st.ts); ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
    x.ticks(4).forEach(t => {
      if (t === 0) return;
      ctx.strokeStyle = T.grid; ctx.lineWidth = 1.5 * S;
      ctx.beginPath(); ctx.moveTo(x(t), top - 6 * S); ctx.lineTo(x(t), bottom); ctx.stroke();
      ctx.fillStyle = T.faint; ctx.fillText(fmt(t, ds.unit, { short: true, decimals: 0 }), x(t), top - 10 * S);
    });
    ctx.strokeStyle = T.axis; ctx.lineWidth = 2.5 * S; ctx.beginPath(); ctx.moveTo(left, top - 6 * S); ctx.lineTo(left, bottom); ctx.stroke();
    // date watermark
    bigDate(ctx, st, dateTxt, right + 110 * S, bottom - Math.min(C.h * 0.22, 190 * S) * st.ts, Math.min(C.h * 0.2, 170 * S) * st.ts, 'right');
    rows.sort((a, b) => b.rank - a.rank);
    for (const r of rows) {
      const yy = top + r.rank * rowH + (rowH - bh) / 2;
      const fade = clamp(N - r.rank, 0, 1);
      ctx.globalAlpha = st.aChart * fade;
      const hl = o.highlight && r.e.id === o.highlight;
      ctx.fillStyle = o.highlight ? (hl ? st.accent : rgba(st.pal[0], 0.28)) : colorFor(st, r.e.id);
      roundRect(ctx, left, yy, Math.max(2 * S, x(r.v) - left), bh, st.r); ctx.fill();
      ctx.fillStyle = T.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.font = font(st, 600, Math.min(26 * S, bh * 0.5) * st.ts);
      const nm = PS.fit(ctx, r.e.name, labelW);
      ctx.fillText(nm, left - 14 * S, yy + bh / 2);
      ctx.textAlign = 'left'; ctx.fillStyle = T.muted; ctx.font = font(st, 500, Math.min(24 * S, bh * 0.46) * st.ts);
      ctx.fillText(fmt(r.v, ds.unit, { short: true }), x(r.v) + 12 * S, yy + bh / 2);
    }
    ctx.globalAlpha = st.aChart;
  };

  CHART_DRAW.bars = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, o = st.o, li = st.view.idx.at(-1);
    let rows = ds.entities.filter(PS.rankable(o)).filter(e => e.values[li] != null).map(e => ({ e, v: e.values[li] }));
    rows.sort((a, b) => (o.sortAsc ? a.v - b.v : b.v - a.v));
    const total = rows.length;
    const N = Math.min(o.topN || 10, total);
    rows = rows.slice(0, N);
    ctx.fillStyle = T.muted; ctx.font = font(st, 600, 24 * S * st.ts); ctx.textBaseline = 'top';
    ctx.fillText(`${ds.singleTime ? '' : PS.fmtDate(ds._tms[li], ds.frequency, true) + ' · '}${o.sortAsc ? 'Lowest' : 'Top'} ${N}${total > N ? ' of ' + total : ''}`, C.x, C.y);
    const labelW = Math.min(C.w * 0.32, 300 * S);
    const left = C.x + labelW + 16 * S, right = C.x + C.w - 130 * S, top = C.y + 46 * S, bottom = C.y + C.h;
    const rowH = (bottom - top) / N, bh = Math.min(rowH * 0.72, 90 * S);
    const max = d3.max(rows, r => r.v);
    const x = d3.scaleLinear().domain([0, max]).range([left, right]);
    ctx.strokeStyle = T.axis; ctx.lineWidth = 2.5 * S; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.stroke();
    rows.forEach((r, i) => {
      const a = st.statik ? 1 : ease.out(seg(st.q, i / N * 0.6, i / N * 0.6 + 0.4));
      const yy = top + i * rowH + (rowH - bh) / 2;
      const hl = o.highlight && r.e.id === o.highlight;
      ctx.fillStyle = o.highlight ? (hl ? st.accent : rgba(st.pal[0], 0.3)) : st.pal[0];
      roundRect(ctx, left, yy, Math.max(2 * S, (x(r.v) - left) * a), bh, st.r); ctx.fill();
      ctx.fillStyle = T.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.font = font(st, hl ? 800 : 600, Math.min(26 * S, bh * 0.5) * st.ts);
      const nm = PS.fit(ctx, r.e.name, labelW);
      ctx.fillText(nm, left - 14 * S, yy + bh / 2);
      ctx.textAlign = 'left'; ctx.fillStyle = T.muted; ctx.font = font(st, 500, Math.min(24 * S, bh * 0.46) * st.ts);
      ctx.globalAlpha = st.aChart * a; ctx.fillText(fmt(r.v * (st.statik ? 1 : 1), ds.unit, { short: true }), left + (x(r.v) - left) * a + 12 * S, yy + bh / 2);
      ctx.globalAlpha = st.aChart;
    });
  };

  CHART_DRAW.choropleth = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, o = st.o, idx = st.view.idx;
    const G = geo(ds.geo, ds.geo === 'us-counties' ? o.scope : null);
    const tau = st.q * (idx.length - 1);
    const vals = new Map(ds.entities.map(e => [String(e.id), valAt(e, idx, tau)]));
    // fixed color domain across every frame (2nd-98th percentile), so a color means one value throughout
    const allv = idx.flatMap(i => ds.entities.map(e => e.values[i])).filter(v => v != null).sort((a, b) => a - b);
    let lo = o.colorZero ? 0 : allv[Math.floor(allv.length * 0.02)], hi = allv[Math.floor(allv.length * 0.98)];
    const diverging = ds.zeroLine && lo < 0 && hi > 0;
    if (diverging) { const m = Math.max(-lo, hi); lo = -m; hi = m; }
    const norm = v => (v - lo) / (hi - lo || 1);
    const colorOf = v => (diverging ? st.div(v / hi) : st.ramp(norm(v)));
    const land = C.w > C.h * 1.6;
    const sideW = land ? C.w * 0.27 : 0;
    const legendH = 74 * S, listH = land ? 0 : Math.min(230 * S, C.h * 0.26);
    const mapBox = { x: C.x, y: C.y + 70 * S, w: C.w - sideW - (land ? 30 * S : 0), h: C.h - 70 * S - legendH - listH };
    const k = Math.min(mapBox.w / G.w, mapBox.h / G.h);
    const ox = mapBox.x + (mapBox.w - G.w * k) / 2, oy = mapBox.y + (mapBox.h - G.h * k) / 2;
    const dateTxt = PS.fmtDate(ds._tms[idx[Math.round(tau)]], ds.frequency === 'weekly' ? 'monthly' : ds.frequency, true);
    ctx.font = font(st, 800, 58 * S * st.ts, st.head); ctx.fillStyle = T.ink; ctx.textBaseline = 'top';
    if (!ds.singleTime) ctx.fillText(dateTxt, C.x, C.y);
    ctx.save();
    ctx.translate(ox - (G.x0 || 0) * k, oy - (G.y0 || 0) * k); ctx.scale(k, k);
    for (const f of G.features) {
      const v = vals.get(f.id);
      ctx.fillStyle = v == null ? (st.dark ? '#2b2f36' : '#e9e7e1') : colorOf(v);
      ctx.fill(f.p);
    }
    ctx.strokeStyle = T.bg; ctx.lineJoin = 'round';
    ctx.lineWidth = (ds.geo === 'world' ? 0.9 : ds.geo === 'us-counties' ? (o.scope ? 0.9 : 0.25) : 1.3) * S / k;
    for (const f of G.features) ctx.stroke(f.p);
    if (G.borders) {
      // State lines over county fills (national view) or the state's outline (zoomed view).
      ctx.strokeStyle = G.outline ? T.axis : T.bg; ctx.lineWidth = (G.outline ? 2 : 1.6) * S / k;
      ctx.stroke(G.borders);
    }
    if (o.highlight) { const f = G.features.find(f => f.id === o.highlight); if (f) { ctx.strokeStyle = T.ink; ctx.lineWidth = 3.5 * S / k; ctx.stroke(f.p); } }
    ctx.restore();
    // legend
    const lgY = mapBox.y + mapBox.h + 18 * S, lgW = Math.min(mapBox.w * 0.7, 640 * S), lgX = C.x;
    const g = ctx.createLinearGradient(lgX, 0, lgX + lgW, 0);
    for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, diverging ? st.div(i / 5 - 1) : st.ramp(i / 10));
    ctx.fillStyle = g; roundRect(ctx, lgX, lgY, lgW, 18 * S, Math.min(st.r, 9 * S)); ctx.fill();
    ctx.font = font(st, 400, 21 * S * st.ts); ctx.fillStyle = T.faint; ctx.textBaseline = 'top';
    const lts = lgW < 420 * S ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    lts.forEach((t, i) => {
      const last = i === lts.length - 1;
      ctx.textAlign = i === 0 ? 'left' : last ? 'right' : 'center';
      ctx.fillText((i === 0 && lo > allv[0] ? '≤' : last && hi < allv.at(-1) ? '≥' : '') + fmt(lo + (hi - lo) * t, ds.unit, { short: true }), lgX + lgW * t, lgY + 26 * S);
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = st.dark ? '#2b2f36' : '#e9e7e1'; roundRect(ctx, lgX + lgW + 30 * S, lgY, 18 * S, 18 * S, 3 * S); ctx.fill();
    ctx.fillStyle = T.faint; ctx.fillText('No data', lgX + lgW + 56 * S, lgY - 2 * S);
    // ranked lists
    const ranked = ds.entities.filter(PS.rankable(o)).map(e => ({ e, v: vals.get(String(e.id)) })).filter(r => r.v != null).sort((a, b) => b.v - a.v);
    const n = land ? 5 : 3;
    const lists = [[ds.election ? 'Most Democratic' : 'Highest', ranked.slice(0, n)], [ds.election ? 'Most Republican' : 'Lowest', ranked.slice(-n).reverse()]];
    const drawList = (title, items, x, y, w) => {
      ctx.font = font(st, 700, 22 * S * st.ts); ctx.fillStyle = T.muted; spaced(ctx, 1.5 * S); ctx.fillText(title.toUpperCase(), x, y); spaced(ctx, 0);
      y += 36 * S;
      items.forEach(r => {
        ctx.fillStyle = colorOf(r.v); roundRect(ctx, x, y + 4 * S, 18 * S, 18 * S, 4 * S); ctx.fill();
        ctx.font = font(st, 500, 24 * S * st.ts); ctx.fillStyle = T.ink; ctx.textAlign = 'left';
        // Tight on space: "Madison County" -> "Madison" before truncating with an ellipsis.
        const valTxt = fmt(r.v, ds.unit, { short: true });
        ctx.font = font(st, 700, 24 * S * st.ts); const valW = ctx.measureText(valTxt).width;
        ctx.font = font(st, 500, 24 * S * st.ts);
        const room = w - 30 * S - valW - 14 * S, full = r.e.name;
        const nm = ctx.measureText(full).width <= room ? full : PS.fit(ctx, full.replace(/ (County|Parish|Borough|Census Area|Municipality|city)(?=,|$)/, ''), room);
        ctx.fillText(nm, x + 30 * S, y);
        ctx.textAlign = 'right'; ctx.font = font(st, 700, 24 * S * st.ts); ctx.fillText(fmt(r.v, ds.unit, { short: true }), x + w, y);
        ctx.textAlign = 'left'; y += 38 * S;
      });
      return y;
    };
    if (land) {
      let yy = mapBox.y + 10 * S;
      lists.forEach(([t, it]) => { yy = drawList(t, it, C.x + C.w - sideW, yy, sideW) + 24 * S; });
    } else {
      const ly = lgY + 74 * S, half = (C.w - 40 * S) / 2;
      drawList(lists[0][0], lists[0][1], C.x, ly, half);
      drawList(lists[1][0], lists[1][1], C.x + half + 40 * S, ly, half);
    }
  };


  // Different units on one timeline: one panel per measure, each with its own scale,
  // sharing the x-axis and the moving "now" line. Never two y-axes on one plot.
  CHART_DRAW.stacked = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, series = st.view.series;
    const all = series.flatMap(s => s.pts);
    const t0 = d3.min(all, p => p.t), t1 = d3.max(all, p => p.t), tq = t0 + (t1 - t0) * st.q;
    const n = series.length, gap = 26 * S, xAxisH = 40 * S, headH = 40 * S;
    const ph = (C.h - xAxisH - gap * (n - 1)) / n;
    ctx.font = font(st, 400, 21 * S * st.ts);
    const scales = series.map(s => {
      const lo = d3.min(s.pts, p => p.v), hi = d3.max(s.pts, p => p.v), pad = (hi - lo) * 0.08 || 1;
      return d3.scaleLinear().domain([s.unit.format === 'pct' || lo >= 0 ? Math.min(0, lo) : lo - pad, hi + pad]).nice(3);
    });
    const tfs = series.map(s => v => fmt(v, s.unit, { short: true, decimals: s.unit.format === 'pct' && Math.abs(v) >= 10 ? 0 : undefined }));
    const left = C.x + Math.max(...scales.map((y, i) => Math.max(...y.ticks(3).map(t => ctx.measureText(tfs[i](t)).width)))) + 18 * S;
    const right = C.x + C.w - 8 * S;
    const x = d3.scaleUtc().domain([t0, t1]).range([left, right]);
    series.forEach((s, i) => {
      const top = C.y + i * (ph + gap), color = st.pal[i % st.pal.length];
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = color; roundRect(ctx, C.x, top + 6 * S, 26 * S, 12 * S, 6 * S); ctx.fill();
      ctx.font = font(st, 700, 24 * S * st.ts); ctx.fillStyle = T.ink; ctx.fillText(s.name, C.x + 36 * S, top);
      ctx.font = font(st, 400, 20 * S * st.ts); ctx.fillStyle = T.muted;
      const nw = ctx.measureText(s.name).width;
      ctx.font = font(st, 700, 24 * S * st.ts); const nw2 = ctx.measureText(s.name).width; ctx.font = font(st, 400, 20 * S * st.ts);
      ctx.fillText(s.unit.label, C.x + 36 * S + nw2 + 14 * S, top + 4 * S);
      const y = scales[i].range([top + ph, top + headH]);
      gridY(ctx, st, y.ticks(3), y, left, right, tfs[i]);
      const pts = s.pts.filter(p => p.t <= tq);
      if (pts.length) {
        const v = (() => { for (let k = 1; k < s.pts.length; k++) if (s.pts[k].t >= tq) { const a = s.pts[k - 1], b = s.pts[k]; return lerp(a.v, b.v, (tq - a.t) / (b.t - a.t || 1)); } return s.pts.at(-1).v; })();
        const path = new Path2D(); pts.forEach((p, k) => (k ? path.lineTo(x(p.t), y(p.v)) : path.moveTo(x(p.t), y(p.v)))); path.lineTo(x(tq), y(v));
        ctx.strokeStyle = color; ctx.lineWidth = st.lw * 0.85; ctx.lineJoin = 'round'; ctx.stroke(path);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(tq), y(v), st.lw * 1.3, 0, Math.PI * 2); ctx.fill();
        pill(ctx, st, fmt(v, s.unit), x(tq), y(v) - 34 * S, { align: x(tq) > right - 150 * S ? 'right' : 'center', minX: left, maxX: right + 4 * S, size: 22 });
      }
    });
    // shared "now" line and one x-axis
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1.5 * S; ctx.setLineDash([4 * S, 6 * S]);
    ctx.beginPath(); ctx.moveTo(x(tq), C.y + headH); ctx.lineTo(x(tq), C.y + C.h - xAxisH); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = T.faint; ctx.font = font(st, 400, 21 * S * st.ts); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const yrs = (t1 - t0) / 31536e6;
    x.ticks(Math.max(2, Math.floor((right - left) / (170 * S)))).forEach(t => ctx.fillText(yrs > 3 ? t.getUTCFullYear() : PS.fmtDate(t, 'monthly'), x(t), C.y + C.h - xAxisH + 10 * S));
    ctx.textAlign = 'left';
  };

  // Two place-level measures: one dot per place, animated through the years they share.
  CHART_DRAW.scatter = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, o = st.o;
    const rank = PS.rankable(o);
    const pts = ds.points.filter(rank);
    const n = ds.years.length, tau = st.q * (n - 1), i0 = Math.floor(tau), i1 = Math.min(n - 1, i0 + 1), f = ease.inOut(tau - i0);
    const at = (arr) => { const a = arr[i0], b = arr[i1]; return a == null ? (f > 0.5 ? b : null) : b == null ? a : lerp(a, b, f); };
    const allX = pts.flatMap(p => p.xs).filter(v => v != null), allY = pts.flatMap(p => p.ys).filter(v => v != null);
    const q = (a, p) => { const b = [...a].sort((u, v) => u - v); return b[Math.min(b.length - 1, Math.max(0, Math.floor(b.length * p)))]; };
    // Axis ranges are fixed across years (2nd-98th percentile + padding) so dots move, not axes.
    const xd = [q(allX, 0.01), q(allX, 0.99)], yd = [q(allY, 0.01), q(allY, 0.99)];
    const padX = (xd[1] - xd[0]) * 0.06, padY = (yd[1] - yd[0]) * 0.08;
    const tfx = v => fmt(v, ds.x.unit, { short: true }), tfy = v => fmt(v, ds.y.unit, { short: true });
    const mkScale = (log, d, pad) => (log ? d3.scaleLog().domain([d[0] / 1.4, d[1] * 1.4]).nice() : d3.scaleLinear().domain([d[0] - pad, d[1] + pad]).nice(5));
    const logTicks = sc => sc.ticks().filter(t => Math.abs(Math.log10(t) - Math.round(Math.log10(t))) < 1e-9);
    const yScale = mkScale(ds.logY, yd, padY);
    const yTicks = ds.logY ? logTicks(yScale) : yScale.ticks(5);
    ctx.font = font(st, 400, 21 * S * st.ts);
    const left = C.x + Math.max(...yTicks.map(t => ctx.measureText(tfy(t)).width)) + 18 * S;
    const right = C.x + C.w - 10 * S, top = C.y + 56 * S, bottom = C.y + C.h - 76 * S;
    yScale.range([bottom, top]);
    const xScale = mkScale(ds.logX, xd, padX).range([left, right]);
    gridY(ctx, st, yTicks, yScale, left, right, tfy);
    ctx.fillStyle = T.faint; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    (ds.logX ? logTicks(xScale) : xScale.ticks(Math.max(3, Math.floor((right - left) / (150 * S))))).forEach(t => {
      ctx.strokeStyle = T.grid; ctx.lineWidth = 1.5 * S; if (o.grid !== 'none') { ctx.beginPath(); ctx.moveTo(xScale(t), top); ctx.lineTo(xScale(t), bottom); ctx.stroke(); }
      ctx.fillText(tfx(t), xScale(t), bottom + 10 * S);
    });
    // axis titles (text ink, not series color)
    ctx.font = font(st, 600, 22 * S * st.ts); ctx.fillStyle = T.muted;
    ctx.fillText(`${ds.x.title}${ds.logX ? ' (log scale)' : ''} →`, (left + right) / 2, bottom + 42 * S);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`↑ ${ds.y.title}${ds.logY ? ' (log scale)' : ''}`, C.x, C.y + 16 * S);
    const year = ds.years[Math.round(tau)];
    if (n > 1) bigDate(ctx, st, String(year), right - 10 * S, bottom - 120 * S * st.ts, 110 * S * st.ts, 'right');
    const cur = pts.map(p => ({ p, x: at(p.xs), y: at(p.ys) })).filter(d => d.x != null && d.y != null && (!ds.logX || d.x > 0) && (!ds.logY || d.y > 0));
    // trend line + r, fitted on the scale being shown
    const fx = v => (ds.logX ? Math.log10(v) : v), fy = v => (ds.logY ? Math.log10(v) : v), uy = v => (ds.logY ? 10 ** v : v);
    const r = PS.pearson(cur.map(d => fx(d.x)), cur.map(d => fy(d.y)));
    if (r != null && cur.length > 5) {
      const mx = d3.mean(cur, d => fx(d.x)), my = d3.mean(cur, d => fy(d.y));
      const slope = d3.sum(cur, d => (fx(d.x) - mx) * (fy(d.y) - my)) / d3.sum(cur, d => (fx(d.x) - mx) ** 2);
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      ctx.strokeStyle = T.ink; ctx.globalAlpha *= 0.55; ctx.lineWidth = 2.5 * S; ctx.setLineDash([10 * S, 7 * S]);
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) { const xv = ds.logX ? 10 ** (Math.log10(xScale.domain()[0]) + (Math.log10(xScale.domain()[1]) - Math.log10(xScale.domain()[0])) * k / 40) : xScale.domain()[0] + (xScale.domain()[1] - xScale.domain()[0]) * k / 40; const Y = yScale(uy(my + slope * (fx(xv) - mx))); k ? ctx.lineTo(xScale(xv), Y) : ctx.moveTo(xScale(xv), Y); }
      ctx.stroke(); ctx.restore();
      pill(ctx, st, `r = ${r.toFixed(2)}`, left + 12 * S, top + 16 * S, { align: 'left', size: 22, bg: T.card, fg: T.ink });
    }
    const dotR = (ds.geo === 'us-counties' ? 3.2 : 7.5) * S;
    for (const d of cur) {
      const hl = o.highlight && d.p.id === o.highlight;
      if (hl) continue;
      ctx.fillStyle = rgba(st.pal[0], o.highlight ? 0.35 : 0.7);
      ctx.beginPath(); ctx.arc(clamp(xScale(d.x), left, right), clamp(yScale(d.y), top, bottom), dotR, 0, Math.PI * 2); ctx.fill();
    }
    // labels: highlighted place always; biggest outliers once the animation settles
    const labels = [];
    const h = o.highlight && cur.find(d => d.p.id === o.highlight);
    if (h) labels.push({ d: h, hl: true });
    if ((st.statik || st.q > 0.92) && r != null && cur.length > 5) {
      const mx = d3.mean(cur, d => fx(d.x)), my = d3.mean(cur, d => fy(d.y));
      const slope = d3.sum(cur, d => (fx(d.x) - mx) * (fy(d.y) - my)) / d3.sum(cur, d => (fx(d.x) - mx) ** 2);
      cur.map(d => ({ d, e: Math.abs(fy(d.y) - (my + slope * (fx(d.x) - mx))) })).sort((a, b) => b.e - a.e).slice(0, ds.geo === 'us-counties' ? 3 : 5)
        .forEach(x => { if (!labels.some(l => l.d === x.d)) labels.push({ d: x.d }); });
    }
    ctx.font = font(st, 600, 21 * S * st.ts); ctx.textBaseline = 'middle';
    const placed = [];
    const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const { d, hl } of labels) {
      const X = clamp(xScale(d.x), left, right), Y = clamp(yScale(d.y), top, bottom);
      if (hl) { ctx.fillStyle = st.accent; ctx.beginPath(); ctx.arc(X, Y, dotR * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = T.bg; ctx.lineWidth = 2 * S; ctx.stroke(); }
      const w = ctx.measureText(d.p.name).width;
      // Try right, left, above, below; skip a non-highlighted label that would overlap another.
      const spots = [[X + 12 * S, Y], [X - w - 14 * S, Y], [X - w / 2, Y - 24 * S], [X - w / 2, Y + 24 * S]].filter(([lx]) => lx >= left - 4 && lx + w <= right + 4);
      const spot = spots.find(([lx, ly]) => !placed.some(b => hits({ x: lx - 4 * S, y: ly - 13 * S, w: w + 8 * S, h: 26 * S }, b)));
      if (!spot && !hl) continue;
      const [lx, ly0] = spot || spots[0] || [X + 12 * S, Y];
      placed.push({ x: lx - 4 * S, y: ly0 - 13 * S, w: w + 8 * S, h: 26 * S });
      const lyy = ly0;
      ctx.fillStyle = T.bg; ctx.globalAlpha *= 0.8; ctx.fillRect(lx - 3 * S, lyy - 13 * S, w + 6 * S, 26 * S); ctx.globalAlpha = st.aChart;
      ctx.fillStyle = T.ink; ctx.fillText(d.p.name, lx, lyy);
    }
  };

  CHART_DRAW.bubblemap = function (ctx, C, st) {
    const S = st.S, T = st.T, ds = st.ds, ev = st.view.events;
    const G = geo('world');
    const legendH = 70 * S;
    const tall = C.h > C.w * 0.7;
    const listH = tall ? Math.min(C.h * 0.36, 300 * S) : 0;
    const box = { x: C.x, y: C.y + 70 * S, w: C.w, h: C.h - 70 * S - legendH - listH };
    const k = Math.min(box.w / G.w, box.h / G.h);
    const ox = box.x + (box.w - G.w * k) / 2, oy = box.y + (box.h - G.h * k) / 2 - (G.y0 || 0) * k;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
    ctx.fillStyle = st.dark ? '#22262d' : '#e7e4dc';
    for (const f of G.features) ctx.fill(f.p);
    ctx.restore();
    if (!ev.length) return;
    const t0 = ev[0].tm, t1 = ev.at(-1).tm, tq = t0 + (t1 - t0) * st.q, span = t1 - t0 || 1;
    const rOf = m => S * (2.6 + Math.pow(2.05, m - 2.5)) * 0.9;
    let count = 0, big = null;
    for (const e of ev) {
      if (e.tm > tq) break;
      count++;
      if (!big || e.value > big.value) big = e;
      const [px, py] = G.proj([e.lon, e.lat]);
      const X = ox + px * k, Y = oy + py * k;
      const age = (tq - e.tm) / span;
      const c = st.ramp(clamp((e.value - 2.5) / 4.5, 0.15, 1));
      ctx.fillStyle = rgba(d3.color(c).formatHex(), e.value >= 5 ? 0.75 : 0.5);
      ctx.beginPath(); ctx.arc(X, Y, rOf(e.value), 0, Math.PI * 2); ctx.fill();
      if (!st.statik && age < 0.04 && e.value >= 4) {
        const a = 1 - age / 0.04;
        ctx.strokeStyle = rgba(d3.color(c).formatHex(), a * 0.9); ctx.lineWidth = 3 * S;
        ctx.beginPath(); ctx.arc(X, Y, rOf(e.value) + (1 - a) * 40 * S, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // counter + date
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.font = font(st, 800, 52 * S * st.ts, st.head); ctx.fillStyle = T.ink;
    ctx.fillText(`${count.toLocaleString()} earthquakes`, C.x, C.y);
    ctx.font = font(st, 500, 24 * S * st.ts); ctx.fillStyle = T.muted; ctx.textAlign = 'right';
    ctx.fillText(PS.fmtDate(tq, 'daily', true), C.x + C.w, C.y + 18 * S); ctx.textAlign = 'left';
    // largest so far
    if (big && st.q > 0.15) {
      const [px, py] = G.proj([big.lon, big.lat]);
      const X = ox + px * k, Y = oy + py * k;
      ctx.strokeStyle = T.ink; ctx.lineWidth = 2.5 * S; ctx.beginPath(); ctx.arc(X, Y, rOf(big.value) + 6 * S, 0, Math.PI * 2); ctx.stroke();
      const txt = `M${big.value.toFixed(1)} · ${big.label.replace(/^\d+ ?km [NSEW]{1,3} of /, '')}`;
      pill(ctx, st, txt, X, Y - rOf(big.value) - 34 * S, { align: 'center', minX: C.x, maxX: C.x + C.w, size: 22 });
    }
    if (tall) {
      const shown = ev.filter(e => e.tm <= tq).sort((a, b) => b.value - a.value).slice(0, 5);
      let yy = C.y + C.h - listH + 10 * S;
      ctx.font = font(st, 700, 22 * S * st.ts); ctx.fillStyle = T.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      spaced(ctx, 1.5 * S); ctx.fillText('STRONGEST SO FAR', C.x, yy); spaced(ctx, 0); yy += 40 * S;
      shown.forEach(e => {
        ctx.font = font(st, 800, 26 * S * st.ts); ctx.fillStyle = T.ink; ctx.fillText('M' + e.value.toFixed(1), C.x, yy);
        ctx.font = font(st, 500, 24 * S * st.ts); ctx.fillStyle = T.muted;
        const nm = PS.fit(ctx, e.label || '', C.w - 110 * S);
        ctx.fillText(nm, C.x + 90 * S, yy + 2 * S); yy += 40 * S;
      });
    }
    // size legend
    const ly = box.y + box.h + legendH / 2;
    ctx.font = font(st, 500, 22 * S * st.ts); ctx.textBaseline = 'middle';
    let lx = C.x;
    ctx.fillStyle = T.muted; ctx.fillText('Magnitude', lx, ly); lx += ctx.measureText('Magnitude').width + 24 * S;
    [3, 5, 7].forEach(m => {
      const r = rOf(m), c = st.ramp(clamp((m - 2.5) / 4.5, 0.15, 1));
      ctx.fillStyle = rgba(d3.color(c).formatHex(), 0.7); ctx.beginPath(); ctx.arc(lx + r, ly, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = T.muted; ctx.fillText(String(m), lx + r * 2 + 10 * S, ly); lx += r * 2 + 50 * S;
    });
  };
})(window.PS);
