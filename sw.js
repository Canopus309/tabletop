// 오프라인 캐시: 한 번 열면 인터넷 없이도 실행됩니다.
const CACHE = 'baduk-ai-v5';
const FILES = ['./', './index.html', './katago.js', './manifest.webmanifest', './icon.svg',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/tf.min.js', './vendor/tf-backend-webgpu.min.js', './vendor/tf-backend-wasm.min.js',
  './vendor/tfjs-backend-wasm.wasm', './vendor/tfjs-backend-wasm-simd.wasm', './vendor/tfjs-backend-wasm-threaded-simd.wasm',
  './models/g170e-b10c128.bin.gz'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 네트워크 우선(최신 버전 반영), 실패하면 캐시
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
