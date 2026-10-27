// Canal realtime (add-realtime-gateway): librería, WebSocket ($connect/$disconnect/ping),
// reparto (notify), puente v3, actualización forzada, interruptor y serverless.yml.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { mockClient } from 'aws-sdk-client-mock';
import { BatchWriteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { ddbMock } from './helpers';

const access = vi.hoisted(() => ({ byUser: {} as Record<string, any>, fail: new Set<string>() }));
vi.mock('../src/lib/access', () => ({
  resolveUserAccess: async (u: string) => {
    if (access.fail.has(u)) throw Object.assign(new Error('roles down'), { name: 'RolesApiError' });
    return access.byUser[u] ?? { username: u, roleIds: [], campaigns: [], permissions: [], isAdmin: false };
  },
}));

import {
  buildEnvelope,
  connectionTopics,
  emitRealtime,
  eventTopics,
  forceRefresh,
  forceTopics,
  setEventBridgeClientForTests,
  validateEmit,
} from '../src/lib/realtime';
import { authorizer, connect, disconnect, fallback, ping, setVerifierForTests, tokenFromSubprotocol } from '../src/handlers/realtime';
import { handler as notify, MAX_EVENT_AGE_MS } from '../src/handlers/notify';
import { handler as stats } from '../src/handlers/realtimeStats';
import { handler as realtimeAdmin, parseRefreshBody } from '../src/handlers/realtimeAdmin';
import { translateS3 } from '../src/lib/realtimeBridge';
import { resetManagementClientsForTests } from '../src/lib/realtimePush';

const ebMock = mockClient(EventBridgeClient);
const apiMock = mockClient(ApiGatewayManagementApiClient);

// ---------- tabla realtime en memoria ----------
let rows: Map<string, any>;
const k = (pk: string, sk: string) => `${pk}|${sk}`;
function installRealtimeTable() {
  rows = new Map();
  ddbMock.on(BatchWriteCommand).callsFake((input: any) => {
    for (const r of input.RequestItems['realtime-test'] ?? []) {
      if (r.PutRequest) rows.set(k(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
      if (r.DeleteRequest) rows.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
    }
    return {};
  });
  ddbMock.on(GetCommand, { TableName: 'realtime-test' }).callsFake((input: any) => ({ Item: rows.get(k(input.Key.PK, input.Key.SK)) }));
  ddbMock.on(QueryCommand, { TableName: 'realtime-test' }).callsFake((input: any) => {
    const items = [...rows.values()].filter((i) => i.PK === input.ExpressionAttributeValues[':t']);
    return input.Select === 'COUNT' ? { Count: items.length } : { Items: items };
  });
}
const topicsOf = (id: string) => [...rows.values()].filter((r) => r.SK === id && r.PK !== `conn#${id}`).map((r) => r.PK).sort();

// ---------- API de administración ----------
let posts: { id: string; data: any }[];
let deletes: string[];
let gone: Set<string>;
function installApi() {
  posts = [];
  deletes = [];
  gone = new Set();
  apiMock.on(PostToConnectionCommand).callsFake((input: any) => {
    if (gone.has(input.ConnectionId)) throw Object.assign(new Error('gone'), { name: 'GoneException', $metadata: { httpStatusCode: 410 } });
    posts.push({ id: input.ConnectionId, data: JSON.parse(Buffer.from(input.Data).toString()) });
    return {};
  });
  apiMock.on(DeleteConnectionCommand).callsFake((input: any) => {
    deletes.push(input.ConnectionId);
    return {};
  });
}

let logs: string[];
beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  apiMock.reset();
  resetManagementClientsForTests();
  setEventBridgeClientForTests(null);
  installRealtimeTable();
  installApi();
  access.byUser = {};
  access.fail = new Set();
  delete process.env.REALTIME_BUS;
  process.env.REALTIME_ENABLED = 'true';
  process.env.REALTIME_ALLOWED_ORIGINS = 'https://ana-admin.pernexium.com.mx,http://localhost:3000';
  process.env.REALTIME_MGMT_ENDPOINT = 'https://api.test/test';
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m: unknown) => void logs.push(String(m)));
});
afterEach(() => vi.restoreAllMocks());

const metricsNamed = (name: string) =>
  logs
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((o) => o && o._aws && name in o);

