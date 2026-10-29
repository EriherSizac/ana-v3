import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postResults } from '../src/handlers/agentResults';
import type { AgentEvent } from '../src/handlers/agentAssignments';
import { adminLookup, adminMark, agentLookup, agentMark } from '../src/handlers/waStatus';
import { clearRosterReaderCache } from '../src/lib/roster';
import { applyWaEvent, eventsFromResults, lookupWaStatus, normalizeWaPhone, parseLookupBody, WaLookupIncompleteError } from '../src/lib/waStatus';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { installMemDynamo, type MemDynamo } from './helpers/memDynamo';
import { adminEvent, AGENT, derivedList, LEADER_DIDI, LEADER_PRUEBA, mockV4Me, parse } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

/** add-whatsapp-status-registry: registro de estado de WhatsApp por teléfono. */
const s3mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);
let s3: CondS3;
let db: MemDynamo;

const NOW = new Date('2026-10-29T18:00:00Z');
const A1 = '20261029T1000-ab12cd34';
const P1 = '525512345678';

const agentEv = (body: unknown, user: string | null = 'Ana.Lopez'): AgentEvent => ({
  headers: user === null ? {} : { ...bearer(signIdToken({ 'cognito:username': user })), 'x-ana-cli-version': '1.0.51' },
  pathParameters: {},
  queryStringParameters: {},
  body: body === undefined ? null : JSON.stringify(body),
});

const result = (rowIndex: number, over: Record<string, unknown> = {}) => ({
  id: `${A1}#${rowIndex}#1`,
  assignmentId: A1,
  rowIndex,
  attempt: 1,
  phone: '5215512345678',
  status: 'no_whatsapp',
  sentAt: '2026-10-29T17:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  s3mock.reset();
  ddbMock.reset();
  clearRosterReaderCache();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  process.env.WA_STATUS_TABLE = 'ana-backend-wa-status-test';
  s3 = installCondS3(s3mock);
  db = installMemDynamo(ddbMock);
  setupAgentAuth({ enforced: true });
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'luis']));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.WA_STATUS_TABLE;
});

describe('normalizeWaPhone', () => {
  it('10, 52+10 y 521+10 → 52+10; otras longitudes → null', () => {
    expect(normalizeWaPhone('55 1234 5678')).toBe(P1);
    expect(normalizeWaPhone('+52 55 1234 5678')).toBe(P1);
    expect(normalizeWaPhone('5215512345678')).toBe(P1);
    expect(normalizeWaPhone('15512345678')).toBeNull();
    expect(normalizeWaPhone('4415512345678')).toBeNull();
    expect(normalizeWaPhone('')).toBeNull();
    expect(normalizeWaPhone(undefined)).toBeNull();
  });
});

