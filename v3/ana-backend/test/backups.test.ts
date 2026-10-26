import { mockClient } from 'aws-sdk-client-mock';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestBackup, uploadBackup } from '../src/handlers/backups';
import { getChatBackup, listChatBackups, saveChatBackup } from '../src/handlers/chatBackups';
import { installMemS3 } from './helpers/memS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

const s3 = mockClient(S3Client);
let store: ReturnType<typeof installMemS3>;
const CHAT = 'backups/prueba/erick/5215512345678/chat_backup.json';

beforeEach(() => {
  s3.reset();
  store = installMemS3(s3, {
    'campaign-agents/prueba.json': derivedList('prueba', ['erick', 'ana']),
    [CHAT]: JSON.stringify({ messages: [{ id: '1', timestamp: 1, from: 'x', body: 'hola' }], total_messages: 1, last_updated: '2026-10-25T00:00:00Z' }),
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  setupAgentAuth({ enforced: true });
});
afterEach(() => vi.restoreAllMocks());

const ERICK = () => bearer(signIdToken());
const ANA = () => bearer(signIdToken({ 'cognito:username': 'ana' }));
const post = (headers: Record<string, string>, body: unknown) => ({ headers, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEvent;
const get = (headers: Record<string, string>, pathParameters: Record<string, string>) =>
  ({ headers, pathParameters }) as unknown as APIGatewayProxyEvent;
const isRosterKey = (input: any) => /^(campaign-agents|rosters)\//.test(String(input.Key ?? input.Prefix ?? ''));
const dataReads = () =>
  [...s3.commandCalls(GetObjectCommand), ...s3.commandCalls(ListObjectsV2Command)].filter((c) => !isRosterKey(c.args[0].input));
const xss = {
  campaign: 'prueba',
  agent_id: 'erick',
  contact_phone: '5215512345678',
  messages: [{ id: '9', timestamp: 9, from: 'x', body: '<script>alert(1)</script>' }],
};

describe('POST /backups/chat (estricto)', () => {
  it('sin token → 401 sin leer ni escribir', async () => {
    expect((await saveChatBackup(post({}, xss))).statusCode).toBe(401);
    expect(s3.calls()).toHaveLength(0);
  });

  it('a nombre de otro agente → 403 sin PutObject', async () => {
    const res = await saveChatBackup(post(ANA(), xss));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(dataReads()).toHaveLength(0);
  });

  it('agente dueño → 200 con fusión', async () => {
    const res = await saveChatBackup(post(ERICK(), { ...xss, messages: [{ id: '2', timestamp: 2, from: 'x', body: 'nuevo' }] }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).stats).toEqual({ existing_messages: 1, new_messages: 1, total_messages: 2, skipped_duplicates: 0 });
  });

  it('agente dueño: validación 400 se conserva', async () => {
    expect((await saveChatBackup(post(ERICK(), { ...xss, messages: 'x' }))).statusCode).toBe(400);
  });
});

describe('POST /backups (estricto)', () => {
  const body = { campaign: 'prueba', agent_id: 'erick', data: { a: 1 } };
  it('sin token → 401; ajeno → 403; dueño → 200', async () => {
    expect((await uploadBackup(post({}, body))).statusCode).toBe(401);
    expect((await uploadBackup(post(ANA(), body))).statusCode).toBe(403);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect((await uploadBackup(post(ERICK(), body))).statusCode).toBe(200);
  });
});

describe('lecturas ajenas (estricto) → 403 sin GetObject/ListObjectsV2', () => {
  it('GET /backups/chat', async () => {
    expect((await getChatBackup(get(ANA(), { campaign: 'prueba', agentId: 'erick', contactPhone: '5215512345678' }))).statusCode).toBe(403);
    expect(dataReads()).toHaveLength(0);
  });
  it('GET /backups/chats', async () => {
    expect((await listChatBackups(get(ANA(), { campaign: 'prueba', agentId: 'erick' }))).statusCode).toBe(403);
    expect(dataReads()).toHaveLength(0);
  });
  it('GET /backups/latest', async () => {
    expect((await getLatestBackup(get(ANA(), { agentId: 'erick', campaign: 'prueba' }))).statusCode).toBe(403);
    expect(dataReads()).toHaveLength(0);
  });
  it('sin token → 401 sin S3', async () => {
    expect((await listChatBackups(get({}, { campaign: 'prueba', agentId: 'erick' }))).statusCode).toBe(401);
    expect((await getLatestBackup(get({}, { agentId: 'erick', campaign: 'prueba' }))).statusCode).toBe(401);
    expect((await getChatBackup(get({}, { campaign: 'prueba', agentId: 'erick', contactPhone: '1' }))).statusCode).toBe(401);
    expect(s3.calls()).toHaveLength(0);
  });
});

describe('agente dueño conserva las respuestas actuales', () => {
  it('GET /backups/chat 200 y 404', async () => {
    expect((await getChatBackup(get(ERICK(), { campaign: 'prueba', agentId: 'erick', contactPhone: '5215512345678' }))).statusCode).toBe(200);
    expect((await getChatBackup(get(ERICK(), { campaign: 'prueba', agentId: 'erick', contactPhone: '000' }))).statusCode).toBe(404);
  });
  it('GET /backups/chats 200', async () => {
    const res = await listChatBackups(get(ERICK(), { campaign: 'prueba', agentId: 'erick' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).total_chats).toBe(1);
  });
  it('GET /backups/latest 404 sin respaldo y 200 con respaldo de hoy', async () => {
    expect((await getLatestBackup(get(ERICK(), { agentId: 'erick', campaign: 'prueba' }))).statusCode).toBe(404);
    const now = new Date();
    const key = `backups/prueba/${now.toISOString().slice(0, 7)}/erick_${now.getDate().toString().padStart(2, '0')}.json`;
    store.set(key, { body: '{"x":1}', lastModified: now });
    expect((await getLatestBackup(get(ERICK(), { agentId: 'erick', campaign: 'prueba' }))).statusCode).toBe(200);
  });
});
