const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let cleanUrl = req.url.split('?')[0];
  if (cleanUrl === '/' || cleanUrl === '') cleanUrl = '/index.html';

  // Decode URI component (e.g. spaces or special characters)
  try {
    cleanUrl = decodeURIComponent(cleanUrl);
  } catch (e) { }

  // Strip leading slashes to prevent root-relative path issues on Windows
  const relativePath = cleanUrl.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT_DIR, relativePath);

  // Security check: ensure path is within ROOT_DIR (case-insensitive for Windows)
  if (!filePath.toLowerCase().startsWith(ROOT_DIR.toLowerCase())) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + cleanUrl);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    };

    if (cleanUrl.startsWith('/frames/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`  Portfolio Server running at: http://localhost:${PORT}`);
  console.log(`  Root Directory: ${ROOT_DIR}`);
  console.log(`  Press Ctrl + C to stop the server`);
  console.log('='.repeat(60));
});
