import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCampaignResults, getOwnResults, postResults } from '../src/handlers/agentResults';
import type { AgentEvent } from '../src/handlers/agentAssignments';
import { getChats } from '../src/handlers/chats';
import {
  batchKey,
  buildResultsPage,
  COMPACT_THRESHOLD,
  mxDate,
  parseResultItem,
  parseResultsQuery,
  type PublicationRef,
  type ReadResult,
} from '../src/lib/sendResults';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { adminEvent, derivedList, LEADER_DIDI, LEADER_PRUEBA, mockV4Me, parse } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

/** add-agent-send-history: POST/GET /agent/results y GET /admin/campaigns/{c}/results. */
const s3mock = mockClient(S3Client);
let s3: CondS3;

const NOW = new Date('2026-10-29T18:00:00Z'); // 12:00 MX
const SRC = 'agents/prueba/ana.lopez-contacts-2026-10-29T10-00-00-000Z.csv';
const PUB = '20261029T100000-abcdef12';
const A1 = '20261029T1000-ab12cd34';

const item = (rowIndex: number, over: Record<string, unknown> = {}) => ({
  id: `${A1}#${rowIndex}#1`,
  assignmentId: A1,
  sourceKey: SRC,
  uploadId: '20261028T0900-11112222',
  rowIndex,
  attempt: 1,
  credit: `CR-${rowIndex}`,
  phone: `52550000000${rowIndex}`,
  status: 'sent',
  sentAt: '2026-10-29T17:00:00.000Z',
  messageHash: 'a'.repeat(64),
  messagePreview: 'Hola Ana, tu saldo es 1000',
  ...over,
});

const agentEv = (opts: { user?: string | null; campaign?: string; query?: Record<string, string>; body?: unknown }): AgentEvent => ({
  headers: opts.user === null ? {} : { ...bearer(signIdToken({ 'cognito:username': opts.user ?? 'Ana.Lopez' })), 'x-ana-cli-version': '1.0.51' },
  pathParameters: opts.campaign === undefined ? { campaign: 'prueba' } : { campaign: opts.campaign },
  queryStringParameters: opts.query ?? {},
  body: opts.body === undefined ? null : JSON.stringify(opts.body),
});

const resultKeys = () => [...s3.store.keys()].filter((k) => k.startsWith('results/'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  setupAgentAuth({ enforced: true });
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis']));
  s3.set(
    `agent-publications/prueba/ana.lopez/${PUB}.json`,
    JSON.stringify({ schemaVersion: 1, publishId: PUB, campaign: 'prueba', agent: 'ana.lopez', publishedAt: '2026-10-29T16:00:00.000Z', template: 'Hola {{first_name}}', contacts: 5, key: SRC }),
  );
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GET /get/chats: llave entregada', () => {
  it('responde X-Ana-Assignment-Key con la llave y el mismo CSV', async () => {
    s3.set(SRC, 'phone_number,message\n5215500000001,Hola\n');
    const res = await getChats({ headers: bearer(signIdToken({ 'cognito:username': 'ana.lopez' })), pathParameters: { agentId: 'ana.lopez', campaignId: 'prueba' } } as unknown as APIGatewayProxyEvent);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['X-Ana-Assignment-Key']).toBe(SRC);
    expect(res.body).toBe('phone_number,message\n5215500000001,Hola\n');
  });
});

describe('validación de items', () => {
  const now = NOW.getTime();
  it('normaliza teléfono, recorta textos y anula llaves ajenas', () => {
    const p = parseResultItem(item(0, { phone: '+52 55 0000 0000', messagePreview: 'x'.repeat(300), sourceKey: 'agents/prueba/luis-contacts-1.csv', uploadId: '../x' }), 'prueba', 'ana.lopez', now);
    expect(p).toMatchObject({ phone: '525500000000', sourceKey: null, uploadId: null });
    expect((p as { messagePreview: string }).messagePreview).toHaveLength(160);
  });
  it('rechaza id que no coincide, estado desconocido y fechas futuras o vencidas', () => {
    expect(parseResultItem(item(0, { id: 'otro' }), 'prueba', 'ana.lopez', now)).toEqual({ invalid: 'id inválido' });
    expect(parseResultItem(item(0, { status: 'leido' }), 'prueba', 'ana.lopez', now)).toEqual({ invalid: 'status inválido' });
    expect(parseResultItem(item(0, { sentAt: '2026-10-29T19:00:00Z' }), 'prueba', 'ana.lopez', now)).toEqual({ invalid: 'sentAt fuera de rango' });
    expect(parseResultItem(item(0, { sentAt: '2026-01-01T00:00:00Z' }), 'prueba', 'ana.lopez', now)).toEqual({ invalid: 'sentAt fuera de rango' });
  });
  it('día MX de sentAt (UTC-6)', () => {
    expect(mxDate(Date.parse('2026-10-30T05:30:00Z'))).toBe('2026-10-29');
  });
  it('query: rango por defecto de 7 días y máximo 31', () => {
    expect(parseResultsQuery({}, NOW)).toMatchObject({ from: '2026-10-23', to: '2026-10-29', sort: 'sentAt', order: 'desc', limit: 200 });
    expect(parseResultsQuery({ from: '2026-09-01', to: '2026-10-29' }, NOW)).toEqual({ error: 'El rango admite como máximo 31 días' });
    expect(parseResultsQuery({ status: 'sent,nope' }, NOW)).toEqual({ error: 'status inválido' });
    expect(parseResultsQuery({ to: '2026-02-30' }, NOW)).toEqual({ error: 'to inválido' });
  });
});

