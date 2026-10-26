// Reserva, paso a revisión, acuse y resolución (v4-review-interrupted-sends).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbMock } from './helpers';

const access = vi.hoisted(() => ({ value: null as any }));
vi.mock('../src/lib/access', () => ({
  resolveUserAccess: async () => access.value,
  can: () => true,
  canRoute: () => true,
  routeAllowed: async () => true,
}));

import { handler as jobsPoll } from '../src/handlers/jobsPoll';
import { handler as jobsAdmin } from '../src/handlers/jobsAdmin';
import { classify, isReviewDue, REVIEW_AFTER_MS } from '../src/lib/jobs';

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const MIN = 60_000;

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

// ---------- Tabla en memoria que evalúa las condiciones usadas por los handlers ----------
let base: Map<string, any>;
const k = (o: string, j: string) => `${o}|${j}`;
const get = (o: string, j: string) => base.get(k(o, j));
const put = (item: any) => base.set(k(item.operatorId, item.jobId), { ...item });
const ccf = () => Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });

function condOk(cond: string | undefined, cur: any, v: Record<string, any>): boolean {
  if (!cond) return true;
  const s = cur?.status;
  switch (cond) {
    case 'attribute_exists(jobId) AND (#s = :pending OR attribute_not_exists(#s) OR #s = :leased)':
      return !!cur && (s === undefined || s === 'pending' || s === 'leased');
    case '#s = :sending AND claimedAt < :cutoff':
      return !!cur && s === 'sending' && cur.claimedAt < v[':cutoff'];
    case 'attribute_exists(jobId) AND (attribute_not_exists(#s) OR #s IN (:pending, :leased, :sending, :review, :s))':
      return !!cur && (s === undefined || ['pending', 'leased', 'sending', 'review', v[':s']].includes(s));
    case '#s = :review':
      return !!cur && s === 'review';
    case 'attribute_not_exists(jobId)':
      return !cur;
    case '#s = :pending OR attribute_not_exists(#s) OR #s = :leased':
      return !!cur && (s === undefined || s === 'pending' || s === 'leased');
    default:
      throw new Error(`condición no soportada: ${cond}`);
  }
}

function applyUpdate(cur: any, expr: string, names: Record<string, string> = {}, v: Record<string, any>) {
  const out = { ...cur };
  const parts = expr.split(/\s(?=SET |ADD |REMOVE )/);
  for (const p of parts) {
    const [kw, ...rest] = p.trim().split(' ');
    const body = rest.join(' ');
    for (const clause of body.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (kw === 'SET') {
        const [n, val] = clause.split('=').map((x) => x.trim());
        out[names[n] ?? n] = v[val];
      } else if (kw === 'ADD') {
        const [n, val] = clause.split(/\s+/);
        out[n] = (out[n] ?? 0) + v[val];
      } else if (kw === 'REMOVE') delete out[names[clause] ?? clause];
    }
  }
  return out;
}

function installTable() {
  base = new Map();
  ddbMock.on(QueryCommand).callsFake((input: any) => {
    const v = input.ExpressionAttributeValues;
    const rows = [...base.values()]
      .filter((i) => (input.IndexName ? i.campaign === v[':c'] && (!v[':o'] || i.operatorId === v[':o']) : i.operatorId === v[':u']))
      .sort((a, b) => a.jobId.localeCompare(b.jobId));
    return { Items: rows.map((r) => ({ ...r })) };
  });
  ddbMock.on(GetCommand).callsFake((input: any) => {
    const it = get(input.Key.operatorId, input.Key.jobId);
    return { Item: it ? { ...it } : undefined };
  });
  ddbMock.on(BatchGetCommand).callsFake((input: any) => {
    const keys = input.RequestItems['jobs-test'].Keys as any[];
    return { Responses: { 'jobs-test': keys.map((x) => get(x.operatorId, x.jobId)).filter(Boolean).map((x) => ({ ...x })) } };
  });
  ddbMock.on(UpdateCommand).callsFake((input: any) => {
    const cur = get(input.Key.operatorId, input.Key.jobId);
    const v = input.ExpressionAttributeValues ?? {};
    if (!condOk(input.ConditionExpression, cur, v)) throw ccf();
    const next = applyUpdate(cur, input.UpdateExpression, input.ExpressionAttributeNames, v);
    put(next);
    return { Attributes: input.ReturnValues === 'ALL_NEW' ? { ...next } : undefined };
  });
  ddbMock.on(PutCommand).callsFake((input: any) => {
    if (!condOk(input.ConditionExpression, get(input.Item.operatorId, input.Item.jobId), input.ExpressionAttributeValues ?? {})) throw ccf();
    put(input.Item);
    return {};
  });
  ddbMock.on(TransactWriteCommand).callsFake((input: any) => {
    const ops = input.TransactItems as any[];
    for (const op of ops) {
      const o = op.Update ?? op.Put ?? op.Delete;
      const key = op.Put ? op.Put.Item : o.Key;
      if (!condOk(o.ConditionExpression, get(key.operatorId, key.jobId), o.ExpressionAttributeValues ?? {}))
        throw Object.assign(new Error('cancel'), { name: 'TransactionCanceledException' });
    }
    for (const op of ops) {
      if (op.Update) {
        const u = op.Update;
        put(applyUpdate(get(u.Key.operatorId, u.Key.jobId), u.UpdateExpression, u.ExpressionAttributeNames, u.ExpressionAttributeValues));
      } else if (op.Put) put(op.Put.Item);
      else if (op.Delete) base.delete(k(op.Delete.Key.operatorId, op.Delete.Key.jobId));
    }
    return {};
  });
}

