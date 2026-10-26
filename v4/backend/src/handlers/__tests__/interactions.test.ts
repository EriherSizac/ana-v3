import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFakeJobsTable } from '../../lib/__tests__/fakeJobsTable';
import { handler } from '../interactions';

process.env.CONVERSATIONS_TABLE = 'conv';
process.env.JOBS_TABLE = 'jobs';

// Conversación guardada con campaña (para open/manual).
const CONV = { operatorId: 'ana', chatId: '5215512345678@c.us', campaign: 'bancoppel', contact: { credito: 'C-1' } };

let table: ReturnType<typeof installFakeJobsTable>;
let crmOk: boolean[];
let crmCalls: any[];

beforeEach(() => {
  table?.ddbMock.restore();
  table = installFakeJobsTable((key) => (key.chatId ? CONV : undefined));
  crmOk = [];
  crmCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/interactions')) {
        crmCalls.push(JSON.parse(String(init?.body)).interactions[0]);
        const okNow = crmOk.length ? crmOk.shift()! : true;
        return new Response('{}', { status: okNow ? 200 : 502 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ev = (routeKey: string, body: unknown) =>
  ({
    routeKey,
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': 'ana' } } } },
  }) as any;
const call = async (routeKey: string, body: unknown) => {
  const r: any = await handler(ev(routeKey, body));
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const report = { jobId: 'j1', campaign: 'bancoppel', phone: '5512345678', status: 'sent', row: { credito: 'C-1' } };

describe('POST /interactions/report', () => {
  it('dos reportes del mismo job: solo el primero inserta', async () => {
    expect((await call('POST /interactions/report', report)).body).toMatchObject({ reported: true });
    expect((await call('POST /interactions/report', report)).body).toEqual({ reported: false, reason: 'ya reportado' });
    expect(crmCalls).toHaveLength(1);
  });

  it('CRM caído y reintento: retryable y luego inserta una sola vez', async () => {
    crmOk = [false];
    expect((await call('POST /interactions/report', report)).body).toMatchObject({ reported: false, retryable: true });
    expect((await call('POST /interactions/report', report)).body).toMatchObject({ reported: true });
    expect((await call('POST /interactions/report', report)).body).toEqual({ reported: false, reason: 'ya reportado' });
    expect(crmCalls).toHaveLength(2); // 1 fallida + 1 exitosa
  });

  it('reserva en curso → "en curso" sin llamar al CRM', async () => {
    table.items.set('REPORT#ana|j1', { operatorId: 'REPORT#ana', jobId: 'j1', status: 'pending', claimedAt: Date.now() });
    expect((await call('POST /interactions/report', report)).body).toEqual({ reported: false, reason: 'en curso' });
    expect(crmCalls).toHaveLength(0);
  });

  it('reserva abandonada hace > 2 min se puede volver a reservar', async () => {
    table.items.set('REPORT#ana|j1', {
      operatorId: 'REPORT#ana',
      jobId: 'j1',
      status: 'pending',
      claimedAt: Date.now() - 3 * 60_000,
    });
    expect((await call('POST /interactions/report', report)).body).toMatchObject({ reported: true });
  });
});

describe('POST /interactions/open', () => {
  const open = { chatId: CONV.chatId };

  it('17:00 y 19:00 del mismo día de México → una sola interacción', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T23:00:00Z')); // 17:00 MX
    expect((await call('POST /interactions/open', open)).body).toMatchObject({ reported: true });
    vi.setSystemTime(new Date('2026-11-06T01:00:00Z')); // 19:00 MX (otro día UTC)
    expect((await call('POST /interactions/open', open)).body).toEqual({ reported: false, reason: 'ya registrado hoy' });
    expect(crmCalls).toHaveLength(1);
    expect(table.items.has(`OPEN#ana|${CONV.chatId}#2026-11-05`)).toBe(true);
  });

  it('si el CRM falla, la siguiente apertura del día registra', async () => {
    crmOk = [false];
    expect((await call('POST /interactions/open', open)).body).toMatchObject({ reported: false, retryable: true });
    expect((await call('POST /interactions/open', open)).body).toMatchObject({ reported: true });
  });
});

describe('POST /interactions/manual', () => {
  const manual = { chatId: CONV.chatId, subdictamen: 'Promesa de pago' };

  it('mismo requestId dos veces → un solo fetch al CRM', async () => {
    const body = { ...manual, requestId: '6f1c2a9e-0b7d-4c1e-9f3a-2d4b5c6e7f80' };
    expect((await call('POST /interactions/manual', body)).body).toMatchObject({ reported: true });
    expect((await call('POST /interactions/manual', body)).body).toEqual({ reported: false, reason: 'ya reportado' });
    expect(crmCalls).toHaveLength(1);
  });

  it('sin requestId → dos registros', async () => {
    await call('POST /interactions/manual', manual);
    await call('POST /interactions/manual', manual);
    expect(crmCalls).toHaveLength(2);
  });

  it('requestId inválido → 400', async () => {
    expect((await call('POST /interactions/manual', { ...manual, requestId: 'x y' })).status).toBe(400);
  });
});
