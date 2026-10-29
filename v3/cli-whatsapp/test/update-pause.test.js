import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPauseGate } from '../update-pause.js';

const tick = () => new Promise((r) => setImmediate(r));

/**
 * Ciclo falso con la forma del de index.js: por contacto revisa la compuerta
 * antes de marcar "en curso", envía y espera entre contactos con `gate.sleep`;
 * al inicio de cada iteración se estaciona si hay pausa pedida.
 */
function fakeLoop(gate, contacts, { sendMs = 5, delayMs = 50 } = {}) {
  const sent = [];
  const events = [];
  let stop = false;
  const done = (async () => {
    let next = 0;
    while (!stop && next < contacts.length) {
      if (gate.requested) {
        events.push('park');
        await gate.park({ onBeat: () => {}, beatMs: 5 });
        events.push('unpark');
        continue;
      }
      for (; next < contacts.length; next++) {
        if (gate.requested) {
          events.push(`stop-before-${contacts[next]}`);
          break;
        }
        events.push(`inflight-${contacts[next]}`);
        await new Promise((r) => setTimeout(r, sendMs));
        sent.push(contacts[next]);
        if (next < contacts.length - 1) await gate.sleep(delayMs);
      }
    }
  })();
  return { sent, events, done, stop: () => (stop = true) };
}

test('pausa pedida durante un envío: el contacto termina y el siguiente no empieza', async () => {
  const gate = createPauseGate();
  const loop = fakeLoop(gate, ['a', 'b', 'c'], { sendMs: 20, delayMs: 1000 });
  await tick(); // 'a' en curso
  const paused = gate.request();
  await paused;
  assert.deepEqual(loop.sent, ['a']);
  assert.equal(gate.parked, true);
  assert.ok(loop.events.includes('stop-before-b'));
  assert.ok(!loop.events.includes('inflight-b'));
  // Falla la actualización: se reanuda y sigue con b y c.
  gate.resume();
  await loop.done;
  assert.deepEqual(loop.sent, ['a', 'b', 'c']);
  assert.equal(gate.requested, false);
});

test('la espera entre contactos se interrumpe al pedir la pausa', async () => {
  const gate = createPauseGate();
  const started = Date.now();
  const p = gate.sleep(10_000);
  gate.request();
  assert.equal(await p, 'pause');
  assert.ok(Date.now() - started < 1000);
  assert.equal(await gate.sleep(10), 'pause'); // con pausa pedida no se duerme
  gate.resume();
  assert.equal(await gate.sleep(1), 'timeout');
});

test('request avisa una sola vez (despierta la espera entre polls) y resuelve al estacionarse', async () => {
  let wakes = 0;
  const gate = createPauseGate({ onRequest: () => (wakes += 1) });
  let resolved = false;
  void gate.request().then(() => (resolved = true));
  void gate.request();
  await tick();
  assert.equal(wakes, 1);
  assert.equal(resolved, false);
  const parking = gate.park({ beatMs: 5 });
  await tick();
  assert.equal(resolved, true);
  gate.resume();
  assert.equal(await parking, true);
});

test('park sin pausa pedida vuelve de inmediato; estacionado late', async () => {
  const gate = createPauseGate();
  assert.equal(await gate.park(), false);
  let beats = 0;
  gate.request();
  const parking = gate.park({ onBeat: () => (beats += 1), beatMs: 5 });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(beats >= 2);
  gate.resume();
  await parking;
});
