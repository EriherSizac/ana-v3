import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESUME_CHECK_MS,
  boundedUi,
  checkPageHealth,
  createLoopHeartbeat,
  createLoopSupervisor,
  createResumeDetector,
  withTimeout,
} from '../liveness.js';
import { createPollWaker, waitForNextPoll, POLL_INTERVAL_MS } from '../poll-wait.js';

/** Reloj falso con setTimeout/setInterval manuales; `jump` simula una suspensión. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const pending = [];
  const add = (fn, ms, every) => {
    const t = { fn, at: now + ms, every, id: ++seq };
    pending.push(t);
    return t;
  };
  const clear = (t) => {
    const i = pending.indexOf(t);
    if (i >= 0) pending.splice(i, 1);
  };
  return {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clear,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = pending[0];
        if (!t || t.at > end) break;
        now = t.at;
        if (t.every) t.at = now + t.every;
        else pending.shift();
        await t.fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
    },
    /** El reloj salta sin que corran temporizadores (equipo suspendido). */
    jump(ms) {
      now += ms;
      for (const t of pending) t.at = Math.max(t.at, now - 1) ;
    },
  };
}

const quiet = { log() {}, warn() {}, error() {} };

test('resume detector: ticks normales no disparan; un salto > 30 s sí', async () => {
  const c = fakeClock();
  const events = [];
  const d = createResumeDetector({
    onResume: (e) => events.push(e),
    now: c.now,
    setIntervalImpl: c.setInterval,
    clearIntervalImpl: c.clear,
    logger: quiet,
  });
  d.start();
  await c.advance(60_000);
  assert.equal(events.length, 0);
  c.jump(10 * 60_000); // suspensión de 10 min
  await c.advance(RESUME_CHECK_MS);
  assert.equal(events.length, 1);
  assert.ok(events[0].gapMs > 30_000);
  await c.advance(30_000);
  assert.equal(events.length, 1, 'solo un aviso por salto');
  d.stop();
});

test('resume detector: un manejador que lanza no detiene el detector', async () => {
  const c = fakeClock();
  let n = 0;
  const d = createResumeDetector({
    onResume: () => {
      n += 1;
      throw new Error('boom');
    },
    now: c.now,
    setIntervalImpl: c.setInterval,
    clearIntervalImpl: c.clear,
    logger: quiet,
  });
  d.start();
  c.jump(60_000);
  await c.advance(RESUME_CHECK_MS);
  c.jump(60_000);
  await c.advance(RESUME_CHECK_MS);
  assert.equal(n, 2);
});

test('heartbeat: sin latidos > 3× el intervalo declara bloqueo', async () => {
  const c = fakeClock();
  const stalls = [];
  const hb = createLoopHeartbeat({
    expectedMs: 30_000,
    onStall: (e) => stalls.push(e),
    now: c.now,
    setIntervalImpl: c.setInterval,
    clearIntervalImpl: c.clear,
    logger: quiet,
  });
  hb.start();
  for (let i = 0; i < 30; i++) {
    await c.advance(1000);
    hb.beat();
  }
  assert.equal(stalls.length, 0);
  await c.advance(95_000);
  assert.equal(stalls.length, 1);
  assert.ok(stalls[0].elapsedMs > 90_000);
  hb.stop();
});

test('heartbeat: durante el envío (busy) no se reinicia el ciclo', async () => {
  const c = fakeClock();
  let stalls = 0;
  const hb = createLoopHeartbeat({
    expectedMs: 30_000,
    onStall: () => (stalls += 1),
    now: c.now,
    setIntervalImpl: c.setInterval,
    clearIntervalImpl: c.clear,
  });
  hb.start();
  hb.setBusy(true);
  await c.advance(20 * 60_000);
  assert.equal(stalls, 0);
  hb.setBusy(false);
  await c.advance(60_000);
  assert.equal(stalls, 0);
  await c.advance(40_000);
  assert.equal(stalls, 1);
});

test('heartbeat: una suspensión no cuenta como bloqueo', async () => {
  const c = fakeClock();
  let stalls = 0;
  const hb = createLoopHeartbeat({
    expectedMs: 30_000,
    onStall: () => (stalls += 1),
    now: c.now,
    setIntervalImpl: c.setInterval,
    clearIntervalImpl: c.clear,
  });
  hb.start();
  await c.advance(10_000);
  hb.beat();
  c.jump(30 * 60_000);
  await c.advance(RESUME_CHECK_MS);
  assert.equal(stalls, 0);
});

