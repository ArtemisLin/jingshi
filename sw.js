// 静时 · 离线缓存。发新版时改 CACHE 的版本号。
const CACHE = 'jingshi-0.3.0';
const FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/logic.js',
  './js/store.js',
  './js/sync.js',
  './js/sense.js',
  './fonts/jost.woff2',
  './icons/logo.svg',
  './icons/icon-180.png',
  './icons/icon-512.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jingshi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 只管自己网站的文件；GitHub 备份的请求直接走网络
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