const job = (operatorId: string, jobId: string, extra: Record<string, any> = {}) => ({
  operatorId,
  jobId,
  campaignId: jobId.split('#')[0],
  campaign: 'didi_vip',
  phone: '5512345678',
  template: 'hola {nombre}',
  row: { nombre: 'Ana' },
  countryCode: '52',
  srcKey: 'csv-uploads/lider/1_a.csv',
  status: 'pending',
  attempts: 0,
  ttl: FUTURE,
  ...extra,
});

const LEADER = { username: 'lider', campaigns: ['didi_vip'], permissions: [], isAdmin: false, isLeader: true };

beforeEach(() => {
  ddbMock.reset();
  installTable();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  access.value = LEADER;
  process.env.JOBS_CAMPAIGN_INDEX = 'campaign-status-index';
});

describe('classify', () => {
  const now = 10_000_000;
  it('cada estado', () => {
    expect(classify({ status: 'pending' }, now)).toBe('pending');
    expect(classify({}, now)).toBe('pending');
    expect(classify({ status: 'leased' }, now)).toBe('pending');
    expect(classify({ status: 'review' }, now)).toBe('review');
    for (const s of ['sent', 'no_whatsapp', 'error', 'discarded']) expect(classify({ status: s }, now)).toBe('final');
  });
  it('umbral exacto de 10 min', () => {
    expect(classify({ status: 'sending', claimedAt: now - REVIEW_AFTER_MS }, now)).toBe('sending');
    expect(isReviewDue({ status: 'sending', claimedAt: now - REVIEW_AFTER_MS }, now)).toBe(false);
    expect(classify({ status: 'sending', claimedAt: now - REVIEW_AFTER_MS - 1 }, now)).toBe('review');
  });
});

describe('POST /jobs/claim', () => {
  it('pending → 200, sending con claimedAt y attempts + 1', async () => {
    put(job('a1', 'c#1'));
    const r = await call(jobsPoll, ev('POST /jobs/claim', 'a1', { jobId: 'c#1' }));
    expect(r).toEqual({ status: 200, body: { claimed: true } });
    expect(get('a1', 'c#1')).toMatchObject({ status: 'sending', attempts: 1 });
    expect(get('a1', 'c#1').claimedAt).toBeGreaterThan(0);
  });

  it.each([
    ['sending', 'sending'],
    ['sent', 'sent'],
  ])('%s → 409 con status', async (s, expected) => {
    put(job('a1', 'c#1', { status: s }));
    const r = await call(jobsPoll, ev('POST /jobs/claim', 'a1', { jobId: 'c#1' }));
    expect(r).toEqual({ status: 409, body: { error: 'job no disponible', status: expected } });
  });

  it('inexistente (reasignado) → 409 status null y no se crea', async () => {
    put(job('a2', 'c#1'));
    const r = await call(jobsPoll, ev('POST /jobs/claim', 'a1', { jobId: 'c#1' }));
    expect(r).toEqual({ status: 409, body: { error: 'job no disponible', status: null } });
    expect(get('a1', 'c#1')).toBeUndefined();
  });
});

describe('GET /jobs/poll con reservas', () => {
  it('reservado hace 11 min → review; hace 5 min → sigue sending', async () => {
    put(job('a1', 'c#1', { status: 'sending', claimedAt: Date.now() - 11 * MIN }));
    put(job('a1', 'c#2', { status: 'sending', claimedAt: Date.now() - 5 * MIN }));
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    const byId = Object.fromEntries(r.body.jobs.map((j: any) => [j.id, j.job]));
    expect(byId['c#1']).toMatchObject({ status: 'review', reviewReason: 'interrupted' });
    expect(byId['c#2'].status).toBe('sending');
    expect(get('a1', 'c#1').reviewAt).toBeGreaterThan(0);
  });

  it('5 pendientes + 1 review → los 6; discarded va con los finales', async () => {
    for (let i = 0; i < 5; i++) put(job('a1', `c#${i}`));
    put(job('a1', 'c#9', { status: 'review' }));
    put(job('a1', 'c#8', { status: 'discarded', resolvedAt: 5 }));
    const r = await call(jobsPoll, ev('GET /jobs/poll', 'a1'));
    expect(r.body.jobs).toHaveLength(7);
    expect(r.body).toMatchObject({ pendingTotal: 6, historyTotal: 1 });
    expect(r.body.jobs[r.body.jobs.length - 1].id).toBe('c#8');
  });
});

