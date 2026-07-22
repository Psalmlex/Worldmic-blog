// Register Service Worker (PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    console.log('World Mic PWA: Service Worker registered');
  }).catch(() => {});
}