// ---------- conexión simulada ----------
async function open(id: string, username: string, client: 'desktop' | 'cli' | 'admin', exp = Date.now() + 3600_000) {
  const r: any = await connect({ requestContext: { connectionId: id, authorizer: { username, client, version: '1.0.0', exp } } });
  return r;
}

describe('lib/realtime: temas y sobre', () => {
  it('temas: usuario + tipo; admin con c#; todos con m#/r#; sin acceso r#unknown', () => {
    expect(connectionTopics('JPerez', 'cli', { campaigns: ['Prueba'], roleIds: ['r1'] }).sort()).toEqual(['k#cli', 'm#prueba', 'r#r1', 'u#jperez']);
    expect(connectionTopics('sup', 'admin', { campaigns: ['prueba', 'zendere'], roleIds: [] }).sort()).toEqual([
      'c#prueba',
      'c#zendere',
      'k#admin',
      'm#prueba',
      'm#zendere',
      'u#sup',
    ]);
    expect(connectionTopics('root', 'admin', { campaigns: ['*'], roleIds: [] })).toContain('c#*');
    expect(connectionTopics('jperez', 'desktop', null).sort()).toEqual(['k#desktop', 'r#unknown', 'u#jperez']);
  });

  it('destinos: usuario, campaña (c# ∪ c#*), configuración (tipo + admin)', () => {
    expect(eventTopics({ type: 'jobs.changed', users: ['Ana', 'beto'] })).toEqual(['u#ana', 'u#beto']);
    expect(eventTopics({ type: 'review.changed', campaign: 'Prueba' })).toEqual(['c#prueba', 'c#*']);
    expect(eventTopics({ type: 'settings.changed', ref: { scope: 'cli' } })).toEqual(['k#cli', 'k#admin']);
    expect(forceTopics({ kind: 'campaign', campaign: 'Prueba' })).toEqual(['m#prueba']);
    expect(forceTopics({ kind: 'role', roleId: 'r-123' })).toEqual(['r#r-123', 'r#unknown']);
    expect(forceTopics({ kind: 'all' })).toEqual(['k#desktop', 'k#cli', 'k#admin']);
  });

  it('valida el catálogo, ref y tamaño', () => {
    expect(validateEmit({ type: 'jobs.changed', users: ['ana'], campaign: 'prueba' })).toBeNull();
    expect(validateEmit({ type: 'chat.changed' as any })).toBe('unknown_type');
    expect(validateEmit({ type: 'session.refresh' as any })).toBe('unknown_type');
    expect(validateEmit({ type: 'jobs.changed', users: [] })).toBe('missing_users');
    expect(validateEmit({ type: 'uploads.changed' })).toBe('missing_campaign');
    expect(validateEmit({ type: 'settings.changed', ref: { scope: 'web' } })).toBe('invalid_scope');
    expect(validateEmit({ type: 'review.changed', campaign: 'p', ref: { phone: '5512345678' } as any })).toBe('invalid_ref');
    expect(validateEmit({ type: 'review.changed', campaign: 'p', ref: { srcKey: 'x'.repeat(290), uploadId: 'y'.repeat(290), source: 'z'.repeat(290) } })).toBe('too_large');
  });

  it('el sobre trae solo los campos del contrato (sin users)', () => {
    const env = buildEnvelope('jobs.changed', { id: 'e1', at: 5, campaign: 'Prueba' });
    expect(env).toEqual({ v: 1, type: 'jobs.changed', id: 'e1', at: 5, campaign: 'prueba' });
  });

  it('emitRealtime: sin bus no publica; con bus publica; si PutEvents falla no lanza y cuenta EmitFailed', async () => {
    expect(await emitRealtime({ type: 'jobs.changed', users: ['ana'] })).toBe(false);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
    process.env.REALTIME_BUS = 'bus-test';
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
    expect(await emitRealtime({ type: 'jobs.changed', users: ['Ana'], campaign: 'Prueba' })).toBe(true);
    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry).toMatchObject({ EventBusName: 'bus-test', Source: 'ana.v4', DetailType: 'ana.realtime.event' });
    expect(JSON.parse(entry.Detail!)).toEqual({ type: 'jobs.changed', users: ['ana'], campaign: 'prueba' });
    ebMock.on(PutEventsCommand).rejects(Object.assign(new Error('down'), { name: 'ServiceUnavailable' }));
    await expect(emitRealtime({ type: 'jobs.changed', users: ['ana'] })).resolves.toBe(false);
    expect(metricsNamed('EmitFailed').length).toBe(1);
  });

  it('emitRealtime descarta un tipo desconocido sin lanzar', async () => {
    process.env.REALTIME_BUS = 'bus-test';
    ebMock.on(PutEventsCommand).resolves({});
    await expect(emitRealtime({ type: 'chat.changed' as any })).resolves.toBe(false);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('forceRefresh publica ana.realtime.force con destino normalizado', async () => {
    process.env.REALTIME_BUS = 'bus-test';
    ebMock.on(PutEventsCommand).resolves({});
    await forceRefresh({ reason: 'roster', target: { kind: 'user', users: ['JPerez', 'jperez'] } });
    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.DetailType).toBe('ana.realtime.force');
    expect(JSON.parse(entry.Detail!)).toEqual({ reason: 'roster', target: { kind: 'user', users: ['jperez'] } });
    expect(await forceRefresh({ reason: 'manual', target: { kind: 'campaign', campaign: '*' } })).toBe(false);
  });
});

