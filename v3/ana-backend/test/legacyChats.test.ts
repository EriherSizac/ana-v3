import { mockClient } from 'aws-sdk-client-mock';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { getLegacyAgents, getLegacyChat, legacyAllowed, searchLegacyChats } from '../src/handlers/adminLegacyChats';
import { legacyMediaKey, parseMessageTime, readConversation, searchIndex, validateFilters, InvalidFilterError } from '../src/lib/legacyChats';
import { buildIndexes } from '../scripts/build-legacy-chat-index';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, AGENT, LEADER_PRUEBA, adminEvent, mockV4Me, parse } from './helpers/admin';

const s3mock = mockClient(S3Client);
const client = new S3Client({ region: 'us-east-1' });
let s3: CondS3;

const backup = (messages: unknown[]) => JSON.stringify({ campaign: 'prueba', agent_id: 'erick', contact_phone: '5215512345678', messages });

const INDEX = {
  schemaVersion: 1,
  generatedAt: '2026-10-01T00:00:00Z',
  conversations: [
    { agent: 'erick', phone: '5215512345678', totalMessages: 12, firstMessageAt: '2026-08-01T15:00:00.000Z', lastMessageAt: '2026-09-15T18:00:00.000Z' },
    { agent: 'luis', phone: '5215599999999', totalMessages: 3, firstMessageAt: '2026-07-01T15:00:00.000Z', lastMessageAt: '2026-07-02T18:00:00.000Z' },
    { agent: 'erick', phone: '5215500000001', totalMessages: 0, firstMessageAt: null, lastMessageAt: null },
  ],
};

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  process.env.AWS_ACCESS_KEY_ID = 'AKIAFAKE';
  process.env.AWS_SECRET_ACCESS_KEY = 'fake';
  s3 = installCondS3(s3mock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lib/legacyChats', () => {
  it('filtro por dígitos: 5512345678 encuentra 5215512345678', () => {
    const r = searchIndex(INDEX as any, validateFilters({ phone: '55 1234-5678' }));
    expect(r.conversations.map((c) => c.phone)).toEqual(['5215512345678']);
  });

  it('from > to → error; fecha mal formada → error', () => {
    expect(() => validateFilters({ from: '2026-09-02', to: '2026-09-01' })).toThrow(InvalidFilterError);
    expect(() => validateFilters({ from: '01/09/2026' })).toThrow(InvalidFilterError);
  });

  it('orden por lastMessageAt desc, filtro por agente y por fechas (día de CDMX)', () => {
    expect(searchIndex(INDEX as any, validateFilters({})).conversations.map((c) => c.phone)).toEqual(['5215512345678', '5215599999999', '5215500000001']);
    expect(searchIndex(INDEX as any, validateFilters({ agent: 'ERICK' })).total).toBe(2);
    expect(searchIndex(INDEX as any, validateFilters({ from: '2026-09-15', to: '2026-09-15' })).conversations.map((c) => c.agent)).toEqual(['erick']);
  });

  it('índice inexistente → vacío', () => {
    expect(searchIndex(null, validateFilters({}))).toEqual({ total: 0, page: 1, conversations: [] });
  });

  it('referencias de media: misma campaña, otra campaña → null, URL completa', () => {
    expect(legacyMediaKey('media/prueba/erick/foto.jpg', 'prueba')).toBe('legacy/media/prueba/erick/foto.jpg');
    expect(legacyMediaKey('https://ana-backend-storage-prod.s3.amazonaws.com/media/prueba/erick/foto%201.jpg', 'prueba')).toBe('legacy/media/prueba/erick/foto 1.jpg');
    expect(legacyMediaKey('media/ventas/ana/x.jpg', 'prueba')).toBeNull();
    expect(legacyMediaKey('media/prueba/../ventas/x.jpg', 'prueba')).toBeNull();
    expect(legacyMediaKey('https://evil.example/otra/cosa.jpg', 'prueba')).toBeNull();
  });

  it('fechas de WhatsApp Web (texto) se leen en hora de Ciudad de México', () => {
    expect(new Date(parseMessageTime('10:30 a. m., 5/9/2026')!).toISOString()).toBe('2026-09-05T16:30:00.000Z');
    expect(new Date(parseMessageTime('18:05, 15/9/2026')!).toISOString()).toBe('2026-09-16T00:05:00.000Z');
    expect(parseMessageTime(1760000000000)).toBe(1760000000000);
    expect(parseMessageTime('no es fecha')).toBeNull();
  });

  it('conversación ordenada; imagen con URL prefirmada de 300 s; PDF como descarga; otra campaña → null', async () => {
    s3.set(
      'legacy/backups/prueba/erick/5215512345678/chat_backup.json',
      backup([
        { id: '2', timestamp: '2026-08-02T10:00:00Z', from: 'them', body: 'segundo', mediaUrl: 'https://b.s3.amazonaws.com/media/prueba/erick/doc.pdf' },
        { id: '1', timestamp: '2026-08-01T10:00:00Z', from: 'me', body: '<img src=x onerror=alert(1)>', mediaUrl: 'media/prueba/erick/foto.jpg' },
        { id: '3', timestamp: '2026-08-03T10:00:00Z', type: 'incoming', text: 'tercero', mediaUrl: 'media/ventas/ana/x.jpg' },
      ]),
    );
    const msgs = (await readConversation('prueba', 'erick', '5215512345678'))!;
    expect(msgs.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(msgs[0]!.body).toBe('<img src=x onerror=alert(1)>');
    expect(msgs[0]!.media).toMatchObject({ kind: 'image', contentType: 'image/jpeg' });
    expect(msgs[0]!.media!.url).toContain('legacy/media/prueba/erick/foto.jpg');
    expect(msgs[0]!.media!.url).toContain('X-Amz-Expires=300');
    expect(msgs[0]!.media!.url).not.toContain('response-content-disposition');
    expect(msgs[1]!.media).toMatchObject({ kind: 'file', contentType: 'application/pdf' });
    expect(decodeURIComponent(msgs[1]!.media!.url)).toContain('response-content-disposition=attachment');
    expect(msgs[2]).toMatchObject({ from: 'them', body: 'tercero', media: null });
  });
});

