// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postUpload } from '@/app/api/campaigns/[campaign]/uploads/route';
import { POST as postPresign } from '@/app/api/campaigns/[campaign]/uploads/presign/route';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3 } from '../helpers/server';

// support-crm-base-upload: "Carga v3 grande por S3" (BFF).

const UPLOAD_ID = '20261029T100000-abcdef12';
const KEY = `uploads-incoming/didi_vip/${UPLOAD_ID}.csv`;
const HASH = 'a'.repeat(64);

const v3Roster = (enabled: string[]) =>
  Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: 'x', agents: enabled.map((u) => ({ username: u, enabled: true, override: null })), inactiveOverrides: [] } });
const manifest = { success: true, data: { uploadId: UPLOAD_ID, status: 'completed', totalRows: 3, perAgent: [{ agent: 'ana', rows: 2, key: 'k', historicKey: 'h' }, { agent: 'beto', rows: 1, key: 'k', historicKey: 'h' }] } };

const upload = (body: unknown) =>
  postUpload(authedRequest('/api/campaigns/didi_vip/uploads', { method: 'POST', body: JSON.stringify(body) }), ctx({ campaign: 'didi_vip' }));
const presign = (body: unknown) =>
  postPresign(authedRequest('/api/campaigns/didi_vip/uploads/presign', { method: 'POST', body: JSON.stringify(body) }), ctx({ campaign: 'didi_vip' }));

const largeBody = (over: Record<string, unknown> = {}) => ({
  fleet: 'v3',
  mode: 'distribute',
  fileName: 'base.csv',
  uploadId: UPLOAD_ID,
  sourceKey: KEY,
  plan: { agents: ['ana', 'beto'], counts: { ana: 2, beto: 1 }, hash: HASH },
  ...over,
});

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/campaigns/[campaign]/uploads/presign', () => {
  it('pide a v3 la URL firmada con un uploadId nuevo y el tamaño', async () => {
    const { calls } = mockFetch(LEADER, {
      [`POST ${V3}/admin/campaigns/didi_vip/contacts/presign`]: (_url, init) => {
        const b = JSON.parse(String(init.body));
        return Response.json({ success: true, data: { uploadId: b.uploadId, sourceKey: `uploads-incoming/didi_vip/${b.uploadId}.csv`, url: 'https://s3.test/put', expiresIn: 900, headers: { 'Content-Type': 'text/csv' }, maxBytes: 1 } });
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await presign({ fleet: 'v3', bytes: 6 * 1024 * 1024 });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.uploadId).toMatch(/^\d{8}T\d{6}-[0-9a-f]{8}$/);
    expect(body).toMatchObject({ sourceKey: `uploads-incoming/didi_vip/${body.uploadId}.csv`, url: 'https://s3.test/put', headers: { 'Content-Type': 'text/csv' } });
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/presign'))!.body!)).toEqual({ uploadId: body.uploadId, bytes: 6 * 1024 * 1024 });
  });

  it('más de 50 MB → 413 sin llamar a v3; v4 → 400', async () => {
    const { calls } = mockFetch(LEADER, {});
    expect((await presign({ fleet: 'v3', bytes: 51 * 1024 * 1024 })).status).toBe(413);
    expect((await presign({ fleet: 'v4', bytes: 10 })).status).toBe(400);
    expect(calls.filter((c) => c.url.includes('/presign'))).toHaveLength(0);
  });
});

describe('POST /api/campaigns/[campaign]/uploads con sourceKey (v3)', () => {
  it('verifica el roster contra el plan y reenvía uploadId, sourceKey y plan a v3 (sin csv)', async () => {
    const { calls } = mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster(['beto', 'ana']),
      [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () => Response.json(manifest),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await upload(largeBody());
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).manifest.perAgent.map((p: any) => p.agent)).toEqual(['ana', 'beto']);
    const sent = JSON.parse(calls.find((c) => c.url.endsWith('/contacts'))!.body!);
    expect(sent).toEqual({ uploadId: UPLOAD_ID, fileName: 'base.csv', mode: 'distribute', sourceKey: KEY, plan: { agents: ['ana', 'beto'], counts: { ana: 2, beto: 1 }, hash: HASH } });
  });

  it('roster distinto (otro agente o conteos) → 409 sin llamar a la carga', async () => {
    const { calls } = mockFetch(LEADER, { [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster(['ana', 'beto', 'carla']) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await upload(largeBody())).status).toBe(409);
    expect(calls.some((c) => c.url.endsWith('/contacts'))).toBe(false);
  });

  it('v3 responde 409 (plan no coincide con el archivo) → 409 "El roster cambió"', async () => {
    mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster(['ana', 'beto']),
      [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () => Response.json({ success: false, message: 'El plan no coincide con el archivo' }, { status: 409 }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await upload(largeBody())).status).toBe(409);
  });

  it('sourceKey de otra campaña, csv y sourceKey juntos o flota v4 → 400', async () => {
    mockFetch(LEADER, { [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster(['ana', 'beto']) });
    expect((await upload(largeBody({ sourceKey: `uploads-incoming/otra/${UPLOAD_ID}.csv` }))).status).toBe(400);
    expect((await upload(largeBody({ csv: 'phone\n1' }))).status).toBe(400);
    expect((await upload(largeBody({ fleet: 'v4' }))).status).toBe(400);
  });

  it('en línea: v3 de más de 4 MB en la solicitud → 413', async () => {
    mockFetch(LEADER, {});
    const csv = 'phone\n' + '5215500000001\n'.repeat(330_000);
    const res = await upload({ fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv, plan: { agents: [], counts: {}, hash: HASH } });
    expect(res.status).toBe(413);
  });
});
