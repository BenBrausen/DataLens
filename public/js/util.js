// Civic Charts shared utilities: formatting, dates, easing, palettes, themes, platforms.
window.PS = window.PS || {};
(function (PS) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    linear: t => t,
    inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: t => 1 - Math.pow(1 - t, 3),
    outBack: t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);

  // ---------- numbers ----------
  function compact(v, decimals = 1) {
    const a = Math.abs(v);
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [n, s] of units) if (a >= n) return trimZeros((v / n).toFixed(decimals)) + s;
    return trimZeros(v.toFixed(a < 10 ? decimals : 0));
  }
  const trimZeros = s => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
  const withCommas = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  // fmt(value, unit, {short}) -> display string
  function fmt(v, unit = {}, opts = {}) {
    if (v == null || !Number.isFinite(v)) return 'n/a';
    const d = opts.decimals ?? unit.decimals ?? 1;
    // Election margins: "D+4.4", "R+1.4", "Even".
    if (unit.format === 'margin') return Math.abs(v) < 0.05 ? 'Even' : `${v > 0 ? 'D' : 'R'}+${withCommas(Math.abs(v), opts.short && Math.abs(v) >= 10 ? 0 : d)}`;
    // Signed units like temperature anomalies: "+1.18°C".
    if (unit.suffix) return (unit.signed && v > 0 ? '+' : v < 0 ? '-' : '') + withCommas(Math.abs(v), d) + unit.suffix;
    switch (unit.format) {
      case 'pct': return withCommas(v, d) + '%';
      case 'usd':
        if (Math.abs(v) >= 1e5 && opts.short) return '$' + compact(v, 1);
        return (v < 0 ? '-$' : '$') + withCommas(Math.abs(v), Math.abs(v) >= 1000 ? 0 : d);
      case 'usdT': return (v < 0 ? '-$' : '$') + withCommas(Math.abs(v), opts.short ? 1 : d) + 'T';
      case 'usdB': return (v < 0 ? '-$' : '$') + compact(Math.abs(v), opts.short ? 1 : 2);
      default:
        if (opts.short && Math.abs(v) >= 1e4) return compact(v, 1);
        return withCommas(v, Math.abs(v) >= 1000 ? 0 : d);
    }
  }
  // Change between two values, phrased for the unit (percentage points for rates).
  function fmtChange(a, b, unit, opts = {}) {
    const diff = b - a;
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    if (unit.format === 'pct') return `${sign}${withCommas(Math.abs(diff), unit.decimals ?? 1)} pts`;
    // A percent change of a rate that can cross zero (migration, growth) means nothing.
    const rel = a !== 0 && !opts.noRel && !(a < 0 || b < 0) ? (diff / Math.abs(a)) * 100 : null;
    // Past +1,000% a multiple reads better: "(247x)" rather than "(+24,507%)".
    const relTxt = rel == null ? '' : rel >= 1000 ? ` (${withCommas(b / a, b / a >= 100 ? 0 : 1)}x)` : ` (${sign}${withCommas(Math.abs(rel), Math.abs(rel) >= 100 ? 0 : 1)}%)`;
    return `${sign}${fmt(Math.abs(diff), { ...unit, signed: false }, { short: true })}${relTxt}`;
  }

  // ---------- dates ----------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const parseDate = s => {
    if (s instanceof Date) return s;
    if (typeof s === 'number') return s > 9999 || s < -9999 ? new Date(s) : new Date(Date.UTC(s, 0, 1));
    s = String(s);
    if (s.length > 10) { const d = new Date(s); if (!isNaN(d)) return d; }
    const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s.trim());
    if (m) return new Date(Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1));
    return new Date(s);
  };
  function fmtDate(d, freq = 'monthly', long = false) {
    d = parseDate(d);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    switch (freq) {
      case 'annual': case 'quadrennial': return String(y);
      case 'fiscal': return `FY${y}`; // U.S. federal fiscal year, labeled by the year it ends
      case 'quarterly': return `Q${Math.floor(m / 3) + 1} ${y}`;
      case 'monthly': return `${(long ? MONTHS_LONG : MONTHS)[m]} ${y}`;
      case 'real-time': return `${MONTHS[m]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
      default: return `${(long ? MONTHS_LONG : MONTHS)[m]} ${d.getUTCDate()}, ${y}`;
    }
  }
  const fmtRetrieved = iso => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };

  // ---------- color ----------
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  const luminance = hex => {
    const c = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  // OKLab for perceptual distance (x100 scale, matches the validator convention)
  function toOklab(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return linToOklab(r, g, b);
  }
  function linToOklab(r, g, b) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  // Machado et al. 2009 CVD simulation matrices (severity 1.0), applied in linear RGB.
  const CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  };
  function simOklab(hex, type) {
    const lin = hexToRgb(hex).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    if (!type) return linToOklab(...lin);
    const M = CVD[type];
    const o = M.map(row => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2], 0, 1));
    return linToOklab(...o);
  }
  const dE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Checks the first n colors of a palette against a background: adjacent-pair
  // separation for normal and color-blind vision, plus contrast against the surface.
  function checkPalette(colors, bg, n = colors.length) {
    const cs = colors.slice(0, n), issues = [];
    let worstCvd = Infinity, worstNormal = Infinity;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const normal = dE(simOklab(cs[i]), simOklab(cs[j]));
      const cvd = Math.min(...['protan', 'deutan', 'tritan'].map(t => dE(simOklab(cs[i], t), simOklab(cs[j], t))));
      worstNormal = Math.min(worstNormal, normal); worstCvd = Math.min(worstCvd, cvd);
      if (normal < 15) issues.push({ level: 'fail', msg: `Colors ${i + 1} and ${j + 1} look nearly identical to everyone.` });
      else if (cvd < 6) issues.push({ level: 'warn', msg: `Colors ${i + 1} and ${j + 1} are hard to tell apart with color blindness. Direct labels are on to compensate.` });
    }
    cs.forEach((c, i) => { if (contrast(c, bg) < 1.6) issues.push({ level: 'warn', msg: `Color ${i + 1} nearly disappears on this background.` }); });
    return { ok: !issues.some(x => x.level === 'fail'), issues, worstCvd, worstNormal };
  }

  // ---------- palettes ----------
  // Categorical orders. "safe" ones were chosen for color-blind separation.
  PS.PALETTES = {
    plainsight: { name: 'Civic Charts', group: 'Tested', colors: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] },
    okabe: { name: 'Color-blind safe', group: 'Tested', colors: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'], dark: ['#56B4E9', '#E69F00', '#009E73', '#CC79A7', '#0072B2', '#D55E00', '#F0E442', '#ffffff'] },
    newsroom: { name: 'Newsroom', group: 'Tested', colors: ['#1d5c96', '#d1603d', '#3f8f6b', '#c9972b', '#7b5ea7', '#8a8a85'], dark: ['#5b9bd5', '#e07a5a', '#5fb08b', '#e0b24a', '#a68bd0', '#b5b5b0'] },
    earth: { name: 'Earth', group: 'Tested', colors: ['#2f6b5e', '#c26a2e', '#7a8b3a', '#a14b3b', '#3f6c8f', '#b08d57'], dark: ['#4fa38f', '#e08a4c', '#a3b55a', '#d0705e', '#6b9cc3', '#d4b27a'] },
    usa: { name: 'Red, White & Blue', group: 'Themes', colors: ['#3c3b6e', '#b22234', '#7d8fc4', '#e07a86', '#1f2a5c', '#8a1c2b'], dark: ['#8fa3e8', '#e8505f', '#c7d2f2', '#f2a7af', '#ffffff', '#b22234'] },
    pride: { name: 'Pride', group: 'Themes', colors: ['#e40303', '#ff8c00', '#ffd500', '#008026', '#004dff', '#750787'], dark: ['#ff4d4d', '#ff9f2e', '#ffe14d', '#22b14c', '#4d84ff', '#b04cd6'] },
    progress: { name: 'Progress Pride', group: 'Themes', colors: ['#e40303', '#ff8c00', '#ffd500', '#008026', '#004dff', '#750787', '#5bcefa', '#f5a9b8', '#784f17'], dark: ['#ff4d4d', '#ff9f2e', '#ffe14d', '#22b14c', '#4d84ff', '#b04cd6', '#5bcefa', '#f5a9b8', '#a8743a'] },
    ocean: { name: 'Ocean', group: 'Themes', colors: ['#03396c', '#0e9aa7', '#f6a35b', '#3d5a80', '#5fc9b7', '#ee6c4d'], dark: ['#4f9ee8', '#2ec4cf', '#f6a35b', '#98c1d9', '#7ee0cf', '#ee6c4d'] },
    sunset: { name: 'Sunset', group: 'Themes', colors: ['#5c2a9d', '#d7385e', '#f67e4b', '#f9c74f', '#2d6187', '#9a4a8b'], dark: ['#a77ff0', '#ff5c85', '#ff9a6b', '#ffd86b', '#5c9cc9', '#d17ac3'] },
    neon: { name: 'Neon', group: 'Themes', colors: ['#0077ff', '#ff1f8f', '#00a86b', '#ff7a00', '#7a3cff', '#c9a400'], dark: ['#00e5ff', '#ff2bd6', '#39ff14', '#ffe600', '#ff6b00', '#a970ff'] },
    mono: { name: 'Monochrome', group: 'Themes', colors: ['#1a1a1a', '#6b6b6b', '#a8a8a8', '#404040', '#8c8c8c', '#c4c4c4'], dark: ['#f5f5f5', '#a8a8a8', '#6b6b6b', '#d4d4d4', '#8c8c8c', '#525252'] },
  };

  // Sequential ramps for maps (one hue light -> dark; viridis is perceptually uniform).
  PS.RAMPS = {
    auto: { name: 'Match palette' },
    blues: { name: 'Blues', stops: ['#e4eefb', '#9ec5f4', '#5598e7', '#256abf', '#0d366b'] },
    oranges: { name: 'Oranges', stops: ['#fdeee4', '#f8c3a2', '#ef8a55', '#c75620', '#7a2d08'] },
    greens: { name: 'Greens', stops: ['#e6f4ea', '#a7dbb4', '#5cb57a', '#237a45', '#0b4024'] },
    purples: { name: 'Purples', stops: ['#efeafb', '#c9bdf0', '#9785e0', '#5f48b8', '#2e1f73'] },
    reds: { name: 'Reds', stops: ['#fde8e8', '#f5aaaa', '#e5605f', '#b02a2a', '#5e0f12'] },
    viridis: { name: 'Viridis', stops: ['#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'] },
    magma: { name: 'Magma', stops: ['#fcfdbf', '#fc8961', '#b73779', '#51127c', '#000004'] },
  };

  // ---------- looks (themes) ----------
  PS.THEMES = {
    newsroom: { name: 'Newsroom', bg: '#ffffff', ink: '#121212', muted: '#5c5b57', faint: '#8b8a85', grid: '#e7e5df', axis: '#bdbab2', card: '#f4f2ec', head: 'Source Serif 4', headWeight: 700, body: 'Inter', mode: 'light' },
    paper: { name: 'Paper', bg: '#f7f3ea', ink: '#1b1a17', muted: '#5e5a50', faint: '#8d887b', grid: '#e4ddcc', axis: '#bcb39d', card: '#ede6d6', head: 'Source Serif 4', headWeight: 600, body: 'Inter', mode: 'light' },
    midnight: { name: 'Midnight', bg: '#0e1116', ink: '#f2f1ec', muted: '#a9a8a0', faint: '#76767a', grid: '#232831', axis: '#3b414c', card: '#171c24', head: 'Inter', headWeight: 800, body: 'Inter', mode: 'dark' },
    civic: { name: 'Civic Navy', bg: '#0b1f3a', ink: '#f4f6fb', muted: '#b4c0d6', faint: '#7f8ea9', grid: '#1b3254', axis: '#33507a', card: '#11294b', head: 'Source Serif 4', headWeight: 700, body: 'Inter', mode: 'dark' },
    bold: { name: 'Bold', bg: '#111111', ink: '#ffffff', muted: '#bdbdbd', faint: '#8a8a8a', grid: '#2a2a2a', axis: '#444444', card: '#1d1d1d', head: 'Archivo', headWeight: 900, body: 'Archivo', mode: 'dark', upper: true },
    clean: { name: 'Clean', bg: '#fbfbfa', ink: '#0b0b0b', muted: '#52514e', faint: '#8a8984', grid: '#ebeae6', axis: '#c8c6c0', card: '#f1f0ec', head: 'Inter', headWeight: 800, body: 'Inter', mode: 'light' },
  };
  PS.FONTS = {
    theme: 'Theme default',
    'Source Serif 4': 'Serif (Source Serif)',
    Inter: 'Sans (Inter)',
    Archivo: 'Heavy (Archivo)',
    'IBM Plex Mono': 'Mono (IBM Plex)',
  };

  // ---------- platforms ----------
  // safe: fraction insets {t,r,b,l} that keep content clear of platform UI overlays.
  // Printed on every export so reposted charts lead back to the source of truth.
  PS.SITE = 'civiccharts.com';
  // Official social accounts, in display order (X deliberately last). A link shows only once its URL is set.
  PS.SOCIAL = [
    ['facebook', 'Facebook', 'https://www.facebook.com/profile.php?id=61596267393158'],
    ['instagram', 'Instagram', 'https://www.instagram.com/civiccharts/'],
    ['threads', 'Threads', 'https://www.threads.com/@civiccharts'],
    ['tiktok', 'TikTok', 'https://www.tiktok.com/@civiccharts'],
    ['youtube', 'YouTube', 'https://www.youtube.com/@civiccharts'],
    ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/civiccharts'],
    ['bluesky', 'Bluesky', 'https://bsky.app/profile/civiccharts.com'],
    ['x', 'X', 'https://x.com/civiccharts'],
  ].filter(s => s[2]).map(([id, name, url]) => ({ id, name, url }));
  PS.CONTACT = { hello: 'hello@civiccharts.com', corrections: 'corrections@civiccharts.com' };

  // Which network's post text each size opens with: the first network in the size's name.
  PS.POST_FOR = { vertical: 'tiktok', reels: 'instagram', feed: 'facebook', square: 'linkedin', landscape: 'youtube', link: 'linkedin', report: 'linkedin', pin: 'facebook' };

  PS.PLATFORMS = {
    // 9:16 safe area is the union of TikTok, Instagram/Facebook Reels and Stories, and
    // YouTube Shorts overlays (organic posts): top tabs and the Stories profile bar,
    // the right-side action buttons, and the caption, username, sound and reply bar.
    // Applies to stills too, since Stories and TikTok photo posts get the same overlays.
    vertical: { name: 'TikTok, YouTube Shorts', ratio: '9:16', w: 1080, h: 1920, dur: 20, uiOverlay: true,
      safe: { t: 0.13, r: 0.14, b: 0.25, l: 0.06 },
      zones: [
        { side: 't', label: 'Tabs, profile and progress bar (Stories)' },
        { side: 'r', label: 'Like, comment, share buttons' },
        { side: 'b', label: 'Caption, username, sound, reply bar' },
      ] },
    // Instagram Reels and Stories, measured from screenshots: the feed crops ~10% off the top
    // and ~11% off the bottom of a Reel and lays the account name over the top (to ~15%);
    // Stories cover the top ~7% and bottom ~11%; the Reels tab, where most Reels are watched,
    // puts name, music and caption over the bottom ~22% (the Reply chip reaches ~27%, so 28%) and the
    // action buttons over the right ~12%. Margins cover every view.
    reels: { name: 'Instagram Reels & Stories, Facebook Reels', ratio: '9:16', w: 1080, h: 1920, dur: 20, uiOverlay: true,
      safe: { t: 0.16, r: 0.12, b: 0.28, l: 0.06 },
      zones: [
        { side: 't', label: 'Account name, feed crop, Stories bar' },
        { side: 'r', label: 'Like, comment, share buttons' },
        { side: 'b', label: 'Name, music, caption (Reels tab)' },
      ] },
    feed: { name: 'Feed: Facebook, LinkedIn, Instagram', ratio: '4:5', w: 1080, h: 1350, dur: 15, safe: { t: 0.05, r: 0.06, b: 0.05, l: 0.06 } },
    square: { name: 'Square: LinkedIn, X, Threads', ratio: '1:1', w: 1080, h: 1080, dur: 15, safe: { t: 0.05, r: 0.05, b: 0.05, l: 0.05 } },
    landscape: { name: 'YouTube, slides, web, broadcast', ratio: '16:9', w: 1920, h: 1080, dur: 30, safe: { t: 0.06, r: 0.05, b: 0.06, l: 0.05 } },
    link: { name: 'Link preview: LinkedIn, Facebook, X', ratio: '1.91:1', w: 1200, h: 628, dur: 15, safe: { t: 0.05, r: 0.04, b: 0.05, l: 0.04 } },
    report: { name: 'Blog, newsletter, report', ratio: '3:2', w: 1800, h: 1200, dur: 15, safe: { t: 0.05, r: 0.05, b: 0.05, l: 0.05 } },
    pin: { name: 'Pinterest', ratio: '2:3', w: 1000, h: 1500, dur: 15, safe: { t: 0.05, r: 0.06, b: 0.08, l: 0.06 } },
  };

  // AP-style Title Case: capitalize words of 4+ letters and all major words; keep short
  // articles, conjunctions and prepositions lowercase unless first or last; leave acronyms
  // and mixed-case tokens (U.S., GDP, CO₂, FY2026, iPhone) exactly as written.
  const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'vs', 'vs.']);
  PS.titleCase = s => {
    const words = String(s).split(/(\s+)/);
    const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter(i => i >= 0), first = idx[0], last = idx.at(-1);
    return words.map((w, i) => {
      if (!/\S/.test(w)) return w;
      return w.split('-').map((part, j) => {
        if (!/^[a-z]/.test(part) || /[A-Z]/.test(part.slice(1))) return part; // acronyms, numbers, mixed case
        const bare = part.toLowerCase().replace(/[^a-z.]/g, '');
        if (SMALL.has(bare) && i !== first && i !== last && j === 0) return part;
        return part[0].toUpperCase() + part.slice(1);
      }).join('-');
    }).join('');
  };

  // ---------- text layout on canvas ----------
  function wrap(ctx, text, maxW, maxLines = 99) {
    const words = String(text).split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      kept[maxLines - 1] = fit(ctx, last + ' ' + lines.slice(maxLines).join(' '), maxW);
      return kept;
    }
    return lines;
  }
  // Truncates text to fit maxW with an ellipsis. Bounded: at most one pass over the string.
  function fit(ctx, text, maxW) {
    text = String(text);
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '\u2026').width <= maxW) lo = mid; else hi = mid - 1; }
    return text.slice(0, Math.max(1, lo)).trimEnd() + '\u2026';
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  Object.assign(PS, { clamp, lerp, ease, seg, fmt, fmtChange, compact, parseDate, fmtDate, fmtRetrieved, MONTHS_LONG,
    hexToRgb, rgba, contrast, checkPalette, wrap, fit, roundRect, esc });
})(window.PS);
