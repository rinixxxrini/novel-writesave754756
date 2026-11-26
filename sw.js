// 네트워크 우선, 실패하면 캐시 (오프라인에서도 열림 / 새 배포는 바로 반영)
const CACHE = 'lore-v1';
const CORE = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/util.js', 'js/db.js', 'js/zip.js', 'js/wiki.js', 'js/novel.js', 'js/archive.js', 'js/misc.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.ok && !r.url.includes('version.json')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r).then(m => m || caches.match('index.html'))));
});
