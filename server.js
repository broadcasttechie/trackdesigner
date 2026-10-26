#!/usr/bin/env node
/*
 * Duplo Track Planner server — no dependencies, Node 18+.
 * Serves the web app and stores the workspace and saved layouts as JSON files.
 *
 * Environment:
 *   PORT        listen port (default 8080)
 *   HOST        listen address (default 0.0.0.0)
 *   DATA_DIR    where JSON is stored (default ./data)
 *   BASIC_AUTH  optional "user:password" to require a login
 */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const LAYOUT_DIR = path.join(DATA_DIR, 'layouts');
const WORKSPACE = path.join(DATA_DIR, 'workspace.json');
const BASIC_AUTH = process.env.BASIC_AUTH || '';
const MAX_BODY = 4 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// The page source is written as a body fragment; wrap it in a full document here.
const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<meta name="apple-mobile-web-app-capable" content="yes">
<style>:root{padding-top:env(safe-area-inset-top,0px)}[hidden]{display:none!important}img{max-width:100%}</style>
</head>
<body>
`;

function send(res, status, body, headers) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': TYPES['.json'] });

function authorised(req) {
  if (!BASIC_AUTH) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const given = Buffer.from(h.slice(6), 'base64');
  const want = Buffer.from(BASIC_AUTH);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

// Layout names become file names: keep them readable but safe.
function layoutFile(name) {
  const clean = String(name).normalize('NFKC').replace(/[^\p{L}\p{N} _.,()'-]+/gu, '').trim().slice(0, 80);
  if (!clean || clean.startsWith('.')) throw Object.assign(new Error('invalid name'), { status: 400 });
  return path.join(LAYOUT_DIR, clean + '.json');
}

async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api\//, '');
  if (p === 'health') return json(res, 200, { ok: true, app: 'duplo-track-planner', version: 1 });

  if (p === 'workspace') {
    if (req.method === 'GET') {
      try { return send(res, 200, await fsp.readFile(WORKSPACE, 'utf8'), { 'content-type': TYPES['.json'] }); }
      catch { return send(res, 200, 'null', { 'content-type': TYPES['.json'] }); }
    }
    if (req.method === 'PUT') {
      const obj = parseJSON(await readBody(req));
      if (!obj || typeof obj !== 'object') return json(res, 400, { error: 'expected an object' });
      await writeAtomic(WORKSPACE, JSON.stringify(obj));
      return json(res, 200, { ok: true });
    }
  }

  if (p === 'layouts' && req.method === 'GET') {
    await fsp.mkdir(LAYOUT_DIR, { recursive: true });
    const files = (await fsp.readdir(LAYOUT_DIR)).filter((f) => f.endsWith('.json'));
    const items = await Promise.all(files.map(async (f) => {
      const full = path.join(LAYOUT_DIR, f);
      const stat = await fsp.stat(full);
      let pieces = null;
      try { pieces = JSON.parse(await fsp.readFile(full, 'utf8')).layout.pieces.length; } catch { /* unreadable */ }
      return { name: f.slice(0, -5), updated: stat.mtime.toISOString(), pieces };
    }));
    items.sort((a, b) => b.updated.localeCompare(a.updated));
    return json(res, 200, items);
  }

  const m = p.match(/^layouts\/(.+)$/);
  if (m) {
    const file = layoutFile(decodeURIComponent(m[1]));
    if (req.method === 'GET') {
      try { return send(res, 200, await fsp.readFile(file, 'utf8'), { 'content-type': TYPES['.json'] }); }
      catch { return json(res, 404, { error: 'not found' }); }
    }
    if (req.method === 'PUT') {
      const obj = parseJSON(await readBody(req));
      if (!obj || obj.format !== 'duplo-track-planner') return json(res, 400, { error: 'not a layout' });
      await writeAtomic(file, JSON.stringify(obj));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      try { await fsp.unlink(file); } catch { return json(res, 404, { error: 'not found' }); }
      return json(res, 200, { ok: true });
    }
  }
  return json(res, 404, { error: 'unknown endpoint' });
}

async function staticFile(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  let data;
  try { data = await fsp.readFile(full); } catch { return send(res, 404, 'Not found', { 'content-type': 'text/plain' }); }
  const ext = path.extname(full);
  if (rel === '/index.html') data = Buffer.concat([Buffer.from(HEAD), data, Buffer.from('\n</body>\n</html>\n')]);
  send(res, 200, data, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authorised(req)) return send(res, 401, 'Login required', { 'www-authenticate': 'Basic realm="Duplo Track Planner"' });
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await staticFile(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: err.message });
  }
});

fs.mkdirSync(LAYOUT_DIR, { recursive: true });
server.listen(PORT, HOST, () => console.log(`Duplo Track Planner on http://${HOST}:${PORT} (data in ${DATA_DIR})`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
