import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'ratings.json');
const PORT = process.env.PORT || 3000;

const MAX_BODY = 8 * 1024 * 1024;
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
};
const IMG_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

await fs.mkdir(UPLOADS, { recursive: true });
let ratings = [];
try { ratings = JSON.parse(await fs.readFile(DB_FILE, 'utf8')); } catch { /* primera ejecución */ }

let saving = Promise.resolve();
const persist = () => (saving = saving.then(() =>
  fs.writeFile(DB_FILE, JSON.stringify(ratings, null, 1))));

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Solicitud demasiado grande'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

async function savePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw Object.assign(new Error('Formato de imagen no permitido (JPG, PNG o WebP)'), { status: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_PHOTO_BYTES) throw Object.assign(new Error('Foto demasiado grande (máx. 2 MB)'), { status: 413 });
  const name = crypto.randomUUID() + IMG_TYPES[m[1]];
  await fs.writeFile(path.join(UPLOADS, name), buf);
  return name;
}

function summarize(list) {
  const byRoute = {};
  for (const r of list) {
    const s = (byRoute[r.routeId] ||= { routeId: r.routeId, count: 0, sum: 0 });
    s.count++; s.sum += r.score;
  }
  return Object.values(byRoute).map((s) => ({ routeId: s.routeId, count: s.count, avg: +(s.sum / s.count).toFixed(2) }));
}

async function api(req, res, url) {
  if (url.pathname === '/api/summary' && req.method === 'GET') return send(res, 200, summarize(ratings));
  if (url.pathname === '/api/ratings' && req.method === 'GET') {
    const routeId = clean(url.searchParams.get('route'), 40);
    const list = ratings.filter((r) => r.routeId === routeId).sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { ratings: list, ...(summarize(list)[0] || { count: 0, avg: 0 }) });
  }
  if (url.pathname === '/api/ratings' && req.method === 'POST') {
    const b = await readJson(req);
    const score = Number(b.score);
    const routeId = clean(b.routeId, 40);
    if (!/^\d+$/.test(routeId)) return send(res, 400, { error: 'Recorrido inválido' });
    if (!Number.isInteger(score) || score < 1 || score > 6) return send(res, 400, { error: 'La puntuación debe ser de 1 a 6' });
    const photosIn = Array.isArray(b.photos) ? b.photos : [];
    if (photosIn.length > MAX_PHOTOS) return send(res, 400, { error: `Máximo ${MAX_PHOTOS} fotos` });
    const photos = [];
    for (const p of photosIn) photos.push(await savePhoto(p));
    const rating = {
      id: crypto.randomUUID(), routeId, routeName: clean(b.routeName, 120),
      score, author: clean(b.author, 40) || 'Anónimo', comment: clean(b.comment, 500),
      photos, createdAt: Date.now(),
    };
    ratings.push(rating);
    await persist();
    return send(res, 201, rating);
  }
  return send(res, 404, { error: 'No encontrado' });
}

async function serveFile(res, base, rel) {
  const file = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(base + path.sep)) return send(res, 403, 'Prohibido', 'text/plain');
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  } catch { send(res, 404, 'No encontrado', 'text/plain'); }
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/uploads/')) return await serveFile(res, UPLOADS, decodeURIComponent(url.pathname.slice(9)));
    return await serveFile(res, PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  } catch (e) {
    send(res, e.status || 500, { error: e.status ? e.message : 'Error interno' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Colectivos Córdoba en http://localhost:${PORT}`));
}
