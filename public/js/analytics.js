// Loads Google Analytics (GA4) using the Measurement ID set in Admin → Settings → SEO & Meta.
// Runs on every public page; does nothing if no ID is configured OR the visitor hasn't
// accepted cookies yet (see the cookie consent banner in main.js). Exposed as
// window.wmLoadAnalytics so main.js can call it immediately the moment someone clicks
// Accept, without needing a page reload; also self-invokes below to cover the case
// where consent was already given on an earlier visit.
function wmLoadAnalytics() {
  if (localStorage.getItem('wm_cookie_consent') !== 'accepted') return;
  if (window._wmAnalyticsLoaded) return;
  window._wmAnalyticsLoaded = true;
  fetch('/api/settings')
    .then(res => res.json())
    .then(s => {
      if (!s.gaId) return;
      const gtagScript = document.createElement('script');
      gtagScript.async = true;
      gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${s.gaId}`;
      document.head.appendChild(gtagScript);

      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', s.gaId);
    })
    .catch(() => { /* analytics is non-critical — fail silently */ });
}
window.wmLoadAnalytics = wmLoadAnalytics;
wmLoadAnalytics();
