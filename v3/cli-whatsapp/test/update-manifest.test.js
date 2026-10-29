import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanVersion, compareVersions, isNewer, parseManifestText } from '../update-manifest.js';

const SHA = 'a'.repeat(64);

test('BOM y espacios: se parsea igual', () => {
  const m = parseManifestText('﻿  {"version":"1.0.51","url":"https://x.example/ANA-1.0.51.exe"}\r\n');
  assert.deepEqual(m, { version: '1.0.51', url: 'https://x.example/ANA-1.0.51.exe', sha256: null, size: null });
});

test('sha256 y size opcionales; el hash se normaliza a minúsculas', () => {
  const m = parseManifestText(JSON.stringify({ version: '1.0.51', url: 'https://x/a.exe', sha256: SHA.toUpperCase(), size: 123 }));
  assert.equal(m.sha256, SHA);
  assert.equal(m.size, 123);
});

test('sin url: se arma la del bucket por defecto', () => {
  const m = parseManifestText('{"version":"1.0.51"}');
  assert.equal(m.url, 'https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-1.0.51.exe');
});

test('rechaza vacío, HTML, JSON inválido, versión inválida, url http, sha256/size inválidos', () => {
  assert.throws(() => parseManifestText(''), /vacío/);
  assert.throws(() => parseManifestText('<!DOCTYPE html><html></html>'), /HTML/);
  assert.throws(() => parseManifestText('{nope'), /JSON/);
  assert.throws(() => parseManifestText('{"version":"latest"}'), /versión/);
  assert.throws(() => parseManifestText('{"version":"1.0.51","url":"http://x/a.exe"}'), /https/);
  assert.throws(() => parseManifestText(`{"version":"1.0.51","sha256":"xyz"}`), /sha256/);
  assert.throws(() => parseManifestText(`{"version":"1.0.51","size":-1}`), /size/);
  assert.throws(() => parseManifestText(`{"version":"1.0.51","size":"abc"}`), /size/);
});

test('comparación numérica y nunca downgrade', () => {
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.9', '1.0.9'), 0);
  assert.equal(isNewer('1.0.51', '1.0.50'), true);
  assert.equal(isNewer('1.0.50', '1.0.50'), false);
  assert.equal(isNewer('1.0.49', '1.0.50'), false);
  assert.equal(cleanVersion('﻿1.0.51 '), '1.0.51');
  assert.equal(cleanVersion('1.0'), '');
});
