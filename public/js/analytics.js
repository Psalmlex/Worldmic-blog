// Loads Google Analytics (GA4) using the Measurement ID set in Admin → Settings → SEO & Meta.
// Runs on every public page; does nothing if no ID is configured.
(function () {
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
})();