describe('POST /agent/results', () => {
  it('lote válido: un objeto por día MX con el agente del token', async () => {
    const res = await postResults(agentEv({ body: { campaign: 'Prueba', items: [item(0), item(1, { status: 'no_whatsapp' })] } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ accepted: 2, rejected: [] });
    const keys = resultKeys();
    expect(keys).toEqual([batchKey('prueba', 'ana.lopez', '2026-10-29', [`${A1}#0#1`, `${A1}#1#1`])]);
    const batch = s3.json(keys[0]!);
    expect(batch).toMatchObject({ agent: 'ana.lopez', campaign: 'prueba', cliVersion: '1.0.51' });
    expect(batch.items).toHaveLength(2);
  });

  it('el reintento del mismo lote no crea otro objeto', async () => {
    await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0)] } }));
    const res = await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0)] } }));
    expect(res.statusCode).toBe(200);
    expect(resultKeys()).toHaveLength(1);
  });

  it('items inválidos se rechazan uno a uno; los válidos se guardan', async () => {
    const res = await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0), { ...item(1), status: 'x' }] } }));
    expect(parse(res).data).toEqual({ accepted: 1, rejected: [{ index: 1, id: `${A1}#1#1`, reason: 'status inválido' }] });
  });

  it('101 items, sin token o sin roster: sin escribir en S3', async () => {
    const many = Array.from({ length: 101 }, (_, i) => item(i));
    expect((await postResults(agentEv({ body: { campaign: 'prueba', items: many } }))).statusCode).toBe(400);
    expect((await postResults(agentEv({ user: null, body: { campaign: 'prueba', items: [item(0)] } }))).statusCode).toBe(401);
    expect((await postResults(agentEv({ user: 'intruso', body: { campaign: 'prueba', items: [item(0)] } }))).statusCode).toBe(403);
    expect(s3.puts).toHaveLength(0);
  });

  it('los logs no llevan teléfonos ni mensajes', async () => {
    const log = vi.spyOn(console, 'log');
    await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0)] } }));
    const text = log.mock.calls.flat().join(' ');
    expect(text).not.toContain('5255000000');
    expect(text).not.toContain('Hola Ana');
  });
});

describe('GET /agent/results/{campaign}', () => {
  const seed = async () => {
    await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0), item(1, { status: 'no_whatsapp' }), item(2, { status: 'error', errorCode: 'send_error' })] } }));
    // Duplicado de la fila 0 en otro lote (primero gana).
    await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0, { status: 'error' }), item(3, { status: 'por_revisar' })] } }));
  };

  it('filas deduplicadas, teléfono enmascarado y agregados por publicación', async () => {
    await seed();
    const res = await getOwnResults(agentEv({}));
    expect(res.statusCode).toBe(200);
    const d = parse(res).data;
    expect(d.total).toBe(4);
    expect(d.items.find((r: any) => r.rowIndex === 0)).toMatchObject({ status: 'sent', phone: '**0000', publicationId: PUB });
    expect(JSON.stringify(d)).not.toContain('5255000000');
    expect(d.publications).toEqual([
      expect.objectContaining({ publicationId: PUB, published: 5, sent: 1, no_whatsapp: 1, error: 1, por_revisar: 1, reported: 4, pending: 1 }),
    ]);
    expect(d.summary).toMatchObject({ total: 4, sent: 1 });
  });

  it('filtros de estado, búsqueda por crédito y teléfono, orden y cursor', async () => {
    await seed();
    const only = parse(await getOwnResults(agentEv({ query: { status: 'no_whatsapp' } }))).data;
    expect(only.items.map((r: any) => r.rowIndex)).toEqual([1]);
    expect(only.publications[0].reported).toBe(4); // los agregados ignoran filtros
    expect(parse(await getOwnResults(agentEv({ query: { q: 'cr-2' } }))).data.items.map((r: any) => r.rowIndex)).toEqual([2]);
    expect(parse(await getOwnResults(agentEv({ query: { q: '0003' } }))).data.items.map((r: any) => r.rowIndex)).toEqual([3]);
    const p1 = parse(await getOwnResults(agentEv({ query: { sort: 'credit', order: 'asc', limit: '2' } }))).data;
    expect(p1.items.map((r: any) => r.credit)).toEqual(['CR-0', 'CR-1']);
    expect(p1.nextCursor).toBe('2');
    const p2 = parse(await getOwnResults(agentEv({ query: { sort: 'credit', order: 'asc', limit: '2', cursor: '2' } }))).data;
    expect(p2.items.map((r: any) => r.credit)).toEqual(['CR-2', 'CR-3']);
    expect(p2.nextCursor).toBeNull();
    expect(parse(await getOwnResults(agentEv({ query: { publicationId: 'none' } }))).data.total).toBe(0);
  });

  it('solo los resultados propios del agente', async () => {
    await seed();
    const res = await getOwnResults(agentEv({ user: 'luis' }));
    expect(parse(res).data.total).toBe(0);
  });

  it('query inválida → 400; sin roster → 403', async () => {
    expect((await getOwnResults(agentEv({ query: { from: 'ayer' } }))).statusCode).toBe(400);
    expect((await getOwnResults(agentEv({ user: 'intruso' }))).statusCode).toBe(403);
  });

  it('compacta un día con muchos lotes y lo sigue leyendo igual', async () => {
    for (let i = 0; i < COMPACT_THRESHOLD; i++) await postResults(agentEv({ body: { campaign: 'prueba', items: [item(i)] } }));
    const first = parse(await getOwnResults(agentEv({ query: { limit: '500' } }))).data;
    expect(first.total).toBe(COMPACT_THRESHOLD);
    const compactKey = 'results/prueba/ana.lopez/2026-10-29/_compact.json';
    expect(s3.json(compactKey).keys).toHaveLength(COMPACT_THRESHOLD);
    await postResults(agentEv({ body: { campaign: 'prueba', items: [item(99)] } }));
    const second = parse(await getOwnResults(agentEv({ query: { limit: '500' } }))).data;
    expect(second.total).toBe(COMPACT_THRESHOLD + 1);
  });
});