describe('POST /jobs/ack transiciones', () => {
  it('acuse tardío: review → sent', async () => {
    put(job('a1', 'c#1', { status: 'review' }));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c#1', status: 'sent' }] }));
    expect(r.body).toEqual({ acked: 1, notFound: [], invalid: [] });
    expect(get('a1', 'c#1').status).toBe('sent');
  });

  it('desde sending y repetido (reintento) → acked', async () => {
    put(job('a1', 'c#1', { status: 'sending', claimedAt: 1 }));
    await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c#1', status: 'no_whatsapp' }] }));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c#1', status: 'no_whatsapp' }] }));
    expect(r.body.acked).toBe(1);
  });

  it('acuse de un descartado → invalid y sigue discarded', async () => {
    put(job('a1', 'c#1', { status: 'discarded' }));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c#1', status: 'sent' }] }));
    expect(r.body).toEqual({ acked: 0, notFound: [], invalid: ['c#1'] });
    expect(get('a1', 'c#1').status).toBe('discarded');
  });

  it('final con otro estado → invalid', async () => {
    put(job('a1', 'c#1', { status: 'sent' }));
    const r = await call(jobsPoll, ev('POST /jobs/ack', 'a1', { acks: [{ jobId: 'c#1', status: 'error' }] }));
    expect(r.body.invalid).toEqual(['c#1']);
  });
});

describe('GET /jobs/summary con por revisar', () => {
  it('3 pendientes + 2 review → pending 3, review 2, total 3; solo-review también aparece', async () => {
    for (let i = 0; i < 3; i++) put(job('a1', `c#${i}`));
    put(job('a1', 'c#7', { status: 'review' }));
    put(job('a1', 'c#8', { status: 'sending', claimedAt: Date.now() - 15 * MIN })); // pasa a review
    put(job('a2', 'c#9', { status: 'review' }));
    const r = await call(jobsAdmin, ev('GET /jobs/summary', 'lider', undefined, { campaign: 'didi_vip' }));
    expect(r.body.total).toBe(3);
    expect(r.body.operators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operatorId: 'a1', pending: 3, review: 2 }),
        expect.objectContaining({ operatorId: 'a2', pending: 0, review: 1 }),
      ]),
    );
  });
});

describe('GET /jobs/review', () => {
  beforeEach(() => {
    put(job('a1', 'c#1', { status: 'review', srcKey: 'csv-uploads/lider/1_a.csv', reviewAt: 9 }));
    put(job('a2', 'c#2', { status: 'discarded', resolution: 'discarded', resolvedBy: 'lider', resolvedAt: 10, srcKey: 'csv-uploads/lider/1_a.csv' }));
    put(job('a1', 'd#1', { status: 'review', srcKey: 'csv-uploads/lider/2_b.csv' }));
    put(job('a1', 'c#3', { status: 'pending', srcKey: 'csv-uploads/lider/1_a.csv' }));
    put(job('a1', 'direct#1', { status: 'review', srcKey: '', auto: true }));
  });

  it('filtra por srcKey e incluye fila y teléfono', async () => {
    const r = await call(jobsAdmin, ev('GET /jobs/review', 'lider', undefined, { campaign: 'didi_vip', srcKey: 'csv-uploads/lider/1_a.csv' }));
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: any) => i.jobId)).toEqual(['c#1', 'c#2']);
    expect(r.body.items[0]).toMatchObject({ operatorId: 'a1', phone: '5512345678', row: { nombre: 'Ana' }, status: 'review', reviewAt: 9 });
    expect(r.body.items[1]).toMatchObject({ status: 'discarded', resolution: 'discarded', resolvedBy: 'lider' });
  });

  it('por campaña incluye el envío directo', async () => {
    const r = await call(jobsAdmin, ev('GET /jobs/review', 'lider', undefined, { campaign: 'didi_vip' }));
    expect(r.body.items).toHaveLength(4);
    expect(r.body.items.find((i: any) => i.jobId === 'direct#1')).toMatchObject({ auto: true, srcKey: '' });
  });

  it('campaña ajena → 403; sin campaign → 400', async () => {
    expect(await call(jobsAdmin, ev('GET /jobs/review', 'lider', undefined, { campaign: 'zendere' }))).toEqual({ status: 403, body: { error: 'sin permiso' } });
    expect(await call(jobsAdmin, ev('GET /jobs/review', 'lider'))).toEqual({ status: 400, body: { error: 'falta campaign' } });
  });
});

