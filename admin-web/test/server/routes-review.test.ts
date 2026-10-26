// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/campaigns/[campaign]/review-items/route';
import { POST } from '@/app/api/campaigns/[campaign]/review-items/resolve/route';
import { signToken } from '../helpers/jwt';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3 } from '../helpers/server';

const U1 = '20261026T1530-ab12cd34';
const ITEM = { agent: 'ana.lopez', assignmentId: 'A1', phone: '5215500000001' };

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/campaigns/[campaign]/review-items', () => {
  it('GET propaga token y uploadId; sin llaves', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/review-items`]: () => Response.json({ success: true, data: { uploadId: U1, items: [{ ...ITEM, state: 'pending' }] } }),
    });
    const res = await GET(authedRequest(`/x?uploadId=${U1}`, { token }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).items).toHaveLength(1);
    const c = calls.find((x) => x.url.startsWith(V3))!;
    expect(c.url).toContain(`uploadId=${U1}`);
    expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(c.headers.get('x-admin-key')).toBeNull();
  });

  it('GET uploadId inválido → 400 sin llamar a v3', async () => {
    const { calls } = mockFetch(LEADER);
    expect((await GET(authedRequest('/x?uploadId=a/b'), ctx({ campaign: 'didi_vip' }))).status).toBe(400);
    expect(calls.filter((c) => c.url.startsWith(V3))).toHaveLength(0);
  });

  it('sin permisos de Contactos → 403', async () => {
    mockFetch({ ...LEADER, permissions: ['ana:admin:agents:manage'], isLeader: false });
    expect((await GET(authedRequest(`/x?uploadId=${U1}`), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
  });

  it('POST resolve: propaga y traduce 409; el log no lleva teléfonos', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { calls } = mockFetch(LEADER, {
      [`POST ${V3}/admin/campaigns/didi_vip/review-items/resolve`]: () =>
        Response.json({ success: false, message: 'Contactos ya resueltos', data: { items: [ITEM] } }, { status: 409 }),
    });
    const res = await POST(authedRequest('/x', { method: 'POST', body: JSON.stringify({ action: 'discard', items: [ITEM] }) }), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error).toMatchObject({ code: 'conflict', message: 'Contactos ya resueltos', details: { items: [ITEM] } });
    expect(JSON.parse(calls.find((c) => c.url.startsWith(V3))!.body!)).toEqual({ action: 'discard', items: [ITEM] });
    expect(log.mock.calls.flat().join(' ')).not.toContain('5215500000001');
  });

  it('POST resolve reassign envía reassignUploadId', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { calls } = mockFetch(LEADER, {
      [`POST ${V3}/admin/campaigns/didi_vip/review-items/resolve`]: () => Response.json({ success: true, data: { items: [] } }),
    });
    const res = await POST(
      authedRequest('/x', { method: 'POST', body: JSON.stringify({ action: 'reassign', items: [ITEM], reassignUploadId: U1 }) }),
      ctx({ campaign: 'didi_vip' }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(calls.find((c) => c.url.startsWith(V3))!.body!).reassignUploadId).toBe(U1);
  });
});