describe('authorizer de $connect', () => {
  const payload = { 'cognito:username': 'JPerez', exp: Math.floor(Date.now() / 1000) + 3600, token_use: 'id' };
  beforeEach(() =>
    setVerifierForTests({
      verify: async (t: string) => {
        if (t === 'good') return payload;
        if (t === 'expired') throw Object.assign(new Error('exp'), { name: 'JwtExpiredError' });
        throw Object.assign(new Error('bad'), { name: 'JwtInvalidClaimError' });
      },
    }),
  );
  const ev = (o: { client?: string; proto?: string; origin?: string; v?: string } = {}) => ({
    methodArn: 'arn:aws:execute-api:us-east-2:1:abc/test/$connect',
    queryStringParameters: { client: o.client ?? 'desktop', v: o.v ?? '1.4.0' },
    headers: {
      ...(o.proto === undefined ? { 'Sec-WebSocket-Protocol': 'ana.v1, good' } : o.proto ? { 'Sec-WebSocket-Protocol': o.proto } : {}),
      ...(o.origin ? { Origin: o.origin } : {}),
    },
  });
  const effect = (r: any) => r.policyDocument.Statement[0].Effect;

  it('token válido → Allow con contexto {username, client, version, exp}', async () => {
    const r: any = await authorizer(ev());
    expect(effect(r)).toBe('Allow');
    expect(r.context).toEqual({ username: 'jperez', client: 'desktop', version: '1.4.0', exp: payload.exp * 1000 });
  });

  it('subprotocolo exacto ana.v1, <token>', () => {
    expect(tokenFromSubprotocol('ana.v1, abc')).toBe('abc');
    expect(tokenFromSubprotocol('abc')).toBeNull();
    expect(tokenFromSubprotocol('ana.v2, abc')).toBeNull();
    expect(tokenFromSubprotocol('ana.v1, a, b')).toBeNull();
  });

  it('tipo desconocido → Deny (403) sin registrar conexión', async () => {
    expect(effect(await authorizer(ev({ client: 'bot' })))).toBe('Deny');
    expect(rows.size).toBe(0);
  });

  it('expirado → razón expired; inválido o access token → invalid_token; sin token en logs', async () => {
    expect(effect(await authorizer(ev({ proto: 'ana.v1, expired' })))).toBe('Deny');
    expect(effect(await authorizer(ev({ proto: 'ana.v1, accesstoken' })))).toBe('Deny');
    const reasons = metricsNamed('ConnectRejected').map((m) => m.reason);
    expect(reasons).toEqual(['expired', 'invalid_token']);
    expect(logs.join('\n')).not.toContain('accesstoken');
    expect(logs.join('\n')).not.toContain('Sec-WebSocket-Protocol');
  });

  it('origen ajeno → Deny razón origin; desktop sin Origin pasa; admin exige Origin permitido', async () => {
    expect(effect(await authorizer(ev({ origin: 'https://evil.example' })))).toBe('Deny');
    expect(effect(await authorizer(ev()))).toBe('Allow');
    expect(effect(await authorizer(ev({ client: 'admin' })))).toBe('Deny');
    expect(effect(await authorizer(ev({ client: 'admin', origin: 'https://ana-admin.pernexium.com.mx' })))).toBe('Allow');
    expect(metricsNamed('ConnectRejected').map((m) => m.reason)).toEqual(['origin', 'origin']);
  });

  it('interruptor apagado → Deny razón disabled', async () => {
    process.env.REALTIME_ENABLED = 'false';
    expect(effect(await authorizer(ev()))).toBe('Deny');
    expect(metricsNamed('ConnectRejected')[0].reason).toBe('disabled');
  });
});

