// World Mic - Service Worker (PWA)
const CACHE = 'worldmic-v3';
const STATIC = ['/','index.html','/css/main.css','/css/admin.css','/css/ai-floating.css','/js/main.js','/js/admin.js','/js/ai-chat.js','/images/favicon.svg','/images/app-icon.svg','/manifest.json'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return; // Never cache API calls
  // Network-first: always try to get the latest version; fall back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
  );
});