describe('escritura ordenada (D3)', () => {
  const ev = (status: 'no_whatsapp' | 'has_whatsapp', at: string, over: Record<string, unknown> = {}) => ({
    phone: P1,
    status,
    at,
    by: 'ana.lopez',
    source: 'cli_send' as const,
    campaign: 'prueba',
    ...over,
  });

  it('primer no_whatsapp crea el registro con contador 1', async () => {
    expect(await applyWaEvent(ev('no_whatsapp', '2026-10-29T17:00:00.000Z'))).toBe('applied');
    expect(db.table.get(P1)).toMatchObject({ status: 'no_whatsapp', updatedBy: 'ana.lopez', source: 'cli_send', noWaCount: 1, lastNoWaAt: '2026-10-29T17:00:00.000Z', campaign: 'prueba' });
  });

  it('reintento del mismo evento no cuenta dos veces', async () => {
    await applyWaEvent(ev('no_whatsapp', '2026-10-29T17:00:00.000Z'));
    expect(await applyWaEvent(ev('no_whatsapp', '2026-10-29T17:00:00.000Z'))).toBe('skipped');
    expect(db.table.get(P1)!.noWaCount).toBe(1);
  });

  it('marca manual más nueva no se pisa con un no_whatsapp atrasado (pero el contador sí registra el evento)', async () => {
    await applyWaEvent(ev('no_whatsapp', '2026-10-28T10:00:00.000Z'));
    await applyWaEvent(ev('has_whatsapp', '2026-10-30T10:00:00.000Z', { by: 'lider', source: 'admin_manual', note: 'confirmado' }));
    expect(await applyWaEvent(ev('no_whatsapp', '2026-10-29T17:00:00.000Z'))).toBe('counted');
    expect(db.table.get(P1)).toMatchObject({ status: 'has_whatsapp', updatedBy: 'lider', note: 'confirmado', noWaCount: 2, lastNoWaAt: '2026-10-29T17:00:00.000Z' });
  });

  it('sent más nuevo pasa a has_whatsapp, fija lastSentAt y borra la nota manual', async () => {
    await applyWaEvent(ev('no_whatsapp', '2026-10-28T10:00:00.000Z', { source: 'agent_manual', note: 'número viejo' }));
    expect(await applyWaEvent(ev('has_whatsapp', '2026-10-29T17:00:00.000Z', { note: null }))).toBe('applied');
    const it = db.table.get(P1)!;
    expect(it).toMatchObject({ status: 'has_whatsapp', lastSentAt: '2026-10-29T17:00:00.000Z', noWaCount: 1 });
    expect(it.note).toBeUndefined();
  });

  it('sent atrasado solo adelanta lastSentAt; un manual atrasado no hace nada', async () => {
    await applyWaEvent(ev('no_whatsapp', '2026-10-30T10:00:00.000Z'));
    expect(await applyWaEvent(ev('has_whatsapp', '2026-10-29T17:00:00.000Z'))).toBe('counted');
    expect(db.table.get(P1)).toMatchObject({ status: 'no_whatsapp', lastSentAt: '2026-10-29T17:00:00.000Z' });
    expect(await applyWaEvent(ev('has_whatsapp', '2026-10-29T18:00:00.000Z', { source: 'agent_manual' }))).toBe('skipped');
  });

  it('eventsFromResults: solo sent/no_whatsapp con teléfono MX, ordenados por fecha', () => {
    const evs = eventsFromResults(
      [
        { phone: '5215500000002', status: 'sent', sentAt: '2026-10-29T17:05:00.000Z' },
        { phone: '5215500000001', status: 'no_whatsapp', sentAt: '2026-10-29T17:00:00.000Z' },
        { phone: '5215500000003', status: 'error', sentAt: '2026-10-29T17:01:00.000Z' },
        { phone: '4415500000003', status: 'sent', sentAt: '2026-10-29T17:01:00.000Z' },
      ],
      'prueba',
      'ana.lopez',
    );
    expect(evs.map((e) => [e.phone, e.status])).toEqual([
      ['525500000001', 'no_whatsapp'],
      ['525500000002', 'has_whatsapp'],
    ]);
  });
});

