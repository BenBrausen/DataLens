// Civic Charts usage analytics (GA4). Off until window.CC_GA_ID is set in index.html.
// Privacy: no Google signals, no ad personalization; visitors in the EEA, UK and
// Switzerland start with analytics storage denied (cookieless pings only).
// Every event goes through PS.track, so this file is the full list of what's measured.
(function (PS) {
  const ID = window.CC_GA_ID;
  // Owner opt-out per browser: visit /?notrack=1 once on each device (?notrack=0 undoes it).
  let optOut = false;
  try {
    const nt = new URLSearchParams(location.search).get('notrack');
    if (nt === '1') localStorage.setItem('cc-notrack', '1'); else if (nt === '0') localStorage.removeItem('cc-notrack');
    optOut = localStorage.getItem('cc-notrack') === '1';
  } catch { }
  const on = !!ID && !optOut && new URLSearchParams(location.search).get('render') !== '1' && !/^(localhost|127\.)/.test(location.hostname) && !navigator.webdriver;
  PS.trackingOff = optOut;
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  PS.ctx = () => ({}); // app.js replaces this with the current dataset, chart and size

  PS.track = (name, params = {}) => {
    if (!on) return;
    const p = { ...PS.ctx(), ...params };
    for (const k in p) { if (p[k] == null || p[k] === '') delete p[k]; else if (typeof p[k] === 'string') p[k] = p[k].slice(0, 100); }
    gtag('event', name, p);
  };
  if (!on) return;

  const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', region: EU });
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
  gtag('js', new Date());

  // How the visit started: an embed on another site, a shared chart link, or the site itself.
  const qs = new URLSearchParams(location.search);
  const entry = qs.get('embed') === '1' ? 'embed' : /#c=/.test(location.hash) ? 'share_link' : 'direct';
  let refHost = ''; try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch { }
  gtag('config', ID, {
    allow_google_signals: false, allow_ad_personalization_signals: false,
    // Share links carry chart settings in the hash; never send them. Keep only the path.
    // Keep the dataset, embed flag and campaign tags (utm_*) so GA4 can attribute traffic by network.
    page_location: (() => { const keep = new URLSearchParams(); for (const [k, v] of qs) if (k === 'd' || k === 'embed' || k.startsWith('utm_')) keep.set(k, v);
      const q = keep.toString(); return location.origin + location.pathname + (q ? '?' + q : ''); })(),
    entry_type: entry, embed_host: entry === 'embed' ? refHost : undefined,
  });
  const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`; document.head.appendChild(s);
})(window.PS);
