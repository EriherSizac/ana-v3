import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MAX_REJECTED_MS,
  MAX_CONNECTION_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  PONG_STALE_MS,
  REFRESH_CLOSE_CODE,
  createRealtime,
  isAssignmentFor,
  isCliSettings,
  parseMessage,
  realtimeConfigFrom,
  wsSocketFactory,
} from '../realtime.js';
import { realtimeConfig } from '../config.js';
import { EventEmitter } from 'node:events';

/** Temporizadores manuales: `advance(ms)` ejecuta en orden lo que vence. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => now,
    /** Suspensión: el reloj avanza sin que corran temporizadores. */
    jump(ms) {
      now += ms;
    },
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++seq;
        pending.set(id, { fn, at: now + Math.max(0, ms) });
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, t] of pending) if (t.at <= end && t.at < nextAt) [nextId, nextAt] = [id, t.at];
        if (nextId === null) break;
        const t = pending.get(nextId);
        pending.delete(nextId);
        now = t.at;
        await t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

class FakeWs {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.sent = [];
    this.closedWith = null;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
  }
  send(d) {
    this.sent.push(d);
  }
  close(code, reason) {
    this.closedWith = { code, reason };
  }
  open() {
    this.onopen?.();
  }
  pong() {
    this.onmessage?.({ data: JSON.stringify({ type: 'pong', at: 1, exp: 2 }) });
  }
  push(o) {
    this.onmessage?.({ data: typeof o === 'string' ? o : JSON.stringify(o) });
  }
  drop(ev = { code: 1006 }) {
    this.onclose?.(ev);
  }
  pings() {
    return this.sent.filter((s) => s === '{"action":"ping"}').length;
  }
}

function setup(extra = {}) {
  const clock = fakeClock();
  const sockets = [];
  const logs = [];
  const state = { token: 'tok-1' };
  const rt = createRealtime({
    url: 'wss://abc.execute-api.us-east-2.amazonaws.com/prod',
    version: '1.0.48',
    getToken: async () => state.token,
    createSocket: (url, protocols) => {
      const ws = new FakeWs(url, protocols);
      sockets.push(ws);
      return ws;
    },
    timers: clock.timers,
    random: () => 1,
    logger: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    ...extra,
  });
  const seen = { assignment: [], settings: [], active: 0, inactive: 0, refresh: [] };
  rt.on('assignment', (e) => seen.assignment.push(e));
  rt.on('settings', (e) => seen.settings.push(e));
  rt.on('active', () => (seen.active += 1));
  rt.on('inactive', () => (seen.inactive += 1));
  rt.on('refresh', (r) => seen.refresh.push(r));
  const last = () => sockets[sockets.length - 1];
  const connected = async () => {
    rt.start();
    await flush();
    last().open();
    last().pong();
  };
  return { rt, clock, sockets, logs, state, seen, last, connected };
}

test('conexión con client=cli, versión y subprotocolo; ping al abrir; activo tras el pong', async () => {
  const s = setup();
  s.rt.start();
  await flush();
  assert.equal(s.last().url, 'wss://abc.execute-api.us-east-2.amazonaws.com/prod?client=cli&v=1.0.48');
  assert.deepEqual(s.last().protocols, ['ana.v1', 'tok-1']);
  s.last().open();
  assert.equal(s.last().pings(), 1);
  assert.equal(s.rt.isActive(), false);
  s.last().pong();
  assert.equal(s.rt.isActive(), true);
  assert.equal(s.seen.active, 1);
});

test('sin sesión Cognito no abre conexión', async () => {
  const s = setup();
  s.state.token = null;
  s.rt.start();
  await flush();
  assert.equal(s.sockets.length, 0);
});

test('pong perdido: inactivo, cierra y reconecta con backoff', async () => {
  const s = setup();
  await s.connected();
  await s.clock.advance(PING_INTERVAL_MS);
  assert.equal(s.sockets[0].pings(), 2);
  await s.clock.advance(PONG_TIMEOUT_MS);
  assert.equal(s.rt.isActive(), false);
  assert.equal(s.sockets[0].closedWith.code, 4000);
  await s.clock.advance(1000);
  assert.equal(s.sockets.length, 2);
});

test('latido cada 5 minutos durante una pausa por lote de 30 min', async () => {
  const s = setup();
  await s.connected();
  for (let i = 0; i < 6; i++) {
    await s.clock.advance(PING_INTERVAL_MS);
    s.sockets[0].pong();
  }
  assert.equal(s.sockets[0].pings(), 7);
  assert.equal(s.sockets.length, 1);
});

