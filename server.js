// 수달중국어 - 정적 파일 서버 + Gemini 프록시 (Node 내장 모듈만, 의존성 0)
// Render "Web Service"로 배포하고, 환경변수 GEMINI_API_KEY 에 본인 키를 넣으세요.
//   Build Command : npm install   (또는 비워둠 - 의존성 없음)
//   Start Command : node server.js   (또는 npm start)
//   Environment    : GEMINI_API_KEY = 발급받은_키

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;                 // server.js 가 있는 폴더(= 저장소 루트)
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const MAX_BODY = 200 * 1024;            // 프록시 요청 본문 최대 200KB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf'
};

// ---- Gemini 프록시: 클라이언트가 { model, body } 를 보내면 서버 키로 구글에 대신 요청 ----
function handleGemini(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }));
    return;
  }
  let raw = '';
  let aborted = false;
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > MAX_BODY) { aborted = true; req.destroy(); }
  });
  req.on('end', () => {
    if (aborted) { res.writeHead(413); res.end('payload too large'); return; }
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }
    // 모델명은 안전한 문자만 허용 (경로 주입/SSRF 방지)
    let model = (parsed && parsed.model) || 'gemini-2.0-flash-lite';
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) model = 'gemini-2.0-flash-lite';

    const upstreamBody = JSON.stringify((parsed && parsed.body) || {});
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(GEMINI_KEY),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(upstreamBody)
      }
    };
    const gReq = https.request(options, gRes => {
      let data = '';
      gRes.on('data', d => data += d);
      gRes.on('end', () => {
        // 구글의 상태코드/본문을 그대로 전달 (클라이언트가 429/400/503 등을 처리)
        res.writeHead(gRes.statusCode || 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
    });
    gReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'upstream request failed' }));
    });
    gReq.write(upstreamBody);
    gReq.end();
  });
}

// ---- 정적 파일 서빙 (경로 탈출 방지) ----
function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('bad request'); return; }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath));
  // ROOT 밖으로 나가는 경로 차단
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/api/gemini') {
    if (req.method !== 'POST') { res.writeHead(405); res.end('method not allowed'); return; }
    return handleGemini(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('method not allowed'); return; }
  serveStatic(req, res);
}).listen(PORT, () => {
  console.log('수달중국어 서버 실행 중 - 포트 ' + PORT + (GEMINI_KEY ? ' (Gemini 프록시 활성)' : ' (경고: GEMINI_API_KEY 미설정)'));
});
