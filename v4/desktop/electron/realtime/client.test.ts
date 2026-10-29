import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MAX_REJECTED_MS,
  MAX_CONNECTION_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  REFRESH_CLOSE_CODE,
  RealtimeClient,
  connectUrl,
  isUsableUrl,
  parseEnvelope,
  type WsLike,
} from './client';

class FakeWs implements WsLike {
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  constructor(
    public url: string,
    public protocols: string[],
  ) {}
  send(d: string) {
    this.sent.push(d);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }
  // simulación del servidor
  open() {
    this.onopen?.();
  }
  pong() {
    this.onmessage?.({ data: JSON.stringify({ type: 'pong', at: 1, exp: 2 }) });
  }
  push(o: unknown) {
    this.onmessage?.({ data: typeof o === 'string' ? o : JSON.stringify(o) });
  }
  drop(ev: { code?: number; status?: number } = { code: 1006 }) {
    this.onclose?.(ev);
  }
  pings() {
    return this.sent.filter((s) => s === '{"action":"ping"}').length;
  }
}

let sockets: FakeWs[];
let token: string | null;
let states: string[];
let events: any[];
let refreshes: string[];
let confirmed: number;
let logs: string[];

function make(extra: Record<string, unknown> = {}) {
  return new RealtimeClient({
    url: 'wss://abc.execute-api.us-east-2.amazonaws.com/prod',
    client: 'desktop',
    version: '1.4.0',
    getToken: async () => token,
    createSocket: (url, protocols) => {
      const ws = new FakeWs(url, protocols);
      sockets.push(ws);
      return ws;
    },
    random: () => 1,
    logger: { log: (...a: unknown[]) => logs.push(a.join(' ')), warn: (...a: unknown[]) => logs.push(a.join(' ')) },
    onState: (s) => states.push(s),
    onEvent: (e) => events.push(e),
    onRefresh: (r) => refreshes.push(r),
    onConfirmed: () => (confirmed += 1),
    ...extra,
  });
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const last = () => sockets[sockets.length - 1]!;

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  token = 'tok-1';
  states = [];
  events = [];
  refreshes = [];
  confirmed = 0;
  logs = [];
});
afterEach(() => vi.useRealTimers());

async function connected(c: RealtimeClient) {
  c.start();
  await flush();
  last().open();
  last().pong();
}