describe('$connect, $disconnect, ping', () => {
  it('registra temas y meta con TTL 3 h y responde el subprotocolo ana.v1', async () => {
    access.byUser.jperez = { username: 'jperez', roleIds: ['r1'], campaigns: ['prueba'], permissions: [], isAdmin: false };
    const r = await open('c1', 'jperez', 'cli');
    expect(r).toEqual({ statusCode: 200, headers: { 'Sec-WebSocket-Protocol': 'ana.v1' } });
    expect(topicsOf('c1')).toEqual(['k#cli', 'm#prueba', 'r#r1', 'u#jperez']);
    const meta = rows.get('conn#c1|meta');
    expect(meta).toMatchObject({ username: 'jperez', client: 'cli', version: '1.0.0' });
    expect(meta.ttl - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(3 * 3600 - 5);
  });

  it('supervisor en ANA Admin: c# de sus campañas', async () => {
    access.byUser.sup = { username: 'sup', roleIds: [], campaigns: ['prueba', 'zendere'], permissions: [], isAdmin: false };
    await open('a1', 'sup', 'admin');
    expect(topicsOf('a1')).toEqual(expect.arrayContaining(['c#prueba', 'c#zendere']));
  });

  it('acceso no disponible: cli aceptado con r#unknown; admin rechazado (access_error)', async () => {
    access.fail = new Set(['jperez', 'sup']);
    expect((await open('c1', 'jperez', 'cli')).statusCode).toBe(200);
    expect(topicsOf('c1')).toEqual(['k#cli', 'r#unknown', 'u#jperez']);
    expect((await open('a1', 'sup', 'admin')).statusCode).toBe(403);
    expect(rows.get('conn#a1|meta')).toBeUndefined();
    expect(metricsNamed('ConnectRejected')[0].reason).toBe('access_error');
  });

  it('$disconnect borra la conexión y todas sus suscripciones', async () => {
    await open('c1', 'jperez', 'cli');
    await disconnect({ requestContext: { connectionId: 'c1' } });
    expect(rows.size).toBe(0);
  });

  it('ping → pong con hora y exp; acción desconocida → unknown_action sin cambiar suscripciones', async () => {
    const exp = Date.now() + 1000;
    await open('c1', 'jperez', 'cli', exp);
    const before = topicsOf('c1');
    await ping({ requestContext: { connectionId: 'c1', domainName: 'abc.execute-api.us-east-2.amazonaws.com', stage: 'test', authorizer: { exp } } });
    expect(posts[0].id).toBe('c1');
    expect(posts[0].data).toMatchObject({ type: 'pong', exp });
    expect(typeof posts[0].data.at).toBe('number');
    await fallback({ requestContext: { connectionId: 'c1', domainName: 'abc', stage: 'test' } });
    expect(posts[1].data).toEqual({ type: 'error', code: 'unknown_action' });
    expect(topicsOf('c1')).toEqual(before);
  });
});

const busEvent = (detailType: string, detail: any, ageMs = 0) => ({
  id: 'evt-1',
  source: 'ana.v4',
  'detail-type': detailType,
  time: new Date(Date.now() - ageMs).toISOString(),
  detail,
});
const s3Event = (key: string, detailType = 'Object Created') => ({
  id: 's3-1',
  source: 'aws.s3',
  'detail-type': detailType,
  time: new Date().toISOString(),
  detail: { bucket: { name: 'ana-backend-storage-test' }, object: { key } },
});

describe('notify: reparto', () => {
  beforeEach(async () => {
    access.byUser.ana = { username: 'ana', roleIds: ['r1'], campaigns: ['prueba'], permissions: [], isAdmin: false };
    access.byUser.beto = { username: 'beto', roleIds: ['r2'], campaigns: ['prueba'], permissions: [], isAdmin: false };
    access.byUser.sup = { username: 'sup', roleIds: [], campaigns: ['prueba'], permissions: [], isAdmin: false };
    access.byUser.otro = { username: 'otro', roleIds: [], campaigns: ['zendere'], permissions: [], isAdmin: false };
    access.byUser.root = { username: 'root', roleIds: [], campaigns: ['*'], permissions: [], isAdmin: true };
    await open('d-ana', 'ana', 'desktop');
    await open('d-beto', 'beto', 'desktop');
    await open('a-sup', 'sup', 'admin');
    await open('a-otro', 'otro', 'admin');
    await open('a-root', 'root', 'admin');
  });

  it('jobs.changed a cada operador, sin datos de contactos', async () => {
    await notify(busEvent('ana.realtime.event', { type: 'jobs.changed', users: ['ana', 'beto'], campaign: 'prueba' }));
    expect(posts.map((p) => p.id).sort()).toEqual(['d-ana', 'd-beto']);
    expect(posts[0].data).toEqual({ v: 1, type: 'jobs.changed', id: 'evt-1', at: expect.any(Number), campaign: 'prueba' });
  });

  it('evento de campaña: admins de la campaña y los de *, no otras campañas; deduplicado', async () => {
    await notify(busEvent('ana.realtime.event', { type: 'review.changed', campaign: 'prueba' }));
    expect(posts.map((p) => p.id).sort()).toEqual(['a-root', 'a-sup']);
  });

  it('settings.changed desktop: desktops y admins', async () => {
    await notify(busEvent('ana.realtime.event', { type: 'settings.changed', ref: { scope: 'desktop' } }));
    expect(posts.map((p) => p.id).sort()).toEqual(['a-otro', 'a-root', 'a-sup', 'd-ana', 'd-beto']);
  });

  it('410 borra la conexión y cuenta PostGone', async () => {
    gone.add('d-ana');
    await notify(busEvent('ana.realtime.event', { type: 'jobs.changed', users: ['ana'] }));
    expect(topicsOf('d-ana')).toEqual([]);
    expect(rows.get('conn#d-ana|meta')).toBeUndefined();
    expect(metricsNamed('PostGone')[0].PostGone).toBe(1);
  });

  it('token vencido hace 6 min: no se entrega y se cierra', async () => {
    await open('d-old', 'ana', 'desktop', Date.now() - 6 * 60_000);
    await notify(busEvent('ana.realtime.event', { type: 'jobs.changed', users: ['ana'] }));
    expect(posts.map((p) => p.id)).toEqual(['d-ana']);
    expect(deletes).toEqual(['d-old']);
  });

  it('evento de más de 60 s se descarta; interruptor apagado descarta', async () => {
    await notify(busEvent('ana.realtime.event', { type: 'jobs.changed', users: ['ana'] }, MAX_EVENT_AGE_MS + 1000));
    process.env.REALTIME_ENABLED = 'false';
    await notify(busEvent('ana.realtime.event', { type: 'jobs.changed', users: ['ana'] }));
    expect(posts).toEqual([]);
  });

  it('fallo de envío cuenta PostFailed y no lanza', async () => {
    apiMock.on(PostToConnectionCommand).rejects(Object.assign(new Error('x'), { name: 'InternalServerError' }));
    await expect(notify(busEvent('ana.realtime.event', { type: 'jobs.changed', users: ['ana'] }))).resolves.toBeUndefined();
    expect(metricsNamed('PostFailed')[0].PostFailed).toBe(1);
  });
});

describe('notify: actualización forzada (session.refresh)', () => {
  beforeEach(async () => {
    access.byUser.jperez = { username: 'jperez', roleIds: ['r-123'], campaigns: ['prueba'], permissions: [], isAdmin: false };
    access.byUser.otro = { username: 'otro', roleIds: ['r-9'], campaigns: ['zendere'], permissions: [], isAdmin: false };
    access.byUser.root = { username: 'root', roleIds: [], campaigns: ['*'], permissions: [], isAdmin: true };
    await open('c-jp', 'jperez', 'cli');
    await open('d-jp', 'jperez', 'desktop');
    await open('c-otro', 'otro', 'cli');
    await open('a-root', 'root', 'admin');
    access.fail = new Set(['nadie']);
    await open('c-unk', 'nadie', 'cli');
  });
  const force = (detail: any) => notify(busEvent('ana.realtime.force', detail));
  const refreshed = () => posts.filter((p) => p.data.type === 'session.refresh').map((p) => p.id).sort();

  it('usuario: cada conexión recibe session.refresh y el servidor la cierra', async () => {
    await force({ reason: 'manual', target: { kind: 'user', users: ['jperez'] } });
    expect(refreshed()).toEqual(['c-jp', 'd-jp']);
    expect(posts[0].data).toEqual({ v: 1, type: 'session.refresh', id: 'evt-1', at: expect.any(Number), ref: { reason: 'manual' } });
    expect(deletes.sort()).toEqual(['c-jp', 'd-jp']);
    expect(metricsNamed('ForcedClosed')[0]).toMatchObject({ reason: 'manual', ForcedClosed: 2 });
  });

  it('rol: conexiones con el rol más las de acceso desconocido', async () => {
    await force({ reason: 'permissions', target: { kind: 'role', roleId: 'r-123' } });
    expect(refreshed()).toEqual(['c-jp', 'c-unk', 'd-jp']);
  });

  it('campaña: usuarios con esa campaña, no los de * ni de otras', async () => {
    await force({ reason: 'manual', target: { kind: 'campaign', campaign: 'prueba' } });
    expect(refreshed()).toEqual(['c-jp', 'd-jp']);
  });

  it('todos: desktop, cli y admin', async () => {
    await force({ reason: 'manual', target: { kind: 'all' } });
    expect(refreshed()).toEqual(['a-root', 'c-jp', 'c-otro', 'c-unk', 'd-jp']);
  });

  it('tipo de cliente: solo desktops', async () => {
    await force({ reason: 'settings', target: { kind: 'client', client: 'desktop' } });
    expect(refreshed()).toEqual(['d-jp']);
  });
});

describe('puente v3 → v4', () => {
  it('traduce llaves según el spec', () => {
    expect(translateS3('agents/prueba/jperez-contacts-1730000000.csv', 'created')).toEqual({
      emit: { type: 'assignment.published', users: ['jperez'], campaign: 'prueba', ref: { source: 'v3' } },
    });
    expect(translateS3('agents/prueba/jperez-contacts-1.csv', 'deleted')).toBeNull();
    expect(translateS3('assignments/agents/prueba/jperez-contacts-1.csv', 'deleted')?.emit?.type).toBe('assignment.pending');
    expect(translateS3('agent-publications/prueba/jperez/p1.json', 'created')?.emit).toMatchObject({ type: 'publications.changed', users: ['jperez'] });
    expect(translateS3('review/prueba/jperez/a1.csv', 'created')?.emit).toMatchObject({ type: 'review.changed', campaign: 'prueba' });
    expect(translateS3('uploads/prueba/u1.json', 'created')?.emit).toMatchObject({ type: 'uploads.changed', ref: { source: 'v3', uploadId: 'u1' } });
    expect(translateS3('rosters/prueba.json', 'created')).toEqual({
      emit: { type: 'roster.changed', campaign: 'prueba', ref: { source: 'v3' } },
      force: { reason: 'roster', target: { kind: 'campaign', campaign: 'prueba' } },
    });
    expect(translateS3('config/cli-settings.json', 'created')).toEqual({
      emit: { type: 'settings.changed', ref: { scope: 'cli', source: 'v3' } },
      force: { reason: 'settings', target: { kind: 'client', client: 'cli' } },
    });
    expect(translateS3('agents/prueba/notas.txt', 'created')).toEqual({ skipped: true });
    expect(translateS3('backups/prueba/jperez/5512345678/chat_backup.json', 'created')).toBeNull();
    expect(translateS3('agents/banco%20azteca/jperez-contacts-1.csv', 'created')?.emit?.campaign).toBe('banco azteca');
  });

  it('publicación desde Mi asignación → assignment.published al CLI del agente', async () => {
    await open('c-jp', 'jperez', 'cli');
    await notify(s3Event('agents/prueba/jperez-contacts-1730000000.csv'));
    expect(posts).toEqual([{ id: 'c-jp', data: expect.objectContaining({ type: 'assignment.published', campaign: 'prueba' }) }]);
  });

  it('llave suelta → BridgeSkipped sin evento; bucket ajeno se ignora', async () => {
    await open('c-jp', 'jperez', 'cli');
    await notify(s3Event('agents/prueba/notas.txt'));
    expect(metricsNamed('BridgeSkipped')).toHaveLength(1);
    await notify({ ...s3Event('agents/prueba/jperez-contacts-1.csv'), detail: { bucket: { name: 'otro' }, object: { key: 'agents/prueba/jperez-contacts-1.csv' } } });
    expect(posts).toEqual([]);
  });

  it('roster v3 editado: roster.changed a admins y session.refresh a los usuarios de la campaña', async () => {
    access.byUser.jperez = { username: 'jperez', roleIds: [], campaigns: ['prueba'], permissions: [], isAdmin: false };
    access.byUser.sup = { username: 'sup', roleIds: [], campaigns: ['prueba'], permissions: [], isAdmin: false };
    access.byUser.otro = { username: 'otro', roleIds: [], campaigns: ['zendere'], permissions: [], isAdmin: false };
    await open('c-jp', 'jperez', 'cli');
    await open('a-sup', 'sup', 'admin');
    await open('c-otro', 'otro', 'cli');
    await notify(s3Event('rosters/prueba.json'));
    expect(posts.filter((p) => p.data.type === 'roster.changed').map((p) => p.id)).toEqual(['a-sup']);
    expect(posts.filter((p) => p.data.type === 'session.refresh').map((p) => p.id).sort()).toEqual(['a-sup', 'c-jp']);
    expect(deletes).not.toContain('c-otro');
  });

  it('configuración del CLI: settings.changed y luego session.refresh a cada CLI', async () => {
    await open('c-jp', 'jperez', 'cli');
    await notify(s3Event('config/cli-settings.json'));
    expect(posts.map((p) => p.data.type)).toEqual(['settings.changed', 'session.refresh']);
    expect(posts[1].data.ref).toEqual({ reason: 'settings' });
  });
});

describe('realtimeStats e interruptor', () => {
  it('ActiveConnections por tipo', async () => {
    await open('d1', 'ana', 'desktop');
    await open('c1', 'ana', 'cli');
    const r = await stats();
    expect(r.active).toEqual({ desktop: 1, cli: 1, admin: 0 });
    expect(metricsNamed('ActiveConnections').map((m) => [m.client, m.ActiveConnections])).toEqual([
      ['desktop', 1],
      ['cli', 1],
      ['admin', 0],
    ]);
  });

  it('con REALTIME_ENABLED=false cierra todas las conexiones', async () => {
    await open('d1', 'ana', 'desktop');
    await open('c1', 'beto', 'cli');
    process.env.REALTIME_ENABLED = 'false';
    const r = await stats();
    expect(r.closed).toBe(2);
    expect(deletes.sort()).toEqual(['c1', 'd1']);
    expect(rows.size).toBe(0);
  });
});

describe('POST /admin/realtime/refresh', () => {
  const call = async (user: string, body: unknown) => {
    const r: any = await realtimeAdmin({
      routeKey: 'POST /admin/realtime/refresh',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      requestContext: { authorizer: { jwt: { claims: { 'cognito:username': user } } } },
    } as any);
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
  beforeEach(() => {
    process.env.REALTIME_BUS = 'bus-test';
    ebMock.on(PutEventsCommand).resolves({});
    access.byUser.admin = { username: 'admin', roleIds: [], campaigns: [], permissions: [], isAdmin: true };
    access.byUser.sup = { username: 'sup', roleIds: [], campaigns: ['prueba'], permissions: ['ana:admin:agents:manage'], isAdmin: false };
  });
  const forced = () => ebMock.commandCalls(PutEventsCommand).map((c) => JSON.parse(c.args[0].input.Entries![0].Detail!));

  it('admin fuerza a un usuario → 202 y petición con reason manual', async () => {
    const r = await call('admin', { scope: 'user', username: 'JPerez' });
    expect(r.status).toBe(202);
    expect(forced()).toEqual([{ reason: 'manual', target: { kind: 'user', users: ['jperez'] }, by: 'admin' }]);
    expect(logs.some((l) => l.includes('"evt":"realtime_force"') && l.includes('"by":"admin"'))).toBe(true);
  });

  it('campaña y todos', async () => {
    expect((await call('admin', { scope: 'campaign', campaign: 'Prueba' })).status).toBe(202);
    expect((await call('admin', { scope: 'all' })).status).toBe(202);
    expect(forced().map((f) => f.target)).toEqual([{ kind: 'campaign', campaign: 'prueba' }, { kind: 'all' }]);
  });

  it('sin ana:admin:console:manage → 403 sin publicar', async () => {
    expect((await call('sup', { scope: 'all' })).status).toBe(403);
    expect(forced()).toEqual([]);
  });

  it('alcance inválido o sin destino → 400', async () => {
    expect((await call('admin', { scope: 'user' })).status).toBe(400);
    expect((await call('admin', { scope: 'campaign', campaign: '*' })).status).toBe(400);
    expect((await call('admin', { scope: 'x' })).status).toBe(400);
    expect((await call('admin', '{bad')).status).toBe(400);
    expect(parseRefreshBody({ scope: 'all' })).toEqual({ kind: 'all' });
  });
});

describe('serverless.yml: recursos realtime', () => {
  const tags = ['!Sub', '!GetAtt', '!Ref'].map((tag) => ({ tag, resolve: (v: string) => ({ [tag.slice(1)]: v }) }));
  const sls = parse(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'), { customTags: tags as any });

  it('WebSocket: $connect con authorizer por subprotocolo, $disconnect, ping y $default', () => {
    const ws = (fn: string) => sls.functions[fn].events.map((e: any) => e.websocket);
    expect(ws('realtimeConnect')).toEqual([
      { route: '$connect', authorizer: { name: 'realtimeAuthorizer', identitySource: ['route.request.header.Sec-WebSocket-Protocol'] } },
    ]);
    expect(ws('realtimeDisconnect')).toEqual([{ route: '$disconnect' }]);
    expect(ws('realtimePing')).toEqual([{ route: 'ping' }]);
    expect(ws('realtimeDefault')).toEqual([{ route: '$default' }]);
    expect(sls.provider.websocketsApiRouteSelectionExpression).toBe('$request.body.action');
  });

  it('access log sin headers y ejecución sin datos completos', () => {
    const l = sls.provider.logs.websocket;
    expect(l.fullExecutionData).toBe(false);
    expect(l.format).not.toMatch(/header|Sec-WebSocket|authorizer/i);
  });

  it('tabla, bus, reglas, alarmas, salidas e interruptor', () => {
    const r = sls.resources.Resources;
    expect(r.RealtimeTable.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'ttl', Enabled: true });
    expect(r.AnaRealtimeBus.Type).toBe('AWS::Events::EventBus');
    expect(r.AnaRealtimeV4Rule.Properties.EventPattern).toEqual({ source: ['ana.v4'] });
    expect(r.AnaRealtimeS3Rule.Properties.EventPattern).toEqual({ source: ['aws.s3'] });
    expect(r.AnaRealtimeV4Rule.Properties.Targets[0].RetryPolicy).toEqual({ MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 1 });
    expect(r.RealtimePostFailingAlarm.Properties.AlarmName).toBe('${self:service}-${self:provider.stage}-realtime-post-failing');
    expect(Object.keys(sls.resources.Outputs)).toEqual(['RealtimeWsUrl', 'RealtimeBusArn']);
    expect(sls.provider.environment.REALTIME_ENABLED).toBe("${param:realtimeEnabled, 'true'}");
    const route = sls.functions.realtimeAdmin.events[0].httpApi;
    expect(route).toEqual({ path: '/admin/realtime/refresh', method: 'post', authorizer: { name: 'cognitoJwt' } });
  });

  it('no cambia los recursos existentes', () => {
    const names = Object.keys(sls.resources.Resources);
    for (const n of ['ConversationsTable', 'MessagesTable', 'CsvBucket', 'MediaBucket', 'JobsTable', 'RolePermsTable', 'AgentsTable', 'UploadsTable', 'AccessCacheTable']) {
      expect(names).toContain(n);
    }
  });
});
