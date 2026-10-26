import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { createDpapiProtector, createSessionStore, unavailableProtector, SESSION_FILE_NAME } from '../session-store.js';

const quiet = { warn() {}, log() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ana-session-'));

/** Protector falso: XOR con una llave "de la cuenta"; otra cuenta no puede descifrar. */
const fakeProtector = (account = 'A') => {
  const key = Buffer.from(`cuenta-${account}`);
  const xor = (b) => Buffer.from(b.map((x, i) => x ^ key[i % key.length]));
  return {
    available: true,
    protect: async (b) => Buffer.concat([Buffer.from(`${account}:`), xor(b)]),
    unprotect: async (b) => {
      if (!b.subarray(0, 2).equals(Buffer.from(`${account}:`))) throw new Error('dpapi_unprotect_failed');
      return xor(b.subarray(2));
    },
  };
};

test('guarda cifrado y recupera; el archivo no contiene el refresh token en claro', async () => {
  const dir = tmp();
  const store = createSessionStore({ dir, protector: fakeProtector('A'), logger: quiet });
  assert.equal(await store.save({ username: 'Erick', refreshToken: 'REFRESH-TOKEN-SECRETO' }), true);
  const raw = fs.readFileSync(path.join(dir, SESSION_FILE_NAME), 'utf8');
  assert.ok(!raw.includes('REFRESH-TOKEN-SECRETO'));
  assert.ok(!raw.includes('Erick'));
  const s = await store.load();
  assert.equal(s.username, 'Erick');
  assert.equal(s.refreshToken, 'REFRESH-TOKEN-SECRETO');
});

test('copiado a otra cuenta: se descarta y se borra', async () => {
  const dir = tmp();
  await createSessionStore({ dir, protector: fakeProtector('A'), logger: quiet }).save({ username: 'erick', refreshToken: 'r' });
  const other = createSessionStore({ dir, protector: fakeProtector('B'), logger: quiet });
  assert.equal(await other.load(), null);
  assert.equal(fs.existsSync(path.join(dir, SESSION_FILE_NAME)), false);
});

test('archivo corrupto se descarta', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, SESSION_FILE_NAME), '{no json');
  assert.equal(await createSessionStore({ dir, protector: fakeProtector(), logger: quiet }).load(), null);
  assert.equal(fs.existsSync(path.join(dir, SESSION_FILE_NAME)), false);
});

test('sin DPAPI no se persiste nada', async () => {
  const dir = tmp();
  const store = createSessionStore({ dir, protector: unavailableProtector, logger: quiet });
  assert.equal(store.canPersist, false);
  assert.equal(await store.save({ username: 'erick', refreshToken: 'r' }), false);
  assert.equal(fs.existsSync(path.join(dir, SESSION_FILE_NAME)), false);
  assert.equal(await store.load(), null);
});

test('fallo transitorio de PowerShell no borra la sesión', async () => {
  const dir = tmp();
  await createSessionStore({ dir, protector: fakeProtector('A'), logger: quiet }).save({ username: 'erick', refreshToken: 'r' });
  const flaky = { available: true, protect: async () => Buffer.alloc(0), unprotect: async () => { throw new Error('dpapi_timeout'); } };
  assert.equal(await createSessionStore({ dir, protector: flaky, logger: quiet }).load(), null);
  assert.equal(fs.existsSync(path.join(dir, SESSION_FILE_NAME)), true);
});

test('clear borra el archivo', async () => {
  const dir = tmp();
  const store = createSessionStore({ dir, protector: fakeProtector(), logger: quiet });
  await store.save({ username: 'erick', refreshToken: 'r' });
  store.clear();
  assert.equal(fs.existsSync(store.filePath), false);
});

test('protector DPAPI: el secreto viaja por stdin, nunca en los argumentos', async () => {
  const spawned = [];
  const spawnImpl = (cmd, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    let input = '';
    child.stdin.on('data', (d) => (input += d));
    child.stdin.on('end', () => {
      spawned.push({ cmd, args, input });
      child.stdout.end(Buffer.from('cifrado').toString('base64'));
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
  const p = createDpapiProtector({ spawnImpl, platform: 'win32' });
  const out = await p.protect(Buffer.from('REFRESH-SECRETO'));
  assert.equal(spawned[0].cmd, 'powershell.exe');
  assert.deepEqual(spawned[0].args, ['-NoProfile', '-NonInteractive', '-Command', '-']);
  const script = spawned[0].input;
  assert.match(script, /ProtectedData\]::Protect\(/);
  assert.match(script, /CurrentUser/);
  const b64 = Buffer.from('REFRESH-SECRETO').toString('base64');
  assert.ok(!spawned[0].args.join(' ').includes(b64));
  assert.ok(script.includes(b64)); // el dato solo viaja por stdin
  assert.equal(out.toString(), 'cifrado');
});

test('protector DPAPI: código de salida ≠ 0 → error sin contenido', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on('finish', () => setImmediate(() => child.emit('close', 1)));
    return child;
  };
  await assert.rejects(() => createDpapiProtector({ spawnImpl, platform: 'win32' }).unprotect(Buffer.from('x')), /dpapi_unprotect_failed/);
});

// Prueba real contra DPAPI (solo Windows): cifra con la cuenta actual y descifra.
test('DPAPI real con PowerShell (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const dir = tmp();
  const store = createSessionStore({ dir, protector: createDpapiProtector(), logger: quiet });
  const secret = `rt-${Date.now()}-REAL`;
  assert.equal(await store.save({ username: 'erick', refreshToken: secret }), true);
  const raw = fs.readFileSync(store.filePath, 'utf8');
  assert.ok(!raw.includes(secret));
  assert.ok(!Buffer.from(JSON.parse(raw).data, 'base64').toString('latin1').includes(secret));
  assert.equal((await store.load()).refreshToken, secret);
});
