// World Mic - Service Worker (PWA)
const CACHE = 'worldmic-v1';
const STATIC = ['/','index.html','/css/main.css','/css/admin.css','/css/ai-floating.css','/js/main.js','/js/admin.js','/js/ai-chat.js','/images/favicon.svg','/images/app-icon.svg','/manifest.json'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return; // Never cache API calls
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html'))));
});