test('supervisor: una iteración colgada se abandona y la siguiente corre', async () => {
  const sup = createLoopSupervisor();
  let hungGen = null;
  const first = sup.run(async (gen) => {
    hungGen = gen;
    await new Promise(() => {}); // page.evaluate o fetch congelado
  });
  await Promise.resolve();
  sup.stall();
  assert.equal(await first, 'stalled');
  assert.equal(sup.isCurrent(hungGen), false);
  let ran = false;
  const second = await sup.run(async (gen) => {
    ran = sup.isCurrent(gen);
  });
  assert.equal(second, 'done');
  assert.equal(ran, true);
});

test('supervisor: errores de una iteración abandonada no escapan', async () => {
  const sup = createLoopSupervisor();
  let reject;
  const p = sup.run(() => new Promise((_, r) => (reject = r)));
  await Promise.resolve();
  sup.stall();
  assert.equal(await p, 'stalled');
  reject(new Error('tarde'));
  await new Promise((r) => setImmediate(r));
});

test('withTimeout / boundedUi: una promesa colgada vence y boundedUi no lanza', async () => {
  const c = fakeClock();
  const timers = { setTimeoutImpl: c.setTimeout, clearTimeoutImpl: c.clear };
  const hung = new Promise(() => {});
  const p = withTimeout(hung, 3000, 'widget', timers);
  let err = null;
  p.catch((e) => (err = e));
  await c.advance(3000);
  await Promise.resolve();
  assert.equal(err?.code, 'ETIMEOUT');
  const b = boundedUi(() => hung, 3000, timers);
  await c.advance(3000);
  assert.equal(await b, undefined);
  assert.equal(await boundedUi(() => 7, 3000, timers), 7);
});

test('espera entre polls: un onTick (widget) congelado no detiene el poll ni el latido', async () => {
  const c = fakeClock();
  const waker = createPollWaker();
  let beats = 0;
  let ticks = 0;
  let result = null;
  waitForNextPoll({
    isActive: () => false,
    waker,
    onTick: () => {
      ticks += 1;
      return new Promise(() => {}); // page.evaluate que nunca responde
    },
    onBeat: () => (beats += 1),
    now: c.now,
    setTimeoutImpl: c.setTimeout,
    clearTimeoutImpl: c.clear,
  }).then((r) => (result = r));
  await c.advance(POLL_INTERVAL_MS + 1000);
  assert.equal(result, 'timeout');
  assert.equal(ticks, 1, 'el tick colgado no se apila');
  assert.ok(beats >= 29, `latidos: ${beats}`);
});

test('espera entre polls: la reanudación (wake) termina la espera de inmediato', async () => {
  const c = fakeClock();
  const waker = createPollWaker();
  let result = null;
  waitForNextPoll({
    isActive: () => true,
    waker,
    now: c.now,
    setTimeoutImpl: c.setTimeout,
    clearTimeoutImpl: c.clear,
  }).then((r) => (result = r));
  await c.advance(5000);
  waker.wake();
  await Promise.resolve();
  assert.equal(result, 'woken');
});

test('checkPageHealth: ok, cerrada, sin ventana, recarga y no responde', async () => {
  const ok = { isClosed: () => false, evaluate: async () => 1 };
  assert.equal(await checkPageHealth(ok), 'ok');
  assert.equal(await checkPageHealth({ isClosed: () => true }), 'closed');
  assert.equal(await checkPageHealth(null), 'missing');
  let reloaded = false;
  const frozen = {
    isClosed: () => false,
    evaluate: () => new Promise(() => {}),
    reload: async () => {
      reloaded = true;
    },
  };
  assert.equal(await checkPageHealth(frozen, { probeMs: 10 }), 'reloaded');
  assert.equal(reloaded, true);
  assert.equal(await checkPageHealth(frozen, { probeMs: 10, reload: false }), 'unresponsive');
  const dead = { isClosed: () => false, evaluate: () => new Promise(() => {}), reload: () => new Promise(() => {}) };
  assert.equal(await checkPageHealth(dead, { probeMs: 10, reloadMs: 10 }), 'unresponsive');
});