describe('requireLegacyChatAccess', () => {
  const ev = (campaign = 'prueba') => adminEvent({ path: { campaign } });

  it('admin en cualquier campaña', async () => {
    mockV4Me(ADMIN);
    s3.set('legacy/index/zendere.json', JSON.stringify(INDEX));
    expect((await searchLegacyChats(ev('zendere'))).statusCode).toBe(200);
  });

  it('líder en su campaña sí; en otra → 403 sin S3', async () => {
    mockV4Me(LEADER_PRUEBA);
    expect((await searchLegacyChats(ev('prueba'))).statusCode).toBe(200);
    s3mock.resetHistory();
    mockV4Me(LEADER_PRUEBA);
    const res = await searchLegacyChats(ev('ventas'));
    expect(res.statusCode).toBe(403);
    expect(s3mock.calls()).toHaveLength(0);
  });

  it('usuario con `*` e isLeader pasa; con `*` sin isLeader no', () => {
    expect(legacyAllowed({ username: 'x', permissions: [], campaigns: ['*'], roleNames: [], isAdmin: false, isLeader: true }, 'prueba')).toBe(true);
    expect(legacyAllowed({ username: 'x', permissions: [], campaigns: ['*'], roleNames: [], isAdmin: false, isLeader: false }, 'prueba')).toBe(false);
  });

  it('agente sin rol → 403', async () => {
    mockV4Me(AGENT);
    expect((await searchLegacyChats(ev())).statusCode).toBe(403);
  });

  it('v4 caído → 503 sin S3', async () => {
    mockV4Me('down');
    expect((await getLegacyChat(adminEvent({ path: { campaign: 'prueba', agent: 'erick', phone: '5215512345678' } }))).statusCode).toBe(503);
    expect(s3mock.calls()).toHaveLength(0);
  });
});