describe('RealtimeClient: conexión', () => {
  it('abre con client/v y subprotocolo ana.v1 + token; envía ping al abrir', async () => {
    const c = make();
    c.start();
    await flush();
    expect(last().url).toBe('wss://abc.execute-api.us-east-2.amazonaws.com/prod?client=desktop&v=1.4.0');
    expect(last().protocols).toEqual(['ana.v1', 'tok-1']);
    last().open();
    expect(last().pings()).toBe(1);
    expect(c.isActive()).toBe(false);
  });

  it('activo solo tras el primer pong; lectura al confirmar', async () => {
    const c = make();
    await connected(c);
    expect(c.isActive()).toBe(true);
    expect(states).toEqual(['active']);
    expect(confirmed).toBe(1);
  });

  it('sin pong en 30 s → inactivo, cierra y reconecta con backoff', async () => {
    const c = make();
    await connected(c);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(sockets[0].pings()).toBe(2);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(c.isActive()).toBe(false);
    expect(sockets[0].closedWith?.code).toBe(4000);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('latido cada 5 min durante una hora', async () => {
    const c = make();
    await connected(c);
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
      sockets[0].pong();
    }
    expect(sockets[0].pings()).toBe(13);
    expect(sockets).toHaveLength(1);
    expect(c.isActive()).toBe(true);
  });

  it('cierre de sesión: cierra y no reabre', async () => {
    const c = make();
    await connected(c);
    c.stop();
    expect(sockets[0].closedWith).toEqual({ code: 1000, reason: 'stop' });
    expect(states).toEqual(['active', 'inactive']);
    vi.advanceTimersByTime(BACKOFF_MAX_REJECTED_MS * 2);
    await flush();
    expect(sockets).toHaveLength(1);
  });

  it('el token nunca aparece en los logs', async () => {
    token = 'secret-token-xyz';
    const c = make();
    await connected(c);
    c.stop();
    expect(logs.join('\n')).not.toContain('secret-token-xyz');
  });
});

describe('RealtimeClient: backoff', () => {
  it('esperas crecientes 1 s, 2 s, 4 s… hasta 5 min; se reinician tras confirmar', async () => {
    const c = make();
    c.start();
    await flush();
    const waits: number[] = [];
    for (let i = 0; i < 12; i++) waits.push(c.backoffMsFor(i + 1));
    expect(waits.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(Math.max(...waits.slice(0, 4))).toBeLessThanOrEqual(BACKOFF_MAX_MS);
    // 3 fallos seguidos y luego confirma
    for (let i = 0; i < 3; i++) {
      last().drop();
      vi.advanceTimersByTime(BACKOFF_MAX_MS);
      await flush();
    }
    expect(sockets).toHaveLength(4);
    last().open();
    last().pong();
    last().drop();
    expect(c.backoffMs()).toBe(1000);
  });

  it('tras 5 fallos o un 403 la espera puede llegar a 15 min', async () => {
    const c = make();
    c.start();
    await flush();
    last().drop({ status: 403 });
    expect(c.backoffMsFor(20)).toBe(BACKOFF_MAX_REJECTED_MS);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('red caída 3 min: reconecta en máximo 5 min al volver', async () => {
    const c = make();
    await connected(c);
    sockets[0].drop();
    let elapsed = 0;
    while (elapsed < 3 * 60_000) {
      vi.advanceTimersByTime(5000);
      elapsed += 5000;
      await flush();
      if (last().onclose && !last().closedWith && sockets.length > 1) last().drop();
    }
    const before = sockets.length;
    vi.advanceTimersByTime(BACKOFF_MAX_MS);
    await flush();
    expect(sockets.length).toBeGreaterThan(before);
    last().open();
    last().pong();
    expect(c.isActive()).toBe(true);
  });
});

describe('RealtimeClient: reconexión planeada', () => {
  it('token renovado: abre otra conexión y cierra la anterior tras su pong', async () => {
    const c = make();
    await connected(c);
    token = 'tok-2';
    await c.renew();
    expect(sockets).toHaveLength(2);
    expect(sockets[1].protocols).toEqual(['ana.v1', 'tok-2']);
    expect(sockets[0].closedWith).toBeNull();
    sockets[1].open();
    sockets[1].pong();
    expect(sockets[0].closedWith).toEqual({ code: 1000, reason: 'replaced' });
    expect(c.isActive()).toBe(true);
    expect(states).toEqual(['active']); // nunca pasó por inactivo
  });

  it('mismo token: no reconecta; a los 110 min sí', async () => {
    const c = make();
    await connected(c);
    await c.renew();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(MAX_CONNECTION_MS);
    await flush();
    expect(sockets).toHaveLength(2);
  });
});

describe('RealtimeClient: eventos y actualización forzada', () => {
  it('entrega eventos del catálogo; ignora desconocidos y JSON inválido sin cerrar', async () => {
    const c = make();
    await connected(c);
    sockets[0].push({ v: 1, type: 'jobs.changed', id: 'e1', at: 1, campaign: 'prueba' });
    sockets[0].push({ v: 1, type: 'chat.changed', id: 'e2', at: 1 });
    sockets[0].push('{no json');
    expect(events.map((e) => e.type)).toEqual(['jobs.changed']);
    expect(sockets[0].closedWith).toBeNull();
  });

  it('session.refresh: cierra con 4001, avisa y reconecta en ≤ 10 s sin crecer el backoff', async () => {
    const c = make({ random: () => 0.5 });
    await connected(c);
    sockets[0].push({ v: 1, type: 'session.refresh', id: 'r', at: 1, ref: { reason: 'permissions' } });
    expect(refreshes).toEqual(['permissions']);
    expect(sockets[0].closedWith?.code).toBe(REFRESH_CLOSE_CODE);
    sockets[0].drop({ code: 1005 }); // el servidor también cierra
    vi.advanceTimersByTime(5000);
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].pong();
    sockets[1].drop();
    expect(c.backoffMs()).toBe(750); // espera de una caída normal: el refresco no contó como fallo
  });
});

describe('helpers', () => {
  it('parseEnvelope, connectUrl, isUsableUrl', () => {
    expect(parseEnvelope('{"type":"pong"}')).toEqual({ type: 'pong' });
    expect(parseEnvelope('{"v":2,"type":"jobs.changed"}')).toBeNull();
    expect(connectUrl('wss://x/prod', 'cli', '1.0')).toBe('wss://x/prod?client=cli&v=1.0');
    expect(isUsableUrl('wss://x/prod')).toBe(true);
    expect(isUsableUrl('')).toBe(false);
    expect(isUsableUrl('https://x')).toBe(false);
    expect(isUsableUrl('ws://evil.example')).toBe(false);
  });
});

describe('RealtimeClient: reconnectNow (harden-client-resume)', () => {
  it('descarta el socket previo y abre uno nuevo de inmediato, con backoff reiniciado', async () => {
    const c = make();
    await connected(c);
    const old = last();
    // Rechazo previo a suspender: no debe alargar la reconexión.
    old.drop({ code: 1006, status: 403 });
    await flush();
    c.reconnectNow();
    await flush();
    expect(sockets.length).toBe(2);
    expect(last()).not.toBe(old);
    expect(c.backoffMsFor(1)).toBeLessThanOrEqual(1000);
    last().open();
    last().pong();
    expect(c.isActive()).toBe(true);
  });

  it('cierra la conexión viva aunque parezca sana; sin iniciar no hace nada', async () => {
    const c = make();
    c.reconnectNow();
    await flush();
    expect(sockets.length).toBe(0);
    await connected(c);
    const old = last();
    c.reconnectNow();
    await flush();
    expect(old.closedWith?.reason).toBe('resume');
    expect(sockets.length).toBe(2);
    expect(states.at(-1)).toBe('inactive');
  });
});
