/* 수달중국어 서비스워커
   v2: /api/ 프록시·비-GET(POST)·교차출처 요청은 절대 가로채지 않음 (AI 채팅/예문 정상화)
       + 캐시 버전 상향으로 옛 캐시 강제 정리 */
const CACHE = 'sudal-core-v2';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // 1) 서비스워커가 절대 손대지 않아야 하는 요청 → 그대로 네트워크로 통과
  if (req.method !== 'GET') return;                       // POST 등 (AI 프록시 호출)
  if (url.origin !== self.location.origin) return;        // 구글 API·애드센스 등 교차출처
  if (url.pathname.startsWith('/api/')) return;           // 서버 프록시 경로

  // 2) 페이지 이동: 네트워크 우선, 실패하면 캐시된 index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 3) 그 외 정적 자원: 캐시 우선 + 백그라운드 갱신
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
