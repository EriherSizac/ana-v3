// Cola de send-jobs sin lease (v4-harden-send-job-queue): poll, ack, summary, reassign.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddbMock } from './helpers';

const access = vi.hoisted(() => ({ value: null as any }));
vi.mock('../src/lib/access', () => ({ resolveUserAccess: async () => access.value, can: () => true }));

import { handler as jobsPoll } from '../src/handlers/jobsPoll';
import { handler as jobsAdmin } from '../src/handlers/jobsAdmin';

const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const ev = (routeKey: string, user: string, body?: unknown, qs?: Record<string, string>) =>
  ({
    routeKey,
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters: qs,
    requestContext: { authorizer: { jwt: { claims: { 'cognito:username': user } } } },
  }) as any;

const call = async (fn: any, e: any) => {
  const r = await fn(e);
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

/** Tabla base en memoria: Map operatorId → Map jobId → item (orden de jobId). */
let base: Map<string, Map<string, any>>;

function put(item: any) {
  const p = base.get(item.operatorId) ?? new Map();
  base.set(item.operatorId, p);
  p.set(item.jobId, { ...item });
}

const job = (operatorId: string, jobId: string, extra: Record<string, any> = {}) => ({
  operatorId,
  jobId,
  campaignId: jobId.split('#')[0],
  campaign: 'didi_vip',
  phone: '5512345678',
  template: 'hola',
  row: {},
  countryCode: '52',
  srcKey: 'csv-uploads/x.csv',
  status: 'pending',
  attempts: 0,
  ttl: FUTURE,
  ...extra,
});

const PAGE = 1000;

function installTable() {
  base = new Map();
  ddbMock.on(QueryCommand).callsFake((input: any) => {
    const v = input.ExpressionAttributeValues;
    let rows: any[];
    if (input.IndexName) {
      rows = [...base.values()]
        .flatMap((p) => [...p.values()])
        .filter((i) => i.campaign === v[':c'] && (!v[':o'] || i.operatorId === v[':o']));
    } else {
      rows = [...(base.get(v[':u']) ?? new Map()).values()].sort((a, b) => a.jobId.localeCompare(b.jobId));
    }
    const start = input.ExclusiveStartKey?.i ?? 0;
    const page = rows.slice(start, start + PAGE);
    return { Items: page, LastEvaluatedKey: start + PAGE < rows.length ? { i: start + PAGE } : undefined };
  });
  ddbMock.on(GetCommand).callsFake((input: any) => ({
    Item: base.get(input.Key.operatorId)?.get(input.Key.jobId),
  }));
  ddbMock.on(UpdateCommand).callsFake((input: any) => {
    const cur = base.get(input.Key.operatorId)?.get(input.Key.jobId);
    if (!cur) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    cur.status = input.ExpressionAttributeValues[':s'];
    cur.sentAt = input.ExpressionAttributeValues[':t'];
    delete cur.leaseUntil;
    return {};
  });
  ddbMock.on(TransactWriteCommand).callsFake((input: any) => {
    const [{ Delete: del }, { Put: p }] = input.TransactItems;
    const cur = base.get(del.Key.operatorId)?.get(del.Key.jobId);
    const okCond = cur && (cur.status === 'pending' || cur.status === undefined || cur.status === 'leased');
    if (!okCond) throw Object.assign(new Error('cancel'), { name: 'TransactionCanceledException' });
    base.get(del.Key.operatorId)!.delete(del.Key.jobId);
    put(p.Item);
    return {};
  });
}

beforeEach(() => {
  ddbMock.reset();
  installTable();
  vi.restoreAllMocks();
  delete process.env.JOBS_CAMPAIGN_INDEX;
});

const pad = (n: number) => String(n).padStart(5, '0');

describe('GET /jobs/poll', () => {
  it('3 pendientes + 5 enviados → 8 jobs, truncated false', async () => {
    for (let i = 0; i < 3; i++) put(job('a1', `c#${i}`));
    for (let i = 3; i < 8; i++) put(job('a1', `c#${i}`, { status: 'sent', sentAt: i }));
    put(job('a2', 'c#99')); // otra partición
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    expect(r.status).toBe(200);
    expect(r.body.jobs).toHaveLength(8);
    expect(r.body.truncated).toBe(false);
    expect(r.body.jobs.every((j: any) => j.job.operatorId === 'a1')).toBe(true);
  });

  it('2500 enviados + 40 pendientes → los 40 + 300 más recientes; historyTotal 2500', async () => {
    for (let i = 0; i < 2500; i++) put(job('a1', `old#${pad(i)}`, { status: 'sent', sentAt: 1000 + i }));
    for (let i = 0; i < 40; i++) put(job('a1', `zz#${pad(i)}`));
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    const pending = r.body.jobs.filter((j: any) => j.job.status === 'pending');
    const sent = r.body.jobs.filter((j: any) => j.job.status === 'sent');
    expect(pending).toHaveLength(40);
    expect(sent).toHaveLength(300);
    expect(sent[0].job.sentAt).toBe(1000 + 2499); // más reciente primero
    expect(r.body).toMatchObject({ truncated: false, pendingTotal: 40, historyTotal: 2500 });
  });

  it('3000 pendientes → 2000, pendingTotal 3000, truncated', async () => {
    for (let i = 0; i < 3000; i++) put(job('a1', `c#${pad(i)}`));
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    expect(r.body.jobs).toHaveLength(2000);
    expect(r.body.jobs[0].id).toBe('c#00000'); // orden de jobId
    expect(r.body).toMatchObject({ truncated: true, pendingTotal: 3000 });
  });

  it('`leased` heredado y sin estado cuentan como pendientes', async () => {
    put(job('a1', 'c#1', { status: 'leased', leaseUntil: Date.now() + 60_000 }));
    put(job('a1', 'c#2', { status: undefined }));
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    expect(r.body).toMatchObject({ pendingTotal: 2, historyTotal: 0 });
  });

  it('partición de más de 10 000 items → truncated', async () => {
    for (let i = 0; i < 10_500; i++) put(job('a1', `c#${pad(i)}`, { status: 'sent', sentAt: i }));
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    expect(r.body.truncated).toBe(true);
  });
});

describe('POST /jobs/ack', () => {
  it('no_whatsapp: marca estado y sentAt sin borrar; sigue en el historial', async () => {
    put(job('a1', 'c1#4'));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c1#4', status: 'no_whatsapp' }] }));
    expect(r.body).toEqual({ acked: 1, notFound: [], invalid: [] });
    const item = base.get('a1')!.get('c1#4');
    expect(item.status).toBe('no_whatsapp');
    expect(item.sentAt).toBeGreaterThan(0);
    const p = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    expect(p.body.jobs.map((j: any) => j.id)).toEqual(['c1#4']);
  });

  it('job inexistente o ajeno → notFound, no se crea, acked no lo cuenta', async () => {
    put(job('a2', 'c1#7'));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c1#7', status: 'sent' }] }));
    expect(r.body).toEqual({ acked: 0, notFound: ['c1#7'], invalid: [] });
    expect(base.get('a1')).toBeUndefined();
    expect(base.get('a2')!.get('c1#7').status).toBe('pending');
  });

  it('estado inválido → invalid y el job no cambia', async () => {
    put(job('a1', 'c1#5'));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c1#5', status: 'enviado' }] }));
    expect(r.body).toEqual({ acked: 0, notFound: [], invalid: ['c1#5'] });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(base.get('a1')!.get('c1#5').status).toBe('pending');
  });

  it('compat {ids} → sent', async () => {
    put(job('a1', 'c1#1'));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { ids: ['c1#1'] }));
    expect(r.body.acked).toBe(1);
    expect(base.get('a1')!.get('c1#1').status).toBe('sent');
  });
});

