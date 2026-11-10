// Renders social header images for Civic Charts: node scripts/headers.cjs <outdir>
// Each size keeps text inside the area every device shows, away from the avatar overlap.
const { chromium } = require('playwright'); const path = require('path');
const SIZES = [
  // name, W, H, safe {x,y,w,h} (always visible), avatar zone to keep text out of
  ['x', 1500, 500, { x: 0, y: 60, w: 1500, h: 380 }, { x: 0, y: 260, w: 420, h: 240 }],
  ['bluesky', 1500, 500, { x: 0, y: 40, w: 1500, h: 420 }, { x: 0, y: 260, w: 420, h: 240 }],
  ['facebook', 1640, 924, { x: 0, y: 150, w: 1640, h: 624 }, { x: 0, y: 640, w: 420, h: 284 }],
  ['linkedin', 1128, 191, { x: 0, y: 0, w: 1128, h: 191 }, { x: 0, y: 95, w: 300, h: 96 }, { textX: 0.25, size: 0.2, oneLine: true, capX: 0.9 }],
  ['youtube', 2560, 1440, { x: 507, y: 508, w: 1546, h: 423 }, null, { size: 0.2 }],
];
// Decorative skyline: smooth, clearly not data (no axes, no labels).
function bars(n, seed) {
  let s = seed; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: n }, (_, i) => 0.28 + 0.42 * (0.5 + 0.5 * Math.sin(i * 0.55 + 1.3)) * (0.75 + 0.5 * rnd()));
}
function html(W, H, safe, av, opt = {}) {
  const base = safe.y + safe.h - safe.h * 0.06;           // skyline baseline
  const skyH = safe.h * 0.52, barW = Math.max(14, safe.h * 0.07), gap = barW * 0.45;
  const n = Math.ceil(W / (barW + gap)) + 1, hs = bars(n, 7);
  const capX = safe.x + safe.w * (opt.capX || 0.78);                     // Capitol stands right of center
  let svg = '';
  hs.forEach((h, i) => {
    const x = i * (barW + gap); if (Math.abs(x + barW / 2 - capX) < barW * 3.2) return;
    const bh = skyH * h, op = (0.18 + 0.5 * h).toFixed(2);
    svg += `<rect x="${x}" y="${base - bh}" width="${barW}" height="${bh}" rx="${barW * 0.22}" fill="#2a78d6" opacity="${op}"/>`;
  });
  // Capitol: wide center bar + dome + flag, same mark as the avatar.
  const cw = barW * 4.2, ch = skyH * 1.05, cx = capX - cw / 2, top = base - ch, r = cw * 0.55;
  svg += `<rect x="${cx}" y="${top}" width="${cw}" height="${ch}" rx="${barW * 0.25}" fill="#2a78d6"/>`;
  for (let k = 1; k <= 3; k++) svg += `<rect x="${cx + cw * k / 4 - barW * 0.16}" y="${top + ch * 0.12}" width="${barW * 0.32}" height="${ch * 0.78}" rx="${barW * 0.16}" fill="#f7f5f0"/>`;
  svg += `<rect x="${cx - cw * 0.04}" y="${top - barW * 0.5}" width="${cw * 1.08}" height="${barW * 0.55}" rx="${barW * 0.2}" fill="#1f5fae"/>`;
  svg += `<path d="M${capX - r} ${top - barW * 0.45} A${r} ${r} 0 0 1 ${capX + r} ${top - barW * 0.45} Z" fill="#2a78d6"/>`;
  svg += `<rect x="${capX - barW * 0.12}" y="${top - barW * 0.45 - r - skyH * 0.2}" width="${barW * 0.24}" height="${skyH * 0.2}" rx="${barW * 0.12}" fill="#16181d"/>`;
  svg += `<path d="M${capX + barW * 0.12} ${top - barW * 0.45 - r - skyH * 0.2} h${barW * 1.1} l-${barW * 0.3} ${barW * 0.35} l${barW * 0.3} ${barW * 0.35} h-${barW * 1.1} z" fill="#eb6834"/>`;
  svg += `<rect x="0" y="${base}" width="${W}" height="${Math.max(4, safe.h * 0.018)}" fill="#16181d"/>`;
  // Text block: left part of the safe area, above the skyline, clear of the avatar.
  const tx = safe.x + safe.w * (opt.textX || 0.06);
  const textTop = safe.y + safe.h * (opt.oneLine ? 0.08 : 0.1), textMaxW = opt.oneLine ? 9999 : safe.w * 0.56;
  const hs1 = safe.h * (opt.size || 0.17);
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,800&display=swap" rel="stylesheet">
<style>*{margin:0}body{width:${W}px;height:${H}px;background:#f7f5f0;position:relative;overflow:hidden;font-family:Inter,sans-serif}
.t{white-space:${opt.oneLine ? 'nowrap' : 'normal'};position:absolute;left:${tx}px;top:${textTop}px;max-width:${textMaxW}px}
h1{font-family:"Source Serif 4",serif;font-weight:800;font-size:${hs1}px;line-height:1.05;letter-spacing:-.02em;color:#16181d}
h1 span{color:#2a78d6}.u{margin-top:${hs1 * 0.3}px;font-weight:700;font-size:${hs1 * 0.36}px;color:#2a78d6;letter-spacing:.01em}
svg{position:absolute;inset:0}</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>
<div class="t"><h1>Official public data, <span>made plain.</span></h1><div class="u">civiccharts.com</div></div></body></html>`;
}
(async () => {
  const out = process.argv[2]; const b = await chromium.launch();
  for (const [name, W, H, safe, av, opt] of SIZES) {
    const pg = await b.newPage({ viewport: { width: W, height: H } });
    await pg.setContent(html(W, H, safe, av, opt), { waitUntil: 'networkidle' }); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(out, `header-${name}-${W}x${H}.png`) }); await pg.close();
  }
  await b.close();
})();