describe('POST /agent/results → registro (D4)', () => {
  it('no_whatsapp y sent actualizan el registro; el reintento del lote no duplica', async () => {
    const body = { campaign: 'prueba', items: [result(0), result(1, { phone: '5215500000009', status: 'sent' })] };
    expect((await postResults(agentEv(body))).statusCode).toBe(200);
    expect(db.table.get(P1)).toMatchObject({ status: 'no_whatsapp', updatedBy: 'ana.lopez', noWaCount: 1 });
    expect(db.table.get('525500000009')).toMatchObject({ status: 'has_whatsapp', lastSentAt: '2026-10-29T17:00:00.000Z' });
    expect((await postResults(agentEv(body))).statusCode).toBe(200);
    expect(db.table.get(P1)!.noWaCount).toBe(1);
  });

  it('si el registro falla, el lote se acepta igual', async () => {
    db.failUpdates = true;
    const res = await postResults(agentEv({ campaign: 'prueba', items: [result(0)] }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.accepted).toBe(1);
    expect([...s3.store.keys()].some((k) => k.startsWith('results/prueba/ana.lopez/'))).toBe(true);
  });

  it('logs sin teléfonos', async () => {
    const log = vi.mocked(console.log);
    await postResults(agentEv({ campaign: 'prueba', items: [result(0)] }));
    const all = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(all).toContain('wa_status_results');
    expect(all).not.toContain('5512345678');
  });
});

describe('POST /agent/wa-status', () => {
  it('marca has_whatsapp con usuario y origen; rechaza teléfonos inválidos', async () => {
    const res = await agentMark(agentEv({ campaign: 'prueba', phones: ['55 1234 5678', '123', '5215512345678'], status: 'has_whatsapp', note: '  sí  contestó ' }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ updated: 1, rejected: [{ index: 1, reason: 'phone inválido' }] });
    expect(db.table.get(P1)).toMatchObject({ status: 'has_whatsapp', updatedBy: 'ana.lopez', source: 'agent_manual', updatedAt: NOW.toISOString(), note: 'sí contestó' });
  });

  it('volver a no_whatsapp suma al contador', async () => {
    await agentMark(agentEv({ campaign: 'prueba', phones: [P1], status: 'no_whatsapp' }));
    expect(db.table.get(P1)).toMatchObject({ status: 'no_whatsapp', noWaCount: 1, lastNoWaAt: NOW.toISOString() });
  });

  it('sin token → 401; fuera del roster → 403; body inválido → 400; nada se escribe', async () => {
    expect((await agentMark(agentEv({ campaign: 'prueba', phones: [P1], status: 'has_whatsapp' }, null))).statusCode).toBe(401);
    expect((await agentMark(agentEv({ campaign: 'otra', phones: [P1], status: 'has_whatsapp' }))).statusCode).toBe(403);
    expect((await agentMark(agentEv({ campaign: 'prueba', phones: [P1], status: 'tal_vez' }))).statusCode).toBe(400);
    expect((await agentMark(agentEv({ campaign: 'prueba', phones: Array(501).fill(P1), status: 'has_whatsapp' }))).statusCode).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});

describe('POST /agent/wa-status/lookup (D6)', () => {
  it('devuelve solo los teléfonos con registro, por teléfono normalizado', async () => {
    db.table.set(P1, { phone: P1, status: 'no_whatsapp', updatedAt: '2026-10-29T17:00:00.000Z', updatedBy: 'luis', source: 'cli_send', lastNoWaAt: '2026-10-29T17:00:00.000Z', noWaCount: 2, campaign: 'otra', note: 'x' });
    const res = await agentLookup(agentEv({ campaign: 'prueba', phones: ['5215512345678', '5500000000', 'basura'] }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.items).toEqual({
      [P1]: { status: 'no_whatsapp', updatedAt: '2026-10-29T17:00:00.000Z', updatedBy: 'luis', source: 'cli_send', lastNoWaAt: '2026-10-29T17:00:00.000Z', noWaCount: 2 },
    });
  });

  it('2000 teléfonos → bloques de 100; 2001 → 400', async () => {
    const phones = Array.from({ length: 2000 }, (_, i) => `55${String(i).padStart(8, '0')}`);
    expect((await agentLookup(agentEv({ campaign: 'prueba', phones }))).statusCode).toBe(200);
    expect(db.batchGets).toHaveLength(20);
    expect(db.batchGets.every((k) => k.length === 100)).toBe(true);
    expect((await agentLookup(agentEv({ campaign: 'prueba', phones: [...phones, '5500000001'] }))).statusCode).toBe(400);
    expect(parseLookupBody({ phones: [] })).toEqual({ error: 'phones requerido' });
  });

  it('reintenta UnprocessedKeys hasta completar', async () => {
    db.table.set(P1, { phone: P1, status: 'has_whatsapp', updatedAt: 'a', updatedBy: 'b', source: 'agent_manual', noWaCount: 0 });
    db.unprocessed = [1, 1];
    vi.useRealTimers();
    const out = await lookupWaStatus(['525500000001', P1], { backoffMs: 1 });
    expect(Object.keys(out)).toEqual([P1]);
    expect(db.batchGets.map((k) => k.length)).toEqual([2, 1, 1]);
  });

  it('UnprocessedKeys persistentes → 503 (no se presentan como "sin dato")', async () => {
    db.unprocessed = Array(10).fill(1);
    vi.useRealTimers();
    await expect(lookupWaStatus([P1], { backoffMs: 1 })).rejects.toBeInstanceOf(WaLookupIncompleteError);
  });

  it('fuera del roster → 403 sin leer DynamoDB', async () => {
    expect((await agentLookup(agentEv({ campaign: 'otra', phones: [P1] }))).statusCode).toBe(403);
    expect(db.batchGets).toHaveLength(0);
  });
});

describe('/admin/campaigns/{campaign}/wa-status', () => {
  it('líder en alcance marca con admin_manual', async () => {
    mockV4Me(LEADER_PRUEBA);
    const res = await adminMark(adminEvent({ username: 'Lider.Uno', path: { campaign: 'prueba' }, body: { phones: [P1], status: 'has_whatsapp' } }));
    expect(res.statusCode).toBe(200);
    expect(db.table.get(P1)).toMatchObject({ status: 'has_whatsapp', updatedBy: 'lider.uno', source: 'admin_manual', campaign: 'prueba' });
  });

  it('fuera de alcance o sin permisos de Contactos → 403 sin escribir ni leer', async () => {
    mockV4Me(LEADER_DIDI);
    expect((await adminMark(adminEvent({ path: { campaign: 'prueba' }, body: { phones: [P1], status: 'has_whatsapp' } }))).statusCode).toBe(403);
    mockV4Me(AGENT);
    expect((await adminLookup(adminEvent({ path: { campaign: 'prueba' }, body: { phones: [P1] } }))).statusCode).toBe(403);
    expect(db.updates).toHaveLength(0);
    expect(db.batchGets).toHaveLength(0);
  });

  it('lookup para la vista previa de carga', async () => {
    db.table.set(P1, { phone: P1, status: 'no_whatsapp', updatedAt: 'x', updatedBy: 'luis', source: 'cli_send', lastNoWaAt: 'x', noWaCount: 1 });
    mockV4Me(LEADER_PRUEBA);
    const res = await adminLookup(adminEvent({ path: { campaign: 'prueba' }, body: { phones: ['5512345678'] } }));
    expect(res.statusCode).toBe(200);
    expect(Object.keys(parse(res).data.items)).toEqual([P1]);
  });
});

describe('serverless.yml', () => {
  const cfg = parseYaml(readFileSync(join(__dirname, '..', 'serverless.yml'), 'utf8'));
  it('tabla bajo demanda con PITR y Retain; variable y permisos solo por llave', () => {
    const t = cfg.resources.Resources.WaStatusTable;
    expect(t.Type).toBe('AWS::DynamoDB::Table');
    expect(t.DeletionPolicy).toBe('Retain');
    expect(t.Properties.TableName).toBe('${self:service}-wa-status-${sls:stage}');
    expect(t.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    expect(t.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled).toBe(true);
    expect(t.Properties.KeySchema).toEqual([{ AttributeName: 'phone', KeyType: 'HASH' }]);
    expect(cfg.provider.environment.WA_STATUS_TABLE).toBe('${self:service}-wa-status-${sls:stage}');
    const st = cfg.provider.iam.role.statements.find((s: any) => s.Action.some((a: string) => a.startsWith('dynamodb:')));
    expect(st.Action.sort()).toEqual(['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem']);
    expect(st.Resource).toEqual([{ 'Fn::GetAtt': ['WaStatusTable', 'Arn'] }]);
  });

  it('rutas con su authorizer', () => {
    const route = (fn: string) => cfg.functions[fn].events[0].httpApi;
    expect(route('agentPostWaStatus')).toMatchObject({ path: '/agent/wa-status', method: 'post', authorizer: { name: 'cognitoAgentJwt' } });
    expect(route('agentLookupWaStatus')).toMatchObject({ path: '/agent/wa-status/lookup', method: 'post', authorizer: { name: 'cognitoAgentJwt' } });
    expect(route('adminPostWaStatus')).toMatchObject({ path: '/admin/campaigns/{campaign}/wa-status', method: 'post', authorizer: { name: 'cognitoAdminJwt' } });
    expect(route('adminLookupWaStatus')).toMatchObject({ path: '/admin/campaigns/{campaign}/wa-status/lookup', method: 'post', authorizer: { name: 'cognitoAdminJwt' } });
  });
});