test('backoff 1 s, 2 s, 4 s… tope 5 min; 15 min tras 403 o 5 fallos', async () => {
  const s = setup();
  assert.deepEqual([1, 2, 3, 4].map((n) => s.rt.backoffMsFor(n)), [1000, 2000, 4000, 8000]);
  assert.equal(s.rt.backoffMsFor(12), BACKOFF_MAX_REJECTED_MS);
  assert.equal(s.rt.backoffMsFor(4), 8000);
  assert.ok(s.rt.backoffMsFor(4) <= BACKOFF_MAX_MS);
  s.rt.start();
  await flush();
  s.last().drop({ code: 1006, status: 403 });
  assert.equal(s.rt.backoffMsFor(20), BACKOFF_MAX_REJECTED_MS);
});

test('renovación del token: make-before-break', async () => {
  const s = setup();
  await s.connected();
  s.state.token = 'tok-2';
  await s.rt.renew();
  assert.equal(s.sockets.length, 2);
  assert.deepEqual(s.sockets[1].protocols, ['ana.v1', 'tok-2']);
  assert.equal(s.sockets[0].closedWith, null);
  s.sockets[1].open();
  s.sockets[1].pong();
  assert.deepEqual(s.sockets[0].closedWith, { code: 1000, reason: 'replaced' });
  assert.equal(s.seen.inactive, 0);
});

test('revisión periódica del token y reconexión a los 110 min', async () => {
  const s = setup();
  await s.connected();
  await s.clock.advance(60_000);
  assert.equal(s.sockets.length, 1); // mismo token
  s.state.token = 'tok-2';
  await s.clock.advance(60_000);
  assert.equal(s.sockets.length, 2);
  s.sockets[1].open();
  s.sockets[1].pong();
  await s.clock.advance(MAX_CONNECTION_MS);
  assert.ok(s.sockets.length >= 3);
});

test('filtro de avisos: assignment.published de la campaña de la sesión; settings scope cli', async () => {
  const s = setup();
  s.rt.setCampaign('Prueba');
  await s.connected();
  s.last().push({ v: 1, type: 'assignment.published', id: '1', at: 1, campaign: 'zendere' });
  s.last().push({ v: 1, type: 'assignment.published', id: '2', at: 1, campaign: 'prueba' });
  s.last().push({ v: 1, type: 'settings.changed', id: '3', at: 1, ref: { scope: 'desktop' } });
  s.last().push({ v: 1, type: 'settings.changed', id: '4', at: 1, ref: { scope: 'cli' } });
  s.last().push({ v: 1, type: 'chat.changed', id: '5', at: 1 });
  s.last().push('{malformado');
  assert.deepEqual(s.seen.assignment.map((e) => e.id), ['2']);
  assert.deepEqual(s.seen.settings.map((e) => e.id), ['4']);
  assert.equal(s.last().closedWith, null);
  assert.equal(isAssignmentFor({ type: 'assignment.published', campaign: 'PRUEBA' }, 'prueba'), true);
  assert.equal(isCliSettings({ type: 'settings.changed', ref: { scope: 'cli' } }), true);
});

test('session.refresh: cierre 4001, evento refresh y reconexión ≤ 10 s sin crecer el backoff', async () => {
  const s = setup({ random: () => 0.5 });
  await s.connected();
  s.last().push({ v: 1, type: 'session.refresh', id: 'r', at: 1, ref: { reason: 'settings' } });
  assert.deepEqual(s.seen.refresh, ['settings']);
  assert.equal(s.sockets[0].closedWith.code, REFRESH_CLOSE_CODE);
  s.sockets[0].drop({ code: 1005 });
  await s.clock.advance(5000);
  assert.equal(s.sockets.length, 2);
  s.sockets[1].open();
  s.sockets[1].pong();
  s.sockets[1].drop();
  assert.equal(s.rt.backoffMs(), 750);
});

test('stop(): cierra y no reconecta; el token no aparece en logs', async () => {
  const s = setup();
  s.state.token = 'secret-token-xyz';
  await s.connected();
  s.rt.stop();
  assert.deepEqual(s.sockets[0].closedWith, { code: 1000, reason: 'stop' });
  await s.clock.advance(BACKOFF_MAX_REJECTED_MS * 2);
  assert.equal(s.sockets.length, 1);
  assert.ok(!s.logs.join('\n').includes('secret-token-xyz'));
});

