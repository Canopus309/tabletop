// 오프라인 캐시: 한 번 열면 인터넷 없이도 실행됩니다. (Table Top 전체: 홈 + 각 게임)
const CACHE = 'tabletop-v22';
const FILES = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './rules/', './rules/index.html', './ranks/', './ranks/index.html', './records/', './records/index.html',
  './common/base.css', './common/learn.css', './common/learn.js', './common/ui.js', './common/leaderboard.js', './common/rating.js', './common/records.js',
  // 바둑
  './go/', './go/index.html', './go/board.js', './go/katago.js',
  './go/learn/', './go/learn/index.html', './go/learn/problems.js', './go/learn/tsumego.js',
  './go/vendor/tf.min.js', './go/vendor/tf-backend-webgpu.min.js', './go/vendor/tf-backend-wasm.min.js',
  './go/vendor/tfjs-backend-wasm.wasm', './go/vendor/tfjs-backend-wasm-simd.wasm', './go/vendor/tfjs-backend-wasm-threaded-simd.wasm',
  './go/models/g170e-b10c128.bin.gz',
  // 오목
  './omok/', './omok/index.html', './omok/renju.js',
  './omok/learn/', './omok/learn/index.html', './omok/learn/vcf.js', './omok/learn/problems.js',
  // 체스
  './chess/', './chess/index.html', './chess/engine.js', './chess/vendor/chess.js',
  './chess/learn/', './chess/learn/index.html', './chess/learn/problems.js',
  './chess/vendor/stockfish-19-lite-single.js', './chess/vendor/stockfish-19-lite-single.wasm',
  ...['w', 'b'].flatMap(c => ['K', 'Q', 'R', 'B', 'N', 'P'].map(p => `./chess/pieces/${c}${p}.svg`)),
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // 예전 바둑 AI 시절 캐시(baduk-ai-*)도 함께 정리
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
