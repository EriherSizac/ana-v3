import { mockClient } from 'aws-sdk-client-mock';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChats } from '../src/handlers/chats';
import { installMemS3 } from './helpers/memS3';
import { derivedList } from './helpers/admin';
import { bearer, captureAuthLogs, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3 = mockClient(S3Client);
let store: ReturnType<typeof installMemS3>;
let out: ReturnType<typeof vi.spyOn>;
const ASSIGNMENT = 'agents/prueba/erick-contacts-1.csv';

beforeEach(() => {
  s3.reset();
  store = installMemS3(s3, {
    [ASSIGNMENT]: 'contact_phone\n5215500000001',
    'campaign-agents/prueba.json': derivedList('prueba', ['erick', 'ana']),
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

const ev = (headers: Record<string, string>, agentId = 'erick', campaignId = 'prueba') =>
  ({ headers, pathParameters: { agentId, campaignId } }) as unknown as APIGatewayProxyEvent;
const dataCalls = () =>
  [...s3.commandCalls(ListObjectsV2Command), ...s3.commandCalls(GetObjectCommand), ...s3.commandCalls(DeleteObjectCommand)].filter(
    (c) => !String((c.args[0].input as any).Key ?? '').match(/^(campaign-agents|rosters)\//),
  );

describe('GET /get/chats en modo estricto', () => {
  beforeEach(() => setupAgentAuth({ enforced: true }));

  it('sin token → 401 y cero llamadas S3; la asignación sigue', async () => {
    const res = await getChats(ev({}));
    expect(res.statusCode).toBe(401);
    expect(s3.calls()).toHaveLength(0);
    expect(store.has(ASSIGNMENT)).toBe(true);
  });

  it('token ajeno → 403 sin S3 de datos', async () => {
    const res = await getChats(ev(bearer(signIdToken({ 'cognito:username': 'ana' }))));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
    expect(s3.calls()).toHaveLength(0);
    expect(store.has(ASSIGNMENT)).toBe(true);
  });

  it('fuera del roster → 403 y la asignación no se consume', async () => {
    store.set('agents/ventas/erick-contacts-1.csv', { body: 'contact_phone\n1', lastModified: new Date() });
    const res = await getChats(ev(bearer(signIdToken()), 'erick', 'ventas'));
    expect(res.statusCode).toBe(403);
    expect(dataCalls()).toHaveLength(0);
    expect(store.has('agents/ventas/erick-contacts-1.csv')).toBe(true);
  });

  it('solo X-Admin-Key → 401', async () => {
    process.env.ADMIN_API_KEY = 'k';
    expect((await getChats(ev({ 'X-Admin-Key': 'k' }))).statusCode).toBe(401);
  });

  it('token válido → 200 y objeto consumido', async () => {
    const res = await getChats(ev(bearer(signIdToken({ 'cognito:username': 'Erick' }))));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('5215500000001');
    expect(store.has(ASSIGNMENT)).toBe(false);
  });
});

describe('GET /get/chats en modo reporte', () => {
  beforeEach(() => setupAgentAuth({ enforced: false }));

  it('sin token → 200 y log missing', async () => {
    const res = await getChats(ev({}));
    expect(res.statusCode).toBe(200);
    expect(store.has(ASSIGNMENT)).toBe(false);
    expect(captureAuthLogs(out)[0]).toMatchObject({ reason: 'missing', route: 'GET /get/chats', agent: 'erick', campaign: 'prueba' });
  });
});
