// Disk Bubble — local server: drive list, scan (SSE progress), show in Explorer.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 5731);
const PUB = path.join(__dirname, 'public');
const D3 = path.join(__dirname, 'node_modules', 'd3-hierarchy', 'dist', 'd3-hierarchy.min.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const { drives, scan, prune } = require('./scanner');

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/drives') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(drives()));
  }
  if (u.pathname === '/api/scan') {
    const root = u.searchParams.get('path');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const send = (ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
    const t0 = Date.now();
    scan(root, st => send('p', st), ac.signal).then(({ tree, st }) => {
      if (ac.signal.aborted) return;
      const pr = prune(tree, Math.max(tree.s / 30000, 4 * 1024));
      send('done', { tree: pr, files: st.files, dirs: st.dirs, ms: Date.now() - t0 });
      res.end();
    }).catch(e => { send('err', String(e)); res.end(); });
    return;
  }
  if (u.pathname === '/api/reveal' && req.method === 'POST') {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => {
      try {
        const p = JSON.parse(b).path;
        if (fs.existsSync(p)) spawn('explorer.exe', ['/select,' + p], { detached: true, stdio: 'ignore' }).unref();
      } catch {}
      res.end('ok');
    });
    return;
  }
  if (u.pathname === '/d3-hierarchy.js') {
    res.setHeader('content-type', 'text/javascript');
    return fs.createReadStream(D3).pipe(res);
  }
  const f = path.join(PUB, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[\\/])+/, ''));
  if (!f.startsWith(PUB) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('http://127.0.0.1:' + PORT));
