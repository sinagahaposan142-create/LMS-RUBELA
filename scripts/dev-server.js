'use strict';
/* =====================================================================
 * Server pengembangan lokal: file statis + /api/rubela + database
 * Turso tiruan (node:sqlite). Tidak dipakai di Vercel.
 *   node scripts/dev-server.js            → http://localhost:8777 (mode server)
 *   node scripts/dev-server.js --local    → tanpa backend (mode lokal/browser saja)
 *   PORT=9000 DB_FILE=.dev/rubela.db node scripts/dev-server.js
 *   RT_URL=http://127.0.0.1:8791 ...    → sinyal realtime ke server Phoenix lokal
 * Butuh Node.js >= 22.5.
 * ===================================================================*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8777);
const LOCAL_ONLY = process.argv.includes('--local');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};

async function main() {
  let api = null;
  if (!LOCAL_ONLY) {
    const { createMockTurso } = require('./mock-turso');
    const file = process.env.DB_FILE || ':memory:';
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const turso = createMockTurso({ file, token: 'dev-token' });
    await new Promise(r => turso.listen(0, '127.0.0.1', r));
    process.env.TURSO_DATABASE_URL = 'http://127.0.0.1:' + turso.address().port;
    process.env.TURSO_AUTH_TOKEN = 'dev-token';
    api = require('../api/rubela.js');
    console.log('[dev] database tiruan:', file, '→', process.env.TURSO_DATABASE_URL);
  }
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/rubela') {
      if (!api) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      req.query = Object.fromEntries(url.searchParams);
      return api(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    // RT_URL=http://127.0.0.1:PORT → arahkan sinyal realtime ke server Phoenix lokal (uji tanpa Supabase).
    if (rel === '/js/sync-config.js' && (process.env.RT_URL || LOCAL_ONLY)) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/supabaseUrl: '[^']*'/, `supabaseUrl: '${LOCAL_ONLY ? '' : process.env.RT_URL}'`);
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-cache' });
      return res.end(src);
    }
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || /[\\/](\.git|api|scripts|node_modules)[\\/]/.test(file.slice(ROOT.length))) {
      res.writeHead(404); return res.end('Not found');
    }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }).listen(PORT, () => console.log(`[dev] LMS Rubela: http://localhost:${PORT} (${LOCAL_ONLY ? 'mode lokal' : 'mode server'})`));
}

main().catch(e => { console.error(e); process.exit(1); });
