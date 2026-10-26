import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSettings, DEFAULT_SETTINGS, POLL_INTERVAL_MS } from '../remote-settings.js';

const quiet = { warn() {}, error() {} };

function fakeTimers() {
  const timers = [];
  return {
    setIntervalImpl: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearIntervalImpl: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    tick: async () => {
      for (const t of [...timers]) await t.fn();
      await new Promise((r) => setImmediate(r));
    },
    timers,
  };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('arranque sin red: usa los valores por defecto y reintenta a los 5 minutos', async () => {
  const calls = [];
  const timers = fakeTimers();
  const rs = createRemoteSettings({
    baseUrl: 'https://v3.test',
    getToken: async () => 'tok',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      throw new TypeError('fetch failed');
    },
    logger: quiet,
    ...timers,
  });
  rs.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(rs.get('noWhatsappConsultRegistration'), false);
  assert.equal(calls.length, 1);
  assert.equal(timers.timers[0].ms, POLL_INTERVAL_MS);
  assert.equal(POLL_INTERVAL_MS, 5 * 60 * 1000);
  await timers.tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://v3.test/agent/settings');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.ok(calls[0].init.signal, 'lleva timeout');
});

test('fallo después de una lectura exitosa: conserva el último valor', async () => {
  let fail = false;
  const rs = createRemoteSettings({
    baseUrl: 'https://v3.test',
    getToken: async () => 'tok',
    fetchImpl: async () => (fail ? json(500, {}) : json(200, { settings: { noWhatsappConsultRegistration: true }, updatedAt: 'x' })),
    logger: quiet,
  });
  assert.equal(await rs.refresh(), true);
  assert.equal(rs.get('noWhatsappConsultRegistration'), true);
  fail = true;
  assert.equal(await rs.refresh(), false);
  assert.equal(rs.get('noWhatsappConsultRegistration'), true);
});

test('cambio en caliente: onChange avisa sin reiniciar', async () => {
  let value = true;
  const timers = fakeTimers();
  const rs = createRemoteSettings({
    baseUrl: 'https://v3.test',
    getToken: async () => 'tok',
    fetchImpl: async () => json(200, { settings: { noWhatsappConsultRegistration: value } }),
    logger: quiet,
    ...timers,
  });
  const seen = [];
  rs.onChange((key, v) => seen.push([key, v]));
  rs.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, [['noWhatsappConsultRegistration', true]]);
  value = false;
  await timers.tick();
  assert.equal(rs.get('noWhatsappConsultRegistration'), false);
  assert.deepEqual(seen, [
    ['noWhatsappConsultRegistration', true],
    ['noWhatsappConsultRegistration', false],
  ]);
  rs.stop();
  assert.equal(timers.timers.length, 0);
});

test('sin token no consulta y queda el valor por defecto', async () => {
  let called = false;
  const rs = createRemoteSettings({ baseUrl: 'https://v3.test', fetchImpl: async () => ((called = true), json(200, {})), logger: quiet });
  assert.equal(await rs.refresh(), false);
  assert.equal(called, false);
  assert.deepEqual(rs.all(), { ...DEFAULT_SETTINGS });
});

test('ignora llaves desconocidas y tipos incorrectos', async () => {
  const rs = createRemoteSettings({
    baseUrl: 'https://v3.test',
    getToken: async () => 'tok',
    fetchImpl: async () => json(200, { settings: { noWhatsappConsultRegistration: 'true', modoTurbo: true } }),
    logger: quiet,
  });
  await rs.refresh();
  assert.deepEqual(rs.all(), { noWhatsappConsultRegistration: false });
});
