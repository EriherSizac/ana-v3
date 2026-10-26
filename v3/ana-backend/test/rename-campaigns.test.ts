import { mockClient } from 'aws-sdk-client-mock';
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runRename, validateMapping } from '../scripts/rename-campaigns';
import { installCondS3, type CondS3 } from './helpers/condS3';

const s3mock = mockClient(S3Client);
const client = new S3Client({ region: 'us-east-1' });
let s3: CondS3;
const BUCKET = 'ana-backend-storage-test';
const base = { bucket: BUCKET, apply: false, includeReady: false, deleteSource: false };

const ALL_PREFIX_KEYS = [
  'agents/viejo/credentials.csv',
  'assignments/agents/viejo/erick-contacts-1.csv',
  'rosters/viejo.json',
  'backups/viejo/erick/b.json',
  'media/viejo/erick/img.jpg',
  'historic/agents/viejo/erick-contacts-1.csv',
  'uploads/viejo/u1/manifest.json',
  'review/viejo/erick/r.csv',
  'review-state/viejo/u1.json',
  'chats/erick-viejo.csv',
];

beforeEach(() => {
  s3mock.reset();
  s3 = installCondS3(s3mock);
});

const copies = () => s3mock.commandCalls(CopyObjectCommand).map((c) => [c.args[0].input.CopySource, c.args[0].input.Key]);