describe('rutas /admin/campaigns/{campaign}/legacy-*', () => {
  it('búsqueda por teléfono y campaña sin índice', async () => {
    mockV4Me(ADMIN);
    s3.set('legacy/index/prueba.json', JSON.stringify(INDEX));
    const res = await searchLegacyChats(adminEvent({ path: { campaign: 'prueba' }, query: { phone: '5512345678' } }));
    expect(parse(res)).toMatchObject({ total: 1, page: 1, conversations: [{ agent: 'erick', phone: '5215512345678' }] });
    mockV4Me(ADMIN);
    expect(parse(await searchLegacyChats(adminEvent({ path: { campaign: 'ventas' } })))).toEqual({ total: 0, page: 1, conversations: [] });
  });

  it('filtro inválido → 400 sin leer S3 ni v4', async () => {
    const fetch = mockV4Me(ADMIN);
    const res = await searchLegacyChats(adminEvent({ path: { campaign: 'prueba' }, query: { from: '2026-09-02', to: '2026-09-01' } }));
    expect(res.statusCode).toBe(400);
    expect(s3mock.calls()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('conversación existente / inexistente (404 not_found)', async () => {
    mockV4Me(ADMIN);
    s3.set('legacy/backups/prueba/erick/5215512345678/chat_backup.json', backup([{ id: '1', timestamp: 1, from: 'me', body: 'hola' }]));
    const ok = await getLegacyChat(adminEvent({ path: { campaign: 'prueba', agent: 'erick', phone: '5215512345678' } }));
    expect(parse(ok)).toMatchObject({ campaign: 'prueba', agent: 'erick', phone: '5215512345678', messages: [{ id: '1', body: 'hola', media: null }] });
    mockV4Me(ADMIN);
    const nf = await getLegacyChat(adminEvent({ path: { campaign: 'prueba', agent: 'erick', phone: '5210000000000' } }));
    expect(nf.statusCode).toBe(404);
    expect(parse(nf)).toEqual({ error: 'not_found' });
  });

  it('agentes legados: lista, sin lista y solo campos del contrato', async () => {
    mockV4Me(ADMIN);
    s3.set('legacy/agents/prueba.json', JSON.stringify({ schemaVersion: 1, campaign: 'prueba', agents: ['luis', 'erick'], extractedAt: '2026-10-01T00:00:00Z', password: 'sol-brillante' }));
    expect(parse(await getLegacyAgents(adminEvent({ path: { campaign: 'prueba' } })))).toEqual({ campaign: 'prueba', agents: ['erick', 'luis'], extractedAt: '2026-10-01T00:00:00Z' });
    mockV4Me(ADMIN);
    expect(parse(await getLegacyAgents(adminEvent({ path: { campaign: 'ventas' } })))).toEqual({ campaign: 'ventas', agents: [], extractedAt: null });
  });

  it('log legacy_chat_access con usuario, campaña, agente y teléfono, sin cuerpos ni URLs firmadas', async () => {
    mockV4Me(ADMIN);
    const log = vi.spyOn(console, 'log');
    s3.set('legacy/backups/prueba/erick/5215512345678/chat_backup.json', backup([{ id: '1', timestamp: 1, from: 'me', body: 'secreto deudor', mediaUrl: 'media/prueba/erick/f.jpg' }]));
    await getLegacyChat(adminEvent({ username: 'Admin.X', path: { campaign: 'prueba', agent: 'erick', phone: '5215512345678' } }));
    const lines = log.mock.calls.flat().map(String);
    const access = lines.map((l) => JSON.parse(l)).find((l) => l.evt === 'legacy_chat_access');
    expect(access).toEqual({ evt: 'legacy_chat_access', user: 'admin.x', campaign: 'prueba', agent: 'erick', phone: '5215512345678', route: 'conversation', status: 200 });
    const all = [...lines, ...(console.error as any).mock.calls.flat().map(String)].join('\n');
    expect(all).not.toContain('secreto deudor');
    expect(all).not.toContain('X-Amz-Signature');
    expect(all).not.toContain('id-token-1');
  });

  it('serverless.yml: solo métodos GET en rutas legacy y con cognitoAdminJwt', () => {
    const cfg = parseYaml(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));
    const events = Object.values<any>(cfg.functions).flatMap((f) => (f.events ?? []).map((e: any) => e.httpApi).filter(Boolean));
    const legacy = events.filter((e: any) => /legacy-/.test(e.path));
    expect(legacy).toHaveLength(3);
    for (const e of legacy) {
      expect(e.method).toBe('get');
      expect(e.authorizer?.name).toBe('cognitoAdminJwt');
    }
  });
});

describe('scripts/build-legacy-chat-index', () => {
  const fixedNow = () => new Date('2026-10-26T00:00:00Z');

  it('índice esperado para 2 conversaciones + respaldo ilegible, sin respaldos diarios', async () => {
    s3.set(
      'legacy/backups/prueba/erick/5215512345678/chat_backup.json',
      backup(Array.from({ length: 12 }, (_, i) => ({ id: String(i), timestamp: i === 0 ? '2026-08-01T15:00:00Z' : i === 11 ? '2026-09-15T18:00:00Z' : '2026-08-10T00:00:00Z', body: 'x' }))),
    );
    s3.set('legacy/backups/prueba/luis/5215599999999/chat_backup.json', backup([{ id: 'a', timestamp: '2026-07-01T00:00:00Z' }]));
    s3.set('legacy/backups/prueba/ana/5215500000001/chat_backup.json', '{roto');
    s3.set('legacy/backups/prueba/2026-09/erick_15.json', '{}');
    const r = await buildIndexes(client, { bucket: 'b', apply: true, now: fixedNow });
    expect(r.unreadable).toBe(1);
    expect(r.written).toEqual(['legacy/index/prueba.json']);
    const idx = s3.json('legacy/index/prueba.json');
    expect(idx.schemaVersion).toBe(1);
    expect(idx.generatedAt).toBe('2026-10-26T00:00:00.000Z');
    expect(idx.conversations).toEqual([
      { agent: 'ana', phone: '5215500000001', totalMessages: 0, firstMessageAt: null, lastMessageAt: null },
      { agent: 'erick', phone: '5215512345678', totalMessages: 12, firstMessageAt: '2026-08-01T15:00:00.000Z', lastMessageAt: '2026-09-15T18:00:00.000Z' },
      { agent: 'luis', phone: '5215599999999', totalMessages: 1, firstMessageAt: '2026-07-01T00:00:00.000Z', lastMessageAt: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('dry-run sin PutObject', async () => {
    s3.set('legacy/backups/prueba/erick/5215512345678/chat_backup.json', backup([]));
    const r = await buildIndexes(client, { bucket: 'b', apply: false });
    expect(Object.keys(r.indexes)).toEqual(['prueba']);
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('--campaign limita el listado', async () => {
    s3.set('legacy/backups/prueba/erick/1/chat_backup.json', backup([]));
    s3.set('legacy/backups/ventas/ana/2/chat_backup.json', backup([]));
    const r = await buildIndexes(client, { bucket: 'b', apply: false, campaign: 'ventas' });
    expect(Object.keys(r.indexes)).toEqual(['ventas']);
  });
});
