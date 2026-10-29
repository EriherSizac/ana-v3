import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isStaleSource,
  listAssignments,
  MAX_SOURCE_AGE_MS,
  publishAssignments,
  sourceTimestamp,
  STALE_MESSAGE,
  type AgentEvent,
} from '../src/handlers/agentAssignments';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { derivedList } from './helpers/admin';
import { bearer, setupAgentAuth, signIdToken } from './helpers/agentJwt';

/** add-agent-workspace "Asignaciones de más de 3 meses": no se listan ni se publican. */
const s3mock = mockClient(S3Client);
let s3: CondS3;
const NOW = new Date('2026-10-29T12:00:00Z');
const DIR = 'assignments/agents/prueba/';
const RECENT = `${DIR}ana.lopez-contacts-2026-08-01T10-00-00-000Z.csv`; // 89 días
const OLD = `${DIR}ana.lopez-contacts-2026-07-30T10-00-00-000Z.csv`; // 91 días
const NO_TS = `${DIR}ana.lopez-contacts-manual.csv`;
const CSV = 'phone_number,first_name,ana_upload_id\n5215500000001,Ana,U1\n5215500000002,Beto,U2\n5215500000003\n';

const ev = (opts: { body?: unknown } = {}): AgentEvent => ({
  headers: bearer(signIdToken({ 'cognito:username': 'ana.lopez' })),
  pathParameters: { campaign: 'prueba' },
  queryStringParameters: {},
  body: opts.body === undefined ? null : JSON.stringify(opts.body),
});
const parse = (r: { body: string }) => JSON.parse(r.body);
const publish = (key: string) =>
  publishAssignments(
    ev({ body: { publishId: '20261029T120000-abcdef12', template: 'Hola {{first_name}}', phoneColumns: ['phone_number'], sources: [{ key, etag: s3.store.get(key)!.etag, rows: [0] }] } }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock, {}, 2);
  setupAgentAuth({ enforced: true });
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sourceTimestamp / isStaleSource', () => {
  it('lee la fecha de la llave (formato de makeTimestampForKey)', () => {
    expect(sourceTimestamp(RECENT)).toBe(Date.parse('2026-08-01T10:00:00.000Z'));
  });
  it('sin fecha en la llave (o imposible) usa LastModified; sin ninguna → null', () => {
    const lm = new Date('2026-01-01T00:00:00Z');
    expect(sourceTimestamp(NO_TS, lm)).toBe(lm.getTime());
    expect(sourceTimestamp(`${DIR}a-contacts-2026-13-40T10-00-00-000Z.csv`, lm)).toBe(lm.getTime());
    expect(sourceTimestamp(NO_TS)).toBeNull();
  });
  it('la llave manda sobre LastModified (una reescritura no rejuvenece el archivo)', () => {
    expect(isStaleSource(OLD, NOW, NOW.getTime())).toBe(true);
  });
  it('límite: exactamente 90 días no vence; un ms más sí', () => {
    const t = Date.parse('2026-08-01T10:00:00.000Z');
    expect(isStaleSource(RECENT, null, t + MAX_SOURCE_AGE_MS)).toBe(false);
    expect(isStaleSource(RECENT, null, t + MAX_SOURCE_AGE_MS + 1)).toBe(true);
    expect(isStaleSource(NO_TS, null, NOW.getTime())).toBe(false);
  });
});

describe('GET /agent/assignments/{campaign} con pendientes antiguos', () => {
  it('omite los de más de 90 días (por llave o por LastModified) e incluye filas e ids de carga', async () => {
    s3.set(RECENT, CSV);
    s3.set(OLD, CSV);
    s3.set(NO_TS, CSV, new Date('2026-06-01T00:00:00Z'));
    const res = await listAssignments(ev());
    expect(res.statusCode).toBe(200);
    const items = parse(res).data.items;
    expect(items.map((i: any) => i.key)).toEqual([RECENT]);
    expect(items[0]).toMatchObject({ uploadedAt: '2026-08-01T10:00:00.000Z', rows: 2, uploadIds: ['U1', 'U2'] });
  });
});

describe('POST /agent/assignments/{campaign}/publish con pendientes antiguos', () => {
  it(`rechaza con 400 "${STALE_MESSAGE}" y no toca la fuente`, async () => {
    s3.set(OLD, CSV);
    const before = s3.store.get(OLD)!.etag;
    const res = await publish(OLD);
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toBe(STALE_MESSAGE);
    expect(s3.store.get(OLD)!.etag).toBe(before);
    expect([...s3.store.keys()].some((k) => k.startsWith('agents/prueba/'))).toBe(false);
  });
  it('fallback LastModified: sin fecha en la llave y modificado hace más de 90 días → 400', async () => {
    s3.set(NO_TS, CSV, new Date('2026-06-01T00:00:00Z'));
    const res = await publish(NO_TS);
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toBe(STALE_MESSAGE);
  });
  it('reciente → se publica', async () => {
    s3.set(RECENT, CSV);
    expect((await publish(RECENT)).statusCode).toBe(200);
  });
});