describe('rename-campaigns', () => {
  it('dry-run: plan sin escrituras', async () => {
    for (const k of ALL_PREFIX_KEYS) s3.set(k, `contenido ${k}`);
    const r = await runRename(client, { viejo: 'nueva' }, base);
    expect(r.plan.items.filter((i) => i.action === 'copy')).toHaveLength(ALL_PREFIX_KEYS.length);
    expect(s3mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('--apply copia cada prefijo (y chats por sufijo), sin campaign-agents/', async () => {
    for (const k of ALL_PREFIX_KEYS) s3.set(k, `contenido ${k}`);
    s3.set('campaign-agents/viejo.json', '{}');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true });
    expect(r.differences).toEqual([]);
    for (const k of ALL_PREFIX_KEYS) {
      const target = k === 'chats/erick-viejo.csv' ? 'chats/erick-nueva.csv' : k === 'rosters/viejo.json' ? 'rosters/nueva.json' : k.replace('/viejo/', '/nueva/');
      expect(s3.store.has(target), target).toBe(true);
      expect(s3.store.has(k)).toBe(true); // sin --delete-source no borra
    }
    expect(s3.store.has('campaign-agents/nueva.json')).toBe(false);
    expect(copies().some(([, key]) => String(key).startsWith('campaign-agents/'))).toBe(false);
  });

  it('chats/erick-viejo.csv → chats/erick-nueva.csv', async () => {
    s3.set('chats/erick-viejo.csv', 'x');
    await runRename(client, { viejo: 'nueva' }, { ...base, apply: true });
    expect(copies()).toEqual([[`${BUCKET}/chats/erick-viejo.csv`, 'chats/erick-nueva.csv']]);
  });

  it('destino idéntico se omite y destino distinto es conflicto', async () => {
    s3.set('agents/viejo/credentials.csv', 'a');
    s3.store.set('agents/nueva/credentials.csv', { ...s3.store.get('agents/viejo/credentials.csv')! });
    s3.set('backups/viejo/b.json', 'original');
    s3.set('backups/nueva/b.json', 'otra cosa');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true });
    const byKey = Object.fromEntries(r.plan.items.map((i) => [i.source, i.action]));
    expect(byKey['agents/viejo/credentials.csv']).toBe('identical');
    expect(byKey['backups/viejo/b.json']).toBe('conflict');
    expect(s3.store.get('backups/nueva/b.json')!.body).toBe('otra cosa');
    expect(copies()).toHaveLength(0);
    expect(r.differences).toHaveLength(1);
  });

  it('contactos listos sin --include-ready no se copian; con el flag sí', async () => {
    s3.set('agents/viejo/erick-contacts-2026.csv', 'x');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true });
    expect(r.plan.items[0]!.action).toBe('ready-skipped');
    expect(copies()).toHaveLength(0);
    await runRename(client, { viejo: 'nueva' }, { ...base, apply: true, includeReady: true });
    expect(s3.store.has('agents/nueva/erick-contacts-2026.csv')).toBe(true);
  });

  it('--delete-source no borra si hay diferencias', async () => {
    s3.set('agents/viejo/credentials.csv', 'a');
    s3.set('backups/viejo/b.json', 'original');
    s3.set('backups/nueva/b.json', 'otra cosa');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true, deleteSource: true });
    expect(r.differences.length).toBeGreaterThan(0);
    expect(r.deleted).toBe(0);
    expect(s3mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it('--delete-source borra orígenes verificados cuando no hay diferencias', async () => {
    for (const k of ALL_PREFIX_KEYS) s3.set(k, `contenido ${k}`);
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true, deleteSource: true });
    expect(r.differences).toEqual([]);
    expect(r.deleted).toBe(ALL_PREFIX_KEYS.length);
    for (const k of ALL_PREFIX_KEYS) expect(s3.store.has(k)).toBe(false);
    const after = r.plan.counts.find((c) => c.prefix === 'agents/')!;
    expect(after.target).toBe(1);
  });

  it('mapeo encadenado rechazado', () => {
    expect(() => validateMapping({ a: 'b', b: 'c' })).toThrow(/encadenado/);
  });

  it('destino no normalizado rechazado', () => {
    expect(() => validateMapping({ viejo: 'Nueva' })).toThrow(/no normalizado/);
  });

  it('origen inexistente rechazado', async () => {
    s3.set('agents/otra/credentials.csv', 'x');
    await expect(runRename(client, { viejo: 'nueva' }, base)).rejects.toThrow(/no tiene datos/);
  });

  it('agents/Viejo/x sin copia normalizada → aborta sin copiar', async () => {
    s3.set('agents/Viejo/x.csv', 'x');
    s3.set('agents/viejo/credentials.csv', 'c');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true });
    expect(r.aborted).toMatch(/mayúsculas/);
    expect(r.plan.uppercaseMissing).toEqual(['agents/Viejo/x.csv']);
    expect(copies()).toHaveLength(0);
  });

  it('original con mayúsculas con copia normalizada = inerte (se reporta, no se copia)', async () => {
    s3.set('agents/Viejo/x.csv', 'x');
    s3.set('agents/viejo/x.csv', 'x');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, apply: true });
    expect(r.aborted).toBeUndefined();
    expect(r.plan.uppercaseInert).toEqual(['agents/Viejo/x.csv']);
    expect(copies()).toEqual([[`${BUCKET}/agents/viejo/x.csv`, 'agents/nueva/x.csv']]);
  });

  it('chats ambiguos (sufijo de varias campañas origen) no se copian', async () => {
    s3.set('chats/erick-a-viejo.csv', 'x');
    s3.set('agents/viejo/credentials.csv', 'c');
    s3.set('agents/a-viejo/credentials.csv', 'c');
    const r = await runRename(client, { viejo: 'nueva', 'a-viejo': 'otra' }, { ...base, apply: true });
    expect(r.plan.items.find((i) => i.source === 'chats/erick-a-viejo.csv')!.action).toBe('ambiguous');
    expect(s3.store.has('chats/erick-a-nueva.csv')).toBe(false);
  });

  it('inventario de campañas fuera del catálogo', async () => {
    s3.set('agents/viejo/credentials.csv', 'c');
    s3.set('agents/didi_vip/credentials.csv', 'c');
    const r = await runRename(client, { viejo: 'nueva' }, { ...base, catalog: ['didi_vip', 'nueva'] });
    expect(r.plan.outsideCatalog).toEqual(['viejo']);
  });
});