const LEADER = { username: 'lider', campaigns: ['didi_vip'], permissions: [], isAdmin: false, isLeader: true };

describe('GET /jobs/summary', () => {
  beforeEach(() => (access.value = LEADER));

  it('10 sent + 2 pending de a1 → pending 2; leased siempre 0', async () => {
    for (let i = 0; i < 10; i++) put(job('a1', `f1#${i}`, { status: 'sent' }));
    put(job('a1', 'f1#10'));
    put(job('a1', 'f1#11', { status: 'leased', leaseUntil: Date.now() + 60_000 }));
    const r = await call(jobsAdmin, ev('GET /jobs/summary', 'lider', undefined, { campaign: 'didi_vip' }));
    expect(r.body).toEqual({
      campaign: 'didi_vip',
      total: 2,
      operators: [{ operatorId: 'a1', pending: 2, leased: 0, review: 0, files: ['f1'] }],
    });
  });

  it('dos agentes y archivos; usa JOBS_CAMPAIGN_INDEX', async () => {
    process.env.JOBS_CAMPAIGN_INDEX = 'campaign-status-index';
    for (let i = 0; i < 10; i++) put(job('a1', `f1#${i}`));
    for (let i = 0; i < 2; i++) put(job('a2', `f2#${i}`));
    for (let i = 0; i < 2; i++) put(job('a2', `f3#${i}`));
    put(job('a2', 'f3#9', { ttl: 1 })); // vencido
    const r = await call(jobsAdmin, ev('GET /jobs/summary', 'lider', undefined, { campaign: 'didi_vip' }));
    expect(r.body.total).toBe(14);
    const a2 = r.body.operators.find((o: any) => o.operatorId === 'a2');
    expect(a2).toMatchObject({ pending: 4, files: ['f2', 'f3'] });
    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.IndexName).toBe('campaign-status-index');
  });

  it('falta campaign → 400', async () => {
    expect(await call(jobsAdmin, ev('GET /jobs/summary', 'lider'))).toEqual({ status: 400, body: { error: 'falta campaign' } });
  });
});

