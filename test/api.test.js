import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'colectivos-'));
const { server } = await import('../server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (body) => fetch(base + '/api/ratings', { method: 'POST', body: JSON.stringify(body) });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('puntúa con foto y calcula promedio', async () => {
  assert.equal((await post({ routeId: '123', score: 4, photos: [PNG] })).status, 201);
  assert.equal((await post({ routeId: '123', score: 6 })).status, 201);
  const d = await (await fetch(base + '/api/ratings?route=123')).json();
  assert.equal(d.count, 2); assert.equal(d.avg, 5);
  assert.equal((await fetch(`${base}/uploads/${d.ratings.find((r) => r.photos.length).photos[0]}`)).status, 200);
});
test('rechaza puntuaciones fuera de 1-6, tipos inválidos y path traversal', async () => {
  assert.equal((await post({ routeId: '1', score: 7 })).status, 400);
  assert.equal((await post({ routeId: '1', score: 0 })).status, 400);
  assert.equal((await post({ routeId: 'x', score: 3 })).status, 400);
  assert.equal((await post({ routeId: '1', score: 3, photos: ['data:text/html;base64,AAAA'] })).status, 400);
  assert.notEqual((await fetch(base + '/uploads/..%2Fratings.json')).status, 200);
});
test('sirve el index', async () => assert.equal((await fetch(base + '/')).status, 200));
test.after(() => server.close());