describe('GET /admin/campaigns/{campaign}/results', () => {
  const seedTwo = async () => {
    await postResults(agentEv({ body: { campaign: 'prueba', items: [item(0)] } }));
    await postResults(
      agentEv({ user: 'luis', body: { campaign: 'prueba', items: [item(5, { sourceKey: 'agents/prueba/luis-contacts-2026-10-29T10-00-00-000Z.csv', status: 'error' })] } }),
    );
  };

  it('líder de la campaña: todos los agentes o filtrado por agente', async () => {
    await seedTwo();
    mockV4Me(LEADER_PRUEBA);
    const all = parse(await getCampaignResults(adminEvent({ path: { campaign: 'prueba' } }))).data;
    expect(all.agents).toEqual(['ana.lopez', 'luis']);
    expect(all.total).toBe(2);
    expect(all.unlinked).toMatchObject({ error: 1, reported: 1 });
    const luis = parse(await getCampaignResults(adminEvent({ path: { campaign: 'prueba' }, query: { agent: 'Luis' } }))).data;
    expect(luis.items.map((r: any) => r.agent)).toEqual(['luis']);
  });

  it('fuera de alcance → 403 sin leer resultados', async () => {
    await seedTwo();
    mockV4Me(LEADER_DIDI);
    const gets = s3mock.calls().length;
    const res = await getCampaignResults(adminEvent({ path: { campaign: 'prueba' } }));
    expect(res.statusCode).toBe(403);
    expect(s3mock.calls().length).toBe(gets);
  });

  it('agent inválido → 400', async () => {
    mockV4Me(LEADER_PRUEBA);
    expect((await getCampaignResults(adminEvent({ path: { campaign: 'prueba' }, query: { agent: '../x' } }))).statusCode).toBe(400);
  });
});

describe('buildResultsPage: pendientes', () => {
  const pub = (publishedAt: string): PublicationRef => ({ publishId: PUB, agent: 'ana.lopez', publishedAt, contacts: 10, key: SRC, template: 'Hola' });
  const rows: ReadResult[] = Array.from({ length: 7 }, (_, i) => ({
    ...(parseResultItem(item(i), 'prueba', 'ana.lopez', NOW.getTime()) as any),
    agent: 'ana.lopez',
    receivedAt: NOW.toISOString(),
  }));
  const q = parseResultsQuery({ from: '2026-10-25', to: '2026-10-29' }, NOW) as any;

  it('10 publicados y 7 reportados → 3 pendientes', () => {
    expect(buildResultsPage(rows, [pub('2026-10-28T12:00:00Z')], q).publications[0]).toMatchObject({ published: 10, reported: 7, pending: 3 });
  });
  it('publicación anterior al rango → pendientes null (parcial)', () => {
    expect(buildResultsPage(rows, [pub('2026-10-20T12:00:00Z')], q).publications[0]!.pending).toBeNull();
  });
});

describe('serverless.yml: rutas del historial', () => {
  const cfg = parseYaml(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));
  it('tres funciones con su authorizer', () => {
    const ev = (f: string) => cfg.functions[f].events[0].httpApi;
    expect(ev('agentPostResults')).toEqual({ path: '/agent/results', method: 'post', authorizer: { name: 'cognitoAgentJwt' } });
    expect(ev('agentGetResults')).toEqual({ path: '/agent/results/{campaign}', method: 'get', authorizer: { name: 'cognitoAgentJwt' } });
    expect(ev('adminGetCampaignResults')).toEqual({ path: '/admin/campaigns/{campaign}/results', method: 'get', authorizer: { name: 'cognitoAdminJwt' } });
    expect(cfg.functions.agentGetResults.timeout).toBe(29);
  });
});
