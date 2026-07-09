// 수달 중국어 — Render.com 서버 (사이트 + Gemini 프록시 한 곳에서)
// -----------------------------------------------------------------
// 하는 일:
//  1) index.html 등 정적 파일을 그대로 서빙 (사이트 자체)
//  2) /api/gemini 로 들어온 요청을 Gemini API로 대신 전달 (키는 서버에만)
//
// 키는 Render의 Environment 변수 GEMINI_API_KEY 에서 읽습니다.
// 브라우저에는 키가 절대 내려가지 않습니다.
//
// 필요한 것: Node 18 이상 (Render 기본 제공, fetch 내장)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  // ── 1) Gemini 프록시 ──────────────────────────────
  if (req.url === '/api/gemini') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
    if (!API_KEY) return sendJson(res, 500, { error: 'server key missing (Render 환경변수 GEMINI_API_KEY 를 등록하세요)' });

    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }

      const model = (payload && payload.model) || 'gemini-2.0-flash-lite';
      const body = (payload && payload.body) || payload;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

      try {
        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      } catch (e) {
        sendJson(res, 502, { error: 'upstream fetch failed' });
      }
    });
    return;
  }

  // ── 2) 정적 파일 서빙 ─────────────────────────────
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // 디렉터리 탈출 방지
  const safePath = path.normalize(path.join(__dirname, urlPath));
  if (!safePath.startsWith(__dirname)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      // 파일이 없으면 index.html 로 폴백 (단일 페이지)
      fs.readFile(path.join(__dirname, 'index.html'), (e2, home) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(home);
      });
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('수달 중국어 서버 실행 중 · 포트 ' + PORT + ' · 키 ' + (API_KEY ? '설정됨' : '없음(GEMINI_API_KEY 필요)'));
});
