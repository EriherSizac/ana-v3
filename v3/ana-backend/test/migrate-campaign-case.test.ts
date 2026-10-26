import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { runMigration, formatReport, parseArgs, type Options } from '../scripts/migrate-campaign-case';
import { installMemS3 } from './helpers/memS3';

const s3 = mockClient(S3Client);
const client = new S3Client({ region: 'us-east-1' });
const TS = '2026-10-26T15-04-05-123Z';
const base: Options = { bucket: 'b', apply: false, includeReady: false };

const copies = () =>
  s3.commandCalls(CopyObjectCommand).map((c) => {
    const i = c.args[0].input as any;
    return { from: decodeURIComponent(String(i.CopySource).replace(/^b\//, '')), to: i.Key };
  });

const byTarget = (plan: Awaited<ReturnType<typeof runMigration>>['plan'], target: string) =>
  plan.filter((p) => p.target === target);

beforeEach(() => s3.reset());

describe('migrate-campaign-case', () => {
  const fixture = () => ({
    'agents/Prueba/credentials.csv': 'secreto',
    [`assignments/agents/Prueba/Erick-contacts-${TS}.csv`]: 'a',
    [`assignments/agents/prueba/Ana-contacts-${TS}.csv`]: 'b',
    [`agents/prueba/Erick-contacts-${TS}.csv`]: { body: 'c', lastModified: new Date('2026-10-20T00:00:00Z') },
    'agents/prueba/erick-contacts-x.csv': 'ya-normalizado',
  });

  it('dry-run arma el plan y no emite CopyObject', async () => {
    const store = installMemS3(s3, fixture());
    const { plan, scanned } = await runMigration(client, base);
    expect(scanned).toBe(5);
    expect(s3.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(store.size).toBe(5);

    expect(byTarget(plan, 'agents/prueba/credentials.csv')[0]).toMatchObject({
      source: 'agents/Prueba/credentials.csv',
      category: 'credentials',
      action: 'copy',
    });
    expect(byTarget(plan, `assignments/agents/prueba/erick-contacts-${TS}.csv`)[0]).toMatchObject({
      category: 'pending',
      action: 'copy',
    });
    expect(byTarget(plan, `assignments/agents/prueba/ana-contacts-${TS}.csv`)[0].action).toBe('copy');
    expect(byTarget(plan, `agents/prueba/erick-contacts-${TS}.csv`)[0]).toMatchObject({
      category: 'ready',
      action: 'ready-skipped',
      lastModified: '2026-10-20T00:00:00.000Z',
    });
    // Ya normalizado: no aparece en el plan.
    expect(plan.find((p) => p.source === 'agents/prueba/erick-contacts-x.csv')).toBeUndefined();

    const report = formatReport(plan, base, scanned);
    expect(report).toContain('DRY-RUN');
    expect(report).not.toContain('secreto');
  });

  it('--apply copia sin borrar; ready solo con --include-ready', async () => {
    const store = installMemS3(s3, fixture());
    await runMigration(client, { ...base, apply: true });
    expect(copies()).toEqual(
      expect.arrayContaining([
        { from: 'agents/Prueba/credentials.csv', to: 'agents/prueba/credentials.csv' },
        { from: `assignments/agents/Prueba/Erick-contacts-${TS}.csv`, to: `assignments/agents/prueba/erick-contacts-${TS}.csv` },
        { from: `assignments/agents/prueba/Ana-contacts-${TS}.csv`, to: `assignments/agents/prueba/ana-contacts-${TS}.csv` },
      ])
    );
    expect(copies()).toHaveLength(3);
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(store.get('agents/prueba/credentials.csv')!.body).toBe('secreto');
    expect(store.has('agents/Prueba/credentials.csv')).toBe(true);

    s3.reset();
    installMemS3(s3, fixture());
    await runMigration(client, { ...base, apply: true, includeReady: true });
    expect(copies()).toContainEqual({
      from: `agents/prueba/Erick-contacts-${TS}.csv`,
      to: `agents/prueba/erick-contacts-${TS}.csv`,
    });
  });

  it('--ready-since excluye ready anteriores a la fecha', async () => {
    installMemS3(s3, fixture());
    const { plan } = await runMigration(client, {
      ...base,
      apply: true,
      includeReady: true,
      readySince: new Date('2026-10-25T00:00:00Z'),
    });
    expect(byTarget(plan, `agents/prueba/erick-contacts-${TS}.csv`)[0].action).toBe('ready-skipped');
    expect(copies().map((c) => c.to)).not.toContain(`agents/prueba/erick-contacts-${TS}.csv`);
  });

  it('destino existente → conflicto, sin sobrescribir', async () => {
    const store = installMemS3(s3, {
      'agents/Prueba/credentials.csv': 'viejo',
      'agents/prueba/credentials.csv': 'actual',
    });
    const { plan } = await runMigration(client, { ...base, apply: true });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: 'conflict', reason: 'el destino ya existe' });
    expect(s3.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(store.get('agents/prueba/credentials.csv')!.body).toBe('actual');
  });

  it('colisión de dos orígenes → conflicto para ambos', async () => {
    installMemS3(s3, {
      'agents/Prueba/credentials.csv': '1',
      'agents/PRUEBA/credentials.csv': '2',
      [`assignments/agents/prueba/Erick-contacts-${TS}.csv`]: '3',
      [`assignments/agents/prueba/ERICK-contacts-${TS}.csv`]: '4',
    });
    const { plan } = await runMigration(client, { ...base, apply: true });
    expect(plan).toHaveLength(4);
    expect(plan.every((p) => p.action === 'conflict')).toBe(true);
    expect(s3.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('pagina el listado con ContinuationToken', async () => {
    const objects: Record<string, string> = {};
    for (let i = 0; i < 5; i++) objects[`assignments/agents/Prueba/Erick-contacts-${i}.csv`] = String(i);
    installMemS3(s3, objects, 2);
    const { plan, scanned } = await runMigration(client, base);
    expect(scanned).toBe(5);
    expect(plan.filter((p) => p.action === 'copy')).toHaveLength(5);
    expect(s3.commandCalls(ListObjectsV2Command).length).toBeGreaterThan(2);
  });

  it('parseArgs: dry-run por defecto y valida argumentos', () => {
    expect(parseArgs(['--bucket', 'x'])).toMatchObject({ bucket: 'x', apply: false, includeReady: false, region: 'us-east-1' });
    expect(parseArgs(['--bucket', 'x', '--apply', '--include-ready', '--profile', 'p'])).toMatchObject({
      apply: true,
      includeReady: true,
      profile: 'p',
    });
    expect(() => parseArgs([])).toThrow('--bucket');
    expect(() => parseArgs(['--bucket', 'x', '--ready-since', 'nope'])).toThrow('--ready-since');
  });
});
