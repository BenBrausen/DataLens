// Renders "Introducing Civic Charts" announcement cards: node scripts/announce-cards.cjs <outdir>
// One layout, three sizes; padding keeps text inside each platform's always-visible area.
const { chromium } = require('playwright'); const path = require('path');
const SIZES = [
  // name, W, H, padding top/bottom (Stories: header ~7% top, reply bar ~11% bottom), chart height
  ['feed-4x5', 1080, 1350, 90, 90, 330],
  ['story-9x16', 1080, 1920, 230, 280, 470, 1.18],
  ['square-1x1', 1080, 1080, 70, 70, 0],
];
const capitol = h => `<svg width="${h * 1.07}" height="${h}" viewBox="0 0 470 440">
  <g stroke="#e3e0d8" stroke-width="2"><line x1="0" y1="120" x2="470" y2="120"/><line x1="0" y1="220" x2="470" y2="220"/><line x1="0" y1="320" x2="470" y2="320"/></g>
  <rect x="232" y="44" width="6" height="60" rx="3" fill="#16181d"/><path d="M238 46 h30 l-8 9 l8 9 h-30 z" fill="#eb6834"/>
  <path d="M175 160 A60 60 0 0 1 295 160 Z" fill="#2a78d6"/><rect x="196" y="150" width="78" height="14" rx="4" fill="#1f5fae"/>
  <g fill="#2a78d6"><rect x="10" y="300" width="44" height="120" rx="8" opacity=".35"/><rect x="68" y="260" width="44" height="160" rx="8" opacity=".5"/>
  <rect x="126" y="215" width="44" height="205" rx="8" opacity=".7"/><rect x="184" y="170" width="102" height="250" rx="8"/>
  <rect x="300" y="215" width="44" height="205" rx="8" opacity=".7"/><rect x="358" y="260" width="44" height="160" rx="8" opacity=".5"/><rect x="416" y="300" width="44" height="120" rx="8" opacity=".35"/></g>
  <g fill="#f7f5f0" opacity=".9"><rect x="204" y="200" width="10" height="200" rx="5"/><rect x="230" y="200" width="10" height="200" rx="5"/><rect x="256" y="200" width="10" height="200" rx="5"/></g>
  <rect x="0" y="420" width="470" height="6" rx="3" fill="#16181d"/></svg>`;
const check = `<svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="15" fill="#1baf7a"/><path d="M8.5 15.5l4.2 4.2 8.8-9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function html(W, H, pt, pb, chartH, k = 1) {
  const sq = W === H, z = v => Math.round(v * k);
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,800&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}body{width:${W}px;height:${H}px;background:#f7f5f0;font-family:Inter,sans-serif;color:#16181d;position:relative;overflow:hidden}
.stripe{position:absolute;left:0;top:0;bottom:0;width:14px;background:#2a78d6}
.wrap{position:absolute;inset:${pt}px 84px ${pb}px 96px;display:flex;flex-direction:column;justify-content:space-between}
.brand{display:flex;align-items:center;gap:16px;font-weight:700;font-size:${z(38)}px}
.kick{font-weight:700;font-size:${z(24)}px;letter-spacing:.14em;text-transform:uppercase;color:#2a78d6;margin-bottom:14px}
h1{font-family:"Source Serif 4",serif;font-weight:800;font-size:${z(sq ? 92 : 104)}px;line-height:1.0;letter-spacing:-.02em}h1 span{color:#2a78d6}
.chart{display:flex;justify-content:center;position:relative}
.chip{position:absolute;right:${sq ? 0 : 20}px;top:0;background:#fff;border:2px solid #e3e0d8;border-radius:999px;padding:9px 18px 9px 10px;display:flex;gap:10px;align-items:center;font-weight:600;font-size:22px}
ul{list-style:none;display:flex;flex-direction:column;gap:${z(sq ? 16 : 22)}px}li{display:flex;gap:16px;align-items:flex-start;font-size:${z(sq ? 31 : 34)}px;line-height:1.3;font-weight:500}li svg{flex:none;margin-top:5px}
.foot{display:flex;align-items:center;justify-content:space-between}.url{font-weight:700;font-size:${z(40)}px;color:#2a78d6}
.free{background:#16181d;color:#fff;border-radius:999px;padding:14px 26px;font-weight:700;font-size:${z(26)}px}
.sqrow{display:flex;gap:40px;align-items:center}</style></head><body><div class="stripe"></div><div class="wrap">
<div class="brand"><svg viewBox="0 0 32 32" width="52" height="52"><rect x="3" y="17" width="6" height="12" rx="2" fill="#2a78d6"/><rect x="13" y="9" width="6" height="20" rx="2" fill="#2a78d6" opacity=".75"/><rect x="23" y="3" width="6" height="26" rx="2" fill="#2a78d6" opacity=".5"/></svg>Civic Charts</div>
<div><div class="kick">Introducing</div><h1>Official public data, <span>made plain.</span></h1></div>
${chartH ? `<div class="chart">${capitol(chartH)}<div class="chip">${check}Source cited</div></div>` : ''}
<ul>
<li>${check}<span>Turn government data on jobs, prices, debt, housing, health and more into clear charts and maps</span></li>
<li>${check}<span>Animated videos and images sized for TikTok, Reels, LinkedIn and more</span></li>
<li>${check}<span>Every chart cites its source and is checked against the data</span></li>
</ul>
<div class="foot"><div class="url">civiccharts.com</div><div class="free">Free · No signup</div></div>
</div></body></html>`;
}
(async () => {
  const out = process.argv[2]; const b = await chromium.launch();
  for (const [name, W, H, pt, pb, ch, k] of SIZES) {
    const pg = await b.newPage({ viewport: { width: W, height: H } });
    await pg.setContent(html(W, H, pt, pb, ch, k), { waitUntil: 'networkidle' }); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(300);
    const over = await pg.evaluate(() => { const w = document.querySelector('.wrap'); return w.scrollHeight > w.clientHeight + 2; });
    if (over) console.log('WARNING: content overflows', name);
    await pg.screenshot({ path: path.join(out, `civic-charts-${name}.png`) }); await pg.close();
  }
  await b.close();
})();
