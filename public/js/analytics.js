// Civic Charts usage analytics (GA4). Off until window.CC_GA_ID is set in index.html.
// Privacy: no Google signals, no ad personalization; visitors in the EEA, UK and
// Switzerland start with analytics storage denied (cookieless pings only).
// Every event goes through PS.track, so this file is the full list of what's measured.
(function (PS) {
  const ID = window.CC_GA_ID;
  const on = !!ID && !/^(localhost|127\.)/.test(location.hostname) && !navigator.webdriver;
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
    page_location: location.origin + location.pathname + (qs.get('d') ? `?d=${qs.get('d')}` : '') + (entry === 'embed' ? (qs.get('d') ? '&' : '?') + 'embed=1' : ''),
    entry_type: entry, embed_host: entry === 'embed' ? refHost : undefined,
  });
  const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`; document.head.appendChild(s);
})(window.PS);
