import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInSessionUpdater } from '../in-session-update.js';
import { bannerView } from '../update-banner.js';

const quiet = { log() {}, warn() {}, error() {} };
const manifest = (version) => ({ version, url: `https://x/ANA-${version}.exe`, sha256: null, size: 10 });

function make(over = {}) {
  const calls = [];
  const states = [];
  const u = createInSessionUpdater({
    currentVersion: '1.0.50',
    fetchManifest: async () => manifest('1.0.51'),
    requestPause: async () => calls.push('pause'),
    resumeLoop: () => calls.push('resume'),
    download: async (m, onProgress) => {
      calls.push(`download:${m.version}`);
      onProgress(50);
      onProgress(100);
      return 'C:\\tmp\\ANA.exe';
    },
    install: async (file) => calls.push(`install:${file}`),
    onState: (s) => states.push(s),
    logger: quiet,
    countdownMs: 3,
    tickMs: 1,
    pauseMaxWaitMs: 50,
    errorNoticeMs: 5,
    ...over,
  });
  return { u, calls, states };
}

test('versión mayor: pausa → descarga → cuenta regresiva → instalar, sin opción de posponer', async () => {
  const { u, calls, states } = make();
  assert.equal(await u.checkNow('interval'), true);
  assert.deepEqual(calls, ['pause', 'download:1.0.51', 'install:C:\\tmp\\ANA.exe']);
  const phases = [...new Set(states.map((s) => s.phase))];
  assert.deepEqual(phases, ['pausing', 'downloading', 'restarting', 'installing']);
  assert.ok(states.some((s) => s.phase === 'downloading' && s.pct === 100));
  assert.ok(states.some((s) => s.phase === 'restarting' && s.secondsLeft === 1));
  // Ningún estado ofrece "Más tarde" ni botones.
  for (const s of states) assert.equal(JSON.stringify(bannerView(s)).includes('Más tarde'), false);
});

test('misma versión o menor: no hace nada (nunca downgrade)', async () => {
  for (const v of ['1.0.50', '1.0.49']) {
    const { u, calls } = make({ fetchManifest: async () => manifest(v) });
    assert.equal(await u.checkNow(), false);
    assert.deepEqual(calls, []);
  }
});

test('error de manifiesto: se registra y sigue en espera', async () => {
  const { u, calls } = make({
    fetchManifest: async () => {
      throw new Error('HTTP 503');
    },
  });
  assert.equal(await u.checkNow(), false);
  assert.equal(u.phase, 'idle');
  assert.deepEqual(calls, []);
});

test('descarga fallida: reanuda el ciclo, muestra el error y lo retira después', async () => {
  const { u, calls, states } = make({
    download: async () => {
      throw new Error('El SHA-256 del instalador no coincide con el manifiesto');
    },
  });
  assert.equal(await u.checkNow(), false);
  assert.deepEqual(calls, ['pause', 'resume']);
  const err = states.find((s) => s?.phase === 'error');
  assert.match(err.message, /SHA-256/);
  assert.equal(bannerView(err).tone, 'error');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(states.at(-1), null);
  assert.equal(u.phase, 'idle');
});

test('install que falla (no se pudo lanzar el ayudante): reanuda el ciclo', async () => {
  const { u, calls } = make({
    install: async () => {
      throw new Error('spawn powershell.exe ENOENT');
    },
  });
  await u.checkNow();
  assert.deepEqual(calls, ['pause', 'download:1.0.51', 'resume']);
});

test('el ciclo no se estaciona: tras el tope se actualiza igual', async () => {
  const { u, calls } = make({ requestPause: () => new Promise(() => {}), pauseMaxWaitMs: 5 });
  assert.equal(await u.checkNow(), true);
  assert.deepEqual(calls, ['download:1.0.51', 'install:C:\\tmp\\ANA.exe']);
});

test('un chequeo durante una actualización en curso se ignora', async () => {
  let release;
  const { u, calls } = make({ requestPause: () => new Promise((r) => (release = r)) , pauseMaxWaitMs: 10_000 });
  const first = u.checkNow();
  await new Promise((r) => setImmediate(r));
  assert.equal(u.phase, 'pausing');
  assert.equal(await u.checkNow('resume'), false);
  release();
  await first;
  assert.equal(calls.filter((c) => c.startsWith('download')).length, 1);
});

test('aviso realtime: espera aleatoria y un solo chequeo; intervalo cada 30 min', async () => {
  const timeouts = [];
  const intervals = [];
  let fetches = 0;
  const { u } = make({
    fetchManifest: async () => {
      fetches += 1;
      return manifest('1.0.50');
    },
    random: () => 0.5,
    jitterMs: 30_000,
    setTimeoutImpl: (fn, ms) => {
      timeouts.push({ fn, ms });
      return timeouts.length;
    },
    setIntervalImpl: (fn, ms) => {
      intervals.push({ fn, ms });
      return 1;
    },
  });
  u.start();
  assert.equal(intervals[0].ms, 30 * 60 * 1000);
  u.onRelease();
  u.onRelease(); // agrupado
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].ms, 15_000);
  await timeouts[0].fn();
  await intervals[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(fetches, 2);
});

test('bannerView: textos en español del aviso obligatorio', () => {
  assert.equal(bannerView({ phase: 'pausing', version: '1.0.51' }).title, 'Nueva versión 1.0.51 — se actualizará automáticamente');
  assert.equal(bannerView({ phase: 'downloading', version: '1.0.51', pct: 42 }).detail, 'Descargando actualización… 42%');
  assert.equal(bannerView({ phase: 'restarting', version: '1.0.51', secondsLeft: 9 }).detail, 'Reiniciando para actualizar en 9 s');
  assert.match(bannerView({ phase: 'previous-failed', version: '1.0.51', exitCode: 5, current: '1.0.50' }).title, /No se pudo instalar la versión 1.0.51/);
  assert.equal(bannerView(null), null);
});