describe('POST /jobs/reassign', () => {
  beforeEach(() => (access.value = LEADER));
  const body = { campaign: 'didi_vip', from: 'a1', to: 'a2' };

  it('mueve pendientes; historial no se intenta ni cuenta en skipped', async () => {
    for (let i = 0; i < 3; i++) put(job('a1', `f#${i}`, { leaseUntil: 0 }));
    for (let i = 3; i < 6; i++) put(job('a1', `f#${i}`, { status: 'sent' }));
    const r = await call(jobsAdmin, ev('POST /jobs/reassign', 'lider', body));
    expect(r.body).toEqual({ campaign: 'didi_vip', from: 'a1', to: 'a2', moved: 3, skipped: 0, skippedLeased: 0, partial: false });
    expect(base.get('a2')!.size).toBe(3);
    expect(base.get('a2')!.get('f#0')).not.toHaveProperty('leaseUntil');
    expect(base.get('a1')!.size).toBe(3);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(3);
  });

  it('carrera: el job cambia a sent antes de la transacción → skipped y se queda en a1', async () => {
    put(job('a1', 'f#0'));
    put(job('a1', 'f#1'));
    ddbMock.on(GetCommand).callsFake((input: any) => {
      const it = base.get(input.Key.operatorId)?.get(input.Key.jobId);
      const copy = it ? { ...it } : undefined;
      if (input.Key.jobId === 'f#1') it.status = 'sent'; // el agente lo envía justo ahora
      return { Item: copy };
    });
    const r = await call(jobsAdmin, ev('POST /jobs/reassign', 'lider', body));
    expect(r.body).toMatchObject({ moved: 1, skipped: 1, skippedLeased: 1, partial: false });
    expect(base.get('a1')!.get('f#1').status).toBe('sent');
  });

  it('presupuesto agotado (reloj falso) → partial con remaining', async () => {
    for (let i = 0; i < 30; i++) put(job('a1', `f#${pad(i)}`));
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    ddbMock.on(TransactWriteCommand).callsFake((input: any) => {
      t += 2_000; // cada transacción "tarda" 2 s
      const [{ Delete: del }, { Put: p }] = input.TransactItems;
      base.get(del.Key.operatorId)!.delete(del.Key.jobId);
      put(p.Item);
      return {};
    });
    const r = await call(jobsAdmin, ev('POST /jobs/reassign', 'lider', body));
    expect(r.body.partial).toBe(true);
    expect(r.body.moved).toBeLessThan(30);
    expect(r.body.remaining).toBe(30 - r.body.moved - r.body.skipped);
    // Una nueva llamada mueve el resto.
    t = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    ddbMock.on(TransactWriteCommand).callsFake((input: any) => {
      const [{ Delete: del }, { Put: p }] = input.TransactItems;
      base.get(del.Key.operatorId)!.delete(del.Key.jobId);
      put(p.Item);
      return {};
    });
    const r2 = await call(jobsAdmin, ev('POST /jobs/reassign', 'lider', body));
    expect(r2.body.partial).toBe(false);
    expect(base.get('a2')!.size).toBe(30);
  });

  it('validaciones 400', async () => {
    expect((await call(jobsAdmin, ev('POST /jobs/reassign', 'lider', { campaign: 'didi_vip' }))).body).toEqual({ error: 'faltan campaign/from/to' });
    expect((await call(jobsAdmin, ev('POST /jobs/reassign', 'lider', { ...body, to: 'a1' }))).body).toEqual({ error: 'from y to son el mismo operador' });
  });
});
