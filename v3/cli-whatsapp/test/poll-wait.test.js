import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLL_BACKUP_INTERVAL_MS, POLL_INTERVAL_MS, createPollWaker, formatShort, waitForNextPoll, waitLabel } from '../poll-wait.js';

/** Reloj y temporizadores manuales. */
function clock() {
  let now = 0;
  const pending = [];
  return {
    now: () => now,
    setTimeoutImpl: (fn, ms) => {
      const t = { fn, at: now + ms };
      pending.push(t);
      return t;
    },
    clearTimeoutImpl: (t) => {
      const i = pending.indexOf(t);
      if (i >= 0) pending.splice(i, 1);
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const t = pending[0];
        if (!t || t.at > end) break;
        pending.shift();
        now = t.at;
        await t.fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
    },
  };
}

const run = (c, active, waker, ticks = []) => {
  let result = null;
  const p = waitForNextPoll({
    isActive: () => active.value,
    waker,
    onTick: (remaining, act) => ticks.push(waitLabel(act, remaining)),
    now: c.now,
    setTimeoutImpl: c.setTimeoutImpl,
    clearTimeoutImpl: c.clearTimeoutImpl,
  }).then((r) => (result = r));
  return { p, get result() {
    return result;
  } };
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('sin asignaciones con el canal inactivo: espera 30 s', async () => {
  const c = clock();
  const w = run(c, { value: false }, createPollWaker());
  await c.advance(POLL_INTERVAL_MS - 1000);
  await settle();
  assert.equal(w.result, null);
  await c.advance(1000);
  await settle();
  assert.equal(w.result, 'timeout');
});

test('canal activo: espera 2 minutos salvo aviso', async () => {
  const c = clock();
  const w = run(c, { value: true }, createPollWaker());
  await c.advance(POLL_BACKUP_INTERVAL_MS - 1000);
  await settle();
  assert.equal(w.result, null);
  await c.advance(1000);
  await settle();
  assert.equal(w.result, 'timeout');
});

test('asignación publicada durante la espera: termina de inmediato', async () => {
  const c = clock();
  const waker = createPollWaker();
  const w = run(c, { value: true }, waker);
  await c.advance(10_000);
  waker.wake();
  await settle();
  assert.equal(w.result, 'woken');
});

test('aviso a mitad de ciclo: la siguiente espera termina sin dormir; reconexión fuera de espera no deja pendiente', async () => {
  const waker = createPollWaker();
  waker.wake({ pendingIfIdle: false });
  const c = clock();
  const w1 = run(c, { value: false }, waker);
  await c.advance(1000);
  await settle();
  assert.equal(w1.result, null);
  await c.advance(POLL_INTERVAL_MS);
  await settle();
  waker.wake();
  assert.equal(await waitForNextPoll({ isActive: () => true, waker }), 'woken');
});

test('el canal cae durante una espera de 2 min: se acorta a 30 s', async () => {
  const c = clock();
  const active = { value: true };
  const w = run(c, active, createPollWaker());
  await c.advance(10_000);
  active.value = false;
  await c.advance(POLL_INTERVAL_MS - 10_000);
  await settle();
  assert.equal(w.result, 'timeout');
});

test('widget: "En vivo · respaldo en 1m 45s" con canal activo; "Próximo poll" sin canal', async () => {
  assert.equal(waitLabel(true, 105_000), 'En vivo · respaldo en 1m 45s');
  assert.equal(waitLabel(false, 30_000), 'Próximo poll: 00:00:30');
  assert.equal(formatShort(45_000), '45s');
  const c = clock();
  const ticks = [];
  run(c, { value: true }, createPollWaker(), ticks);
  await settle();
  assert.equal(ticks[0], 'En vivo · respaldo en 2m 0s');
});

test('un widget que nunca responde no cuelga la espera (regresión 2026-10-29)', async () => {
  const c = clock();
  let result = null;
  let ticks = 0;
  waitForNextPoll({
    isActive: () => false,
    waker: createPollWaker(),
    onTick: () => {
      ticks += 1;
      return new Promise(() => {}); // page.evaluate colgado
    },
    now: c.now,
    setTimeoutImpl: c.setTimeoutImpl,
    clearTimeoutImpl: c.clearTimeoutImpl,
  }).then((r) => (result = r));
  await c.advance(POLL_INTERVAL_MS);
  await settle();
  assert.equal(result, 'timeout');
  assert.equal(ticks, 1, 'no se lanzan ticks encimados mientras el anterior sigue colgado');
});
