'use strict';

/**
 * VeriScript server. No dependencies: just Node's built-in modules.
 *   node server.js            -> http://127.0.0.1:3000
 *   PORT=8080 node server.js  -> pick another port
 *
 * Uploaded files are held in memory for the length of one request and are
 * never written to disk, executed, or fetched from.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { MAX_BYTES } = require('./lib/data');
const { detect } = require('./lib/detect');
const pages = require('./lib/pages');

const PORT = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const HOME_HTML = pages.home();
const UNSUPPORTED_HTML = pages.unsupported();
const NOT_FOUND_HTML = pages.notFound();

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function baseHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
      "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
}

function sendHtml(res, status, html) {
  res.writeHead(status, { ...baseHeaders(), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

function sendText(res, status, text, extra = {}) {
  res.writeHead(status, { ...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  res.end(text);
}

// POST /scan always answers HTTP 200 with JSON, including for rejections and errors.
function sendScanJson(res, body) {
  res.writeHead(200, { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Reads the request body but keeps at most MAX_BYTES (+ one chunk) in memory.
 * Anything past that is counted and thrown away, so a huge upload can't fill memory.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let kept = 0;
    let counted = 0;
    req.on('data', (chunk) => {
      counted += chunk.length;
      if (kept <= MAX_BYTES) {
        chunks.push(chunk);
        kept += chunk.length;
      }
    });
    req.on('end', () => resolve({ buffer: Buffer.concat(chunks), counted }));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('client aborted')));
  });
}

async function handleScan(req, res, url) {
  try {
    const { buffer, counted } = await readBody(req);
    // The browser sends only the first few KB of a file that is too big and says how big it is.
    const declared = Number.parseInt(req.headers['x-file-size'], 10);
    const size = Math.max(counted, Number.isFinite(declared) && declared > 0 ? declared : 0);
    const filename = url.searchParams.get('filename') || '';
    sendScanJson(res, detect({ filename, bytes: buffer, size }));
  } catch (err) {
    // Log the detail on the server; never send it to the client.
    console.error('scan failed:', err && err.message);
    if (res.headersSent || res.writableEnded) return;
    sendScanJson(res, {
      status: 'error',
      reason: 'The scanner hit a problem on our side. Nothing was analyzed. Try again.',
      see: '/unsupported',
    });
  }
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendHtml(res, 404, NOT_FOUND_HTML);
  }
  if (rel.includes('\0')) return sendHtml(res, 404, NOT_FOUND_HTML);

  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendHtml(res, 404, NOT_FOUND_HTML);

  fs.stat(file, (err, stat) => {
    const type = MIME[path.extname(file).toLowerCase()];
    if (err || !stat.isFile() || !type) return sendHtml(res, 404, NOT_FOUND_HTML);
    res.writeHead(200, {
      ...baseHeaders(),
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': type === 'font/woff2' ? 'public, max-age=604800' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  const pathname = url.pathname;

  if (pathname === '/scan') {
    if (req.method === 'POST') return void handleScan(req, res, url);
    return sendText(res, 405, 'Use POST /scan.', { Allow: 'POST' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }

  if (pathname === '/') return sendHtml(res, 200, HOME_HTML);
  if (pathname === '/unsupported' || pathname === '/unsupported/') return sendHtml(res, 200, UNSUPPORTED_HTML);
  return serveStatic(req, res, pathname);
});

server.requestTimeout = 60_000;

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`VeriScript is running at http://${HOST}:${PORT}`);
  });
}

module.exports = { server };
