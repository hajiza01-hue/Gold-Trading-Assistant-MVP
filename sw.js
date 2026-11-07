// Service Worker: ใช้งานออฟไลน์ (cache ไฟล์ของเว็บเอง; ไม่แตะคำขอไป Google)
const CACHE = 'gta-v2';
const FILES = ['./', 'index.html', 'css/style.css', 'css/fonts.css', 'fonts/ibm-plex-sans-thai-thai-400-normal.woff2', 'fonts/ibm-plex-sans-thai-thai-500-normal.woff2', 'fonts/ibm-plex-sans-thai-thai-600-normal.woff2', 'fonts/ibm-plex-sans-thai-thai-700-normal.woff2', 'fonts/ibm-plex-sans-thai-latin-400-normal.woff2', 'fonts/ibm-plex-sans-thai-latin-500-normal.woff2', 'fonts/ibm-plex-sans-thai-latin-600-normal.woff2', 'fonts/ibm-plex-sans-thai-latin-700-normal.woff2', 'icon-512.png', 'js/calc.js', 'js/store.js', 'js/chart.js', 'js/sync.js', 'js/exporter.js', 'js/app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first (ได้เวอร์ชันใหม่เสมอเมื่อออนไลน์) แล้วถอยไปใช้ cache เมื่อออฟไลน์
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
