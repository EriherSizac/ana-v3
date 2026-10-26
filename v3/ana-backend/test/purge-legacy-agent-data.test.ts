import { mockClient } from 'aws-sdk-client-mock';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { beforeEach, describe, expect, it } from 'vitest';
import { listPoolUsernames, runPurge, usernamesFromCredentialsCsv, formatReport } from '../scripts/purge-legacy-agent-data';

/** S3 en memoria por bucket (el archivo es otro bucket). */
const s3mock = mockClient(S3Client);
const client = new S3Client({ region: 'us-east-1' });
const DATA = 'ana-backend-storage-test';
const ARCHIVE = 'ana-legacy-archive-test';
type Obj = { body: string; lastModified: Date; etag: string };
let buckets: Record<string, Map<string, Obj>>;
let n = 0;
/** Si se define, la copia al archivo de esa llave "se pierde" (para probar el conteo). */
let dropArchiveKey: string | null = null;

const BEFORE = new Date('2026-10-01T00:00:00Z');
const CUTOVER = new Date('2026-11-01T00:00:00Z');
const AFTER = new Date('2026-11-05T00:00:00Z');

const put = (bucket: string, key: string, body: string, lastModified = BEFORE) =>
  buckets[bucket]!.set(key, { body, lastModified, etag: `"e${++n}"` });
const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

function install() {
  buckets = { [DATA]: new Map(), [ARCHIVE]: new Map() };
  s3mock.on(ListObjectsV2Command).callsFake((i: any) => {
    const b = buckets[i.Bucket]!;
    const keys = [...b.keys()].filter((k) => k.startsWith(i.Prefix || '')).sort();
    return { Contents: keys.map((Key) => ({ Key, Size: b.get(Key)!.body.length, ETag: b.get(Key)!.etag, LastModified: b.get(Key)!.lastModified })), IsTruncated: false };
  });
  s3mock.on(GetObjectCommand).callsFake((i: any) => {
    const o = buckets[i.Bucket]!.get(i.Key);
    if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: { transformToString: async () => o.body } };
  });
  s3mock.on(HeadObjectCommand).callsFake((i: any) => {
    const o = buckets[i.Bucket]!.get(i.Key);
    if (!o) throw notFound();
    return { ContentLength: o.body.length, ETag: o.etag };
  });
  s3mock.on(PutObjectCommand).callsFake((i: any) => {
    put(i.Bucket, i.Key, String(i.Body), new Date());
    return {};
  });
  s3mock.on(CopyObjectCommand).callsFake((i: any) => {
    const [srcBucket, ...rest] = String(i.CopySource).split('/');
    const srcKey = rest.map(decodeURIComponent).join('/');
    const o = buckets[srcBucket!]!.get(srcKey);
    if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    if (i.Bucket === ARCHIVE && srcKey === dropArchiveKey) return {};
    buckets[i.Bucket]!.set(i.Key, { ...o, lastModified: new Date() });
    return {};
  });
  s3mock.on(DeleteObjectCommand).callsFake((i: any) => {
    buckets[i.Bucket]!.delete(i.Key);
    return {};
  });
}

const POOL = ['Ana.Lopez', 'pedro'];
const deps = { s3: client, listPoolUsers: async () => POOL };
const base = { bucket: DATA, archiveBucket: ARCHIVE, apply: false, deleteSource: false, cutover: CUTOVER, treatAsLegacy: new Set<string>() };
const logs: string[] = [];
const opts = (o: Partial<typeof base> = {}) => ({ ...base, ...o, log: (l: string) => logs.push(l), now: () => new Date('2026-11-20T10:00:00Z') });

const CREDENTIALS = 'user,password\nErick,frase-secreta-uno\nluis,frase-secreta-dos\n';

beforeEach(() => {
  s3mock.reset();
  install();
  dropArchiveKey = null;
  logs.length = 0;
  put(DATA, 'agents/prueba/credentials.csv', CREDENTIALS);
  put(DATA, 'agents/prueba/erick-contacts-1.csv', 'contact_phone\n1');
  put(DATA, 'assignments/agents/prueba/erick-contacts-1.csv', 'contact_phone\n1');
  put(DATA, 'historic/agents/prueba/erick-contacts-1.csv', 'contact_phone\n1');
  put(DATA, 'historic/agents/prueba/ana.lopez-contacts-2.csv', 'contact_phone\n2', AFTER); // username del pool, tras el cutover
  put(DATA, 'chats/erick-prueba.csv', 'contact_phone\n1');
  put(DATA, 'review/prueba/erick/a1.csv', 'contact_phone\n1');
  put(DATA, 'review-state/prueba/erick/a1.json', '{"schemaVersion":1,"items":{}}');
  put(DATA, 'backups/prueba/erick/5215512345678/chat_backup.json', '{"messages":[]}');
  put(DATA, 'backups/prueba/2026-09/erick_15.json', '{"x":1}');
  put(DATA, 'media/prueba/erick/img.jpg', 'JPEGDATA');
  put(DATA, 'backups/prueba/pedro/5215500000000/chat_backup.json', '{"messages":[]}'); // pool → ambiguo
  put(DATA, 'versions/latest.json', '{"version":"1.0.46"}');
  put(DATA, 'campaign-agents/prueba.json', '{}');
  put(DATA, 'rosters/prueba.json', '{}');
});

