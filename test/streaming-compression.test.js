import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import fs from 'node:fs';
import { streamingCompression } from '../server/streaming-compression.js';

const initial = 'event: snapshot\ndata: ' + JSON.stringify({ alerts: Array.from({ length: 40 }, (_, i) => ({ id: i, title: 'خبر تجريبي', description: 'اختبار البث المباشر '.repeat(20) })) }) + '\n\n';
const update = 'event: alert\ndata: {"id":"new"}\n\n';
const ping = 'event: ping\ndata: 123\n\n';
async function readStream(encoding) {
  const app = express(); app.use(streamingCompression());
  let end;
  app.get('/api/stream', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.write(initial);
    setTimeout(() => res.write(update), 30);
    setTimeout(() => res.write(ping), 60);
    // Keep the HTTP response open until all three events have been received.
    end = () => res.end();
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/stream', headers: encoding ? { 'Accept-Encoding': encoding } : {} }, res => {
        let wireBytes = 0, text = ''; const chunks = [];
        res.on('data', b => { wireBytes += b.length; });
        const decoder = res.headers['content-encoding'] === 'gzip' ? zlib.createGunzip() : res.headers['content-encoding'] === 'deflate' ? zlib.createInflate() : null;
        const source = decoder ? res.pipe(decoder) : res;
        source.on('data', b => { text += b.toString(); chunks.push(text); if (text.includes(ping)) end(); });
        source.on('end', () => resolve({ text, chunks, wireBytes, headers: res.headers }));
        source.on('error', reject);
      });
      req.setTimeout(2000, () => req.destroy(new Error('SSE chunks were buffered')));
      req.on('error', reject);
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
for (const encoding of ['gzip', 'deflate', null]) test('SSE streams snapshot, alert and heartbeat before connection closes: ' + encoding, async () => {
  const r = await readStream(encoding);
  assert.equal(r.text, initial + update + ping);
  assert.ok(r.chunks.some(t => t === initial), 'snapshot arrives before later events');
  if (encoding) { assert.equal(r.headers['content-encoding'], encoding); assert.ok(r.wireBytes < Buffer.byteLength(r.text) / 3); }
  else assert.equal(r.headers['content-encoding'], undefined);
  assert.match(r.headers.vary, /Accept-Encoding/i);
});
test('compression is enabled for the actual stream route without changing data or heartbeat timing', () => {
  const s = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(s, /app.use\(streamingCompression\(\)\)/);
  assert.ok(!s.includes('no-cache, no-transform'));
  assert.match(s, /25_000/);
});