describe('POST /jobs/review/resolve', () => {
  const resolve = (body: any) => call(jobsAdmin, ev('POST /jobs/review/resolve', 'lider', body));

  it('descartar: discarded con autor y fecha', async () => {
    put(job('a1', 'c#1', { status: 'review' }));
    const r = await resolve({ campaign: 'didi_vip', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'discard' });
    expect(r.body.results).toEqual([{ jobId: 'c#1', operatorId: 'a1', ok: true }]);
    expect(get('a1', 'c#1')).toMatchObject({ status: 'discarded', resolution: 'discarded', resolvedBy: 'lider' });
    expect(get('a1', 'c#1').resolvedAt).toBeGreaterThan(0);
  });

  it('reencolar a otro agente: job pending nuevo con la misma fila; original requeued', async () => {
    put(job('a1', 'c#1', { status: 'review', claimedAt: 1, reviewAt: 2, label: 'cartera-52' }));
    const r = await resolve({ campaign: 'didi_vip', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'requeue', to: 'a2' });
    const res = r.body.results[0];
    expect(res).toMatchObject({ ok: true, to: 'a2' });
    expect(res.newJobId).toMatch(/^c#1~r\d+$/);
    expect(get('a1', 'c#1')).toMatchObject({ status: 'discarded', resolution: 'requeued', requeuedTo: 'a2' });
    const n = get('a2', res.newJobId);
    expect(n).toMatchObject({ status: 'pending', row: { nombre: 'Ana' }, template: 'hola {nombre}', label: 'cartera-52', srcKey: 'csv-uploads/lider/1_a.csv', requeuedFrom: 'a1/c#1', attempts: 0 });
    expect(n).not.toHaveProperty('claimedAt');
    expect(n).not.toHaveProperty('reviewAt');
  });

  it('sin `to` reencola al mismo agente', async () => {
    put(job('a1', 'c#1', { status: 'review' }));
    const r = await resolve({ campaign: 'didi_vip', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'requeue' });
    expect(get('a1', r.body.results[0].newJobId).status).toBe('pending');
  });

  it('ya resuelto → ok false y no se crea job', async () => {
    put(job('a1', 'c#1', { status: 'discarded' }));
    const before = base.size;
    const r = await resolve({ campaign: 'didi_vip', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'requeue', to: 'a2' });
    expect(r.body.results[0]).toMatchObject({ ok: false });
    expect(base.size).toBe(before);
  });

  it('job de otra campaña → ok false', async () => {
    put(job('a1', 'c#1', { status: 'review', campaign: 'zendere' }));
    const r = await resolve({ campaign: 'didi_vip', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'discard' });
    expect(r.body.results[0]).toMatchObject({ ok: false, error: 'no encontrado' });
    expect(get('a1', 'c#1').status).toBe('review');
  });

  it('validaciones: 0 o 101 items, acción inválida, campaña ajena', async () => {
    expect((await resolve({ campaign: 'didi_vip', items: [], action: 'discard' })).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => ({ operatorId: 'a1', jobId: `c#${i}` }));
    expect((await resolve({ campaign: 'didi_vip', items: many, action: 'discard' })).status).toBe(400);
    expect((await resolve({ campaign: 'didi_vip', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'x' })).status).toBe(400);
    expect((await resolve({ campaign: 'zendere', items: [{ operatorId: 'a1', jobId: 'c#1' }], action: 'discard' })).status).toBe(403);
  });
});

describe('serverless.yml: rutas de reserva y revisión', () => {
  it('claim en jobsPoll; review y resolve en jobsAdmin, con authorizer JWT', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parse } = await import('yaml');
    const tags = ['!Sub', '!GetAtt', '!Ref'].map((tag) => ({ tag, resolve: (v: string) => ({ [tag.slice(1)]: v }) }));
    const sls = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'), { customTags: tags as any });
    const routes = (fn: string) => sls.functions[fn].events.map((e: any) => e.httpApi).filter(Boolean);
    const jwt = { name: 'cognitoJwt' };
    expect(routes('jobsPoll')).toContainEqual({ path: '/jobs/claim', method: 'post', authorizer: jwt });
    expect(routes('jobsAdmin')).toContainEqual({ path: '/jobs/review', method: 'get', authorizer: jwt });
    expect(routes('jobsAdmin')).toContainEqual({ path: '/jobs/review/resolve', method: 'post', authorizer: jwt });
  });
});
