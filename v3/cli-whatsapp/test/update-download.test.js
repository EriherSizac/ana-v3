import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadVerified, verifyDownload } from '../update-download.js';

const body = Buffer.alloc(256 * 1024, 7);
const sha = crypto.createHash('sha256').update(body).digest('hex');

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/ANA.exe`, close: () => new Promise((r) => server.close(r)) };
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ana-dl-')), 'ANA-1.0.51.exe');

test('descarga con progreso, verifica tamaño y sha256 y deja el archivo final', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  const dest = tmp();
  const pcts = [];
  const r = await downloadVerified({ url: s.url, dest, expectedSize: body.length, expectedSha256: sha, httpsGet: http.get, onProgress: (p) => pcts.push(p.pct) });
  await s.close();
  assert.equal(r.sha256, sha);
  assert.equal(fs.statSync(dest).size, body.length);
  assert.equal(fs.existsSync(`${dest}.part`), false);
  assert.equal(pcts.at(-1), 100);
});

test('sha256 distinto: rechaza y borra el parcial', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  const dest = tmp();
  await assert.rejects(downloadVerified({ url: s.url, dest, expectedSha256: 'b'.repeat(64), httpsGet: http.get }), { code: 'sha256_mismatch' });
  await s.close();
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('manifiesto viejo (sin sha256 ni size): se acepta con Content-Length', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  const dest = tmp();
  const r = await downloadVerified({ url: s.url, dest, httpsGet: http.get });
  await s.close();
  assert.equal(r.size, body.length);
});

test('tamaño del manifiesto distinto: rechaza', async () => {
  const s = await serve((req, res) => res.end(body));
  const dest = tmp();
  await assert.rejects(downloadVerified({ url: s.url, dest, expectedSize: body.length + 1, httpsGet: http.get }), { code: 'size_mismatch' });
  await s.close();
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('HTTP 404: rechaza sin dejar archivos', async () => {
  const s = await serve((req, res) => {
    res.writeHead(404);
    res.end('no');
  });
  const dest = tmp();
  await assert.rejects(downloadVerified({ url: s.url, dest, httpsGet: http.get }), /HTTP 404/);
  await s.close();
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('verifyDownload: sin referencia de tamaño no se acepta', () => {
  assert.equal(verifyDownload({ received: 10, contentLength: 0, expectedSize: null }).code, 'no_size');
  assert.equal(verifyDownload({ received: 10, contentLength: 10, expectedSize: null }), null);
});

test('conexión cortada a la mitad: rechaza y borra el parcial', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length });
    res.write(body.subarray(0, 1000), () => res.destroy());
  });
  const dest = tmp();
  await assert.rejects(downloadVerified({ url: s.url, dest, httpsGet: http.get }));
  await s.close();
  assert.equal(fs.existsSync(`${dest}.part`), false);
  assert.equal(fs.existsSync(dest), false);
});