const data = () => buckets[DATA]!;
const archive = () => buckets[ARCHIVE]!;
const writes = () => [...s3mock.commandCalls(PutObjectCommand), ...s3mock.commandCalls(CopyObjectCommand), ...s3mock.commandCalls(DeleteObjectCommand)];

describe('purge-legacy-agent-data', () => {
  it('dry-run: clasifica sin escrituras', async () => {
    const r = await runPurge(deps, opts());
    expect(writes()).toHaveLength(0);
    const k = (key: string) => r.classified.find((c) => c.key === key)?.klass;
    expect(k('backups/prueba/erick/5215512345678/chat_backup.json')).toBe('legacy');
    expect(k('historic/agents/prueba/ana.lopez-contacts-2.csv')).toBe('new');
    expect(k('backups/prueba/pedro/5215500000000/chat_backup.json')).toBe('ambiguous');
    expect(r.classified.some((c) => c.key.startsWith('versions/') || c.key.startsWith('campaign-agents/') || c.key.startsWith('rosters/'))).toBe(false);
    expect(r.legacyAgents).toEqual({ prueba: ['erick', 'luis'] });
    const report = formatReport(r, opts());
    expect(report).toContain('DRY-RUN');
    expect(report).not.toContain('frase-secreta');
  });

  it('--apply: legacy/agents sin frases, movimientos y archivo; sin --delete-source el original sigue', async () => {
    const r = await runPurge(deps, opts({ apply: true }));
    expect(r.aborted).toBeUndefined();
    const legacyAgents = JSON.parse(data().get('legacy/agents/prueba.json')!.body);
    expect(legacyAgents).toEqual({ schemaVersion: 1, campaign: 'prueba', agents: ['erick', 'luis'], extractedAt: '2026-11-20T10:00:00.000Z' });
    expect(data().get('legacy/agents/prueba.json')!.body).not.toContain('frase');

    expect(data().has('legacy/backups/prueba/erick/5215512345678/chat_backup.json')).toBe(true);
    expect(data().has('legacy/backups/prueba/2026-09/erick_15.json')).toBe(true);
    expect(data().has('legacy/media/prueba/erick/img.jpg')).toBe(true);

    for (const key of [
      'agents/prueba/credentials.csv',
      'agents/prueba/erick-contacts-1.csv',
      'assignments/agents/prueba/erick-contacts-1.csv',
      'historic/agents/prueba/erick-contacts-1.csv',
      'chats/erick-prueba.csv',
      'review/prueba/erick/a1.csv',
      'review-state/prueba/erick/a1.json',
    ]) {
      expect(archive().has(key), key).toBe(true);
      expect(data().has(key), key).toBe(true); // sin --delete-source
    }
    expect(data().has('backups/prueba/erick/5215512345678/chat_backup.json')).toBe(true);
    // intactos
    expect(archive().has('historic/agents/prueba/ana.lopez-contacts-2.csv')).toBe(false);
    expect(data().has('legacy/backups/prueba/pedro/5215500000000/chat_backup.json')).toBe(false);
    expect(data().get('versions/latest.json')!.body).toBe('{"version":"1.0.46"}');
    expect(s3mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key)).toEqual(['legacy/agents/prueba.json']);
    // el log solo tiene llaves
    const all = logs.join('\n');
    expect(all).not.toMatch(/frase|messages|JPEGDATA|contact_phone/);
    expect(all).toContain('ARCHIVE agents/prueba/credentials.csv');
  });

  it('--apply --delete-source: borra originales (tras archivar), deja ambiguos y nuevos', async () => {
    const r = await runPurge(deps, opts({ apply: true, deleteSource: true }));
    expect(r.aborted).toBeUndefined();
    for (const key of ['agents/prueba/credentials.csv', 'historic/agents/prueba/erick-contacts-1.csv', 'backups/prueba/erick/5215512345678/chat_backup.json', 'media/prueba/erick/img.jpg', 'review-state/prueba/erick/a1.json']) {
      expect(data().has(key), key).toBe(false);
    }
    // credentials.csv archivado ANTES de borrarse
    const calls = s3mock.calls().map((c) => [c.args[0].constructor.name, (c.args[0].input as any).Bucket, (c.args[0].input as any).Key]);
    const archivedAt = calls.findIndex(([n, b, k]) => n === 'CopyObjectCommand' && b === ARCHIVE && k === 'agents/prueba/credentials.csv');
    const deletedAt = calls.findIndex(([n, , k]) => n === 'DeleteObjectCommand' && k === 'agents/prueba/credentials.csv');
    const extractedAt = calls.findIndex(([n, , k]) => n === 'PutObjectCommand' && k === 'legacy/agents/prueba.json');
    expect(extractedAt).toBeGreaterThanOrEqual(0);
    expect(extractedAt).toBeLessThan(archivedAt);
    expect(archivedAt).toBeLessThan(deletedAt);
    expect(data().has('historic/agents/prueba/ana.lopez-contacts-2.csv')).toBe(true);
    expect(data().has('backups/prueba/pedro/5215500000000/chat_backup.json')).toBe(true);
    expect(data().has('versions/latest.json')).toBe(true);
    expect(data().has('campaign-agents/prueba.json') && data().has('rosters/prueba.json')).toBe(true);
  });

  it('destino existente distinto → conflicto sin sobrescribir y sin borrar', async () => {
    put(DATA, 'legacy/backups/prueba/erick/5215512345678/chat_backup.json', 'OTRO CONTENIDO MÁS LARGO');
    const r = await runPurge(deps, opts({ apply: true, deleteSource: true }));
    expect(r.moved.find((m) => m.from === 'backups/prueba/erick/5215512345678/chat_backup.json')?.status).toBe('conflict');
    expect(data().get('legacy/backups/prueba/erick/5215512345678/chat_backup.json')!.body).toBe('OTRO CONTENIDO MÁS LARGO');
    expect(r.aborted).toMatch(/diferencias/);
    expect(s3mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('conteo del archivo distinto → aborta sin borrar', async () => {
    dropArchiveKey = 'historic/agents/prueba/erick-contacts-1.csv';
    const r = await runPurge(deps, opts({ apply: true, deleteSource: true }));
    expect(r.aborted).toMatch(/archivo tiene 6 de 7/);
    expect(s3mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(data().has('agents/prueba/credentials.csv')).toBe(true);
  });

  it('--treat-as-legacy convierte un ambiguo revisado en legado; nunca toca rosters', async () => {
    const r = await runPurge(deps, opts({ apply: true, treatAsLegacy: new Set(['pedro']) }));
    expect(data().has('legacy/backups/prueba/pedro/5215500000000/chat_backup.json')).toBe(true);
    expect(r.legacyAgents.prueba).toEqual(['erick', 'luis', 'pedro']);
    expect(data().get('rosters/prueba.json')!.body).toBe('{}');
  });

  it('corrida repetida no reescribe legacy/agents con el mismo contenido', async () => {
    await runPurge(deps, opts({ apply: true }));
    s3mock.resetHistory();
    const r = await runPurge(deps, opts({ apply: true }));
    expect(r.written).toEqual([]);
    expect(r.moved.every((m) => m.status === 'identical')).toBe(true);
  });

  it('--delete-source sin --apply se rechaza', async () => {
    await expect(runPurge(deps, opts({ deleteSource: true }))).rejects.toThrow(/requiere --apply/);
  });
});

describe('utilidades', () => {
  it('usernamesFromCredentialsCsv: solo la columna de usuario', () => {
    expect(usernamesFromCredentialsCsv('﻿user,password\r\nErick,uno\nluis,dos\nerick,tres\n')).toEqual(['erick', 'luis']);
    expect(usernamesFromCredentialsCsv('')).toEqual([]);
  });

  it('listPoolUsernames pagina ListUsers', async () => {
    const cog = mockClient(CognitoIdentityProviderClient);
    cog.on(ListUsersCommand).callsFake((i: any) =>
      i.PaginationToken ? { Users: [{ Username: 'b' }] } : { Users: [{ Username: 'a' }], PaginationToken: 't1' },
    );
    expect(await listPoolUsernames(new CognitoIdentityProviderClient({ region: 'us-east-2' }), 'pool')).toEqual(['a', 'b']);
  });
});