test('parseMessage y configuración', () => {
  assert.deepEqual(parseMessage('{"type":"pong"}'), { type: 'pong' });
  assert.equal(parseMessage('{"v":2,"type":"jobs.changed"}'), null);
  assert.deepEqual(realtimeConfigFrom({}, ''), { enabled: false, url: null, reason: 'no_url' });
  assert.deepEqual(realtimeConfigFrom({ ANA_REALTIME_URL: 'wss://x/prod' }), { enabled: true, url: 'wss://x/prod' });
  assert.deepEqual(realtimeConfigFrom({}, 'wss://default/prod'), { enabled: true, url: 'wss://default/prod' });
  assert.deepEqual(realtimeConfigFrom({ ANA_REALTIME: 'off', ANA_REALTIME_URL: 'wss://x/prod' }), { enabled: false, url: null, reason: 'flag' });
  // config.js: sin URL fijada en el repositorio → canal deshabilitado.
  assert.deepEqual(realtimeConfig({}), { enabled: true, url: 'wss://c1azskji9l.execute-api.us-east-2.amazonaws.com/prod' });
  assert.deepEqual(realtimeConfig({ ANA_REALTIME_URL: 'wss://dev/dev' }), { enabled: true, url: 'wss://dev/dev' });
});

test('adaptador de ws: eventos y status del rechazo', () => {
  class FakeLibWs extends EventEmitter {
    constructor(url, protocols, opts) {
      super();
      this.args = { url, protocols, opts };
      this.sent = [];
      FakeLibWs.last = this;
    }
    send(d) {
      this.sent.push(d);
    }
    close() {}
  }
  const sock = wsSocketFactory(FakeLibWs)('wss://x/p?client=cli', ['ana.v1', 't']);
  const got = [];
  sock.onopen = () => got.push('open');
  sock.onmessage = (e) => got.push(e.data);
  sock.onclose = (e) => got.push(e);
  const lib = FakeLibWs.last;
  assert.deepEqual(lib.args.protocols, ['ana.v1', 't']);
  lib.emit('open');
  lib.emit('message', Buffer.from('{"type":"pong"}'));
  lib.emit('error', new Error('Unexpected server response: 403'));
  lib.emit('close', 1006, Buffer.from(''));
  assert.deepEqual(got, ['open', '{"type":"pong"}', { code: 1006, reason: '', status: 403 }]);
});

test('reanudación: reconnectNow cierra la conexión vigente, reinicia el backoff y conecta de inmediato', async () => {
  const s = setup();
  await s.connected();
  s.last().drop({ code: 1006, status: 403 }); // backoff largo pendiente
  await flush();
  assert.equal(s.sockets.length, 1);
  s.rt.reconnectNow('resume');
  await flush();
  assert.equal(s.sockets.length, 2, 'conecta sin esperar el backoff');
  s.last().open();
  s.last().pong();
  assert.equal(s.rt.isActive(), true);
  assert.equal(s.rt.backoffMs(), 1000, 'backoff reiniciado');
  // Conexión viva: reconnectNow también la reemplaza (socket muerto tras suspender).
  s.rt.reconnectNow('resume');
  await flush();
  assert.equal(s.sockets[1].closedWith.code, 4000);
  assert.equal(s.sockets.length, 3);
});

test('sin pong en 2 latidos (reloj saltó) se reconecta en el siguiente ping', async () => {
  const s = setup();
  s.rt.stop();
  const s2 = setup({ now: () => s2.clock.now() });
  await s2.connected();
  s2.clock.jump(PONG_STALE_MS + 1000);
  assert.equal(s2.rt.isStale(), true);
  await s2.clock.advance(PING_INTERVAL_MS);
  assert.equal(s2.sockets[0].closedWith.code, 4000);
  assert.equal(s2.rt.isActive(), false);
  await s2.clock.advance(1000);
  assert.equal(s2.sockets.length, 2);
});

test('release.available: solo scope cli emite `release` (add-in-session-updates)', async () => {
  const s = setup();
  const releases = [];
  s.rt.on('release', (e) => releases.push(e.id));
  await s.connected();
  s.last().push({ v: 1, type: 'release.available', id: 'r1', at: 1, ref: { scope: 'desktop' } });
  s.last().push({ v: 1, type: 'release.available', id: 'r2', at: 1, ref: { scope: 'cli', source: 'v3' } });
  assert.deepEqual(releases, ['r2']);
  assert.deepEqual(s.seen.settings, []);
  assert.equal(s.last().closedWith, null);
});
