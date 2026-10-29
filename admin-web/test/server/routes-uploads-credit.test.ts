// @vitest-environment node
// support-crm-base-upload "Duplicados por crédito": el BFF recalcula el plan con la misma regla.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postUpload } from '@/app/api/campaigns/[campaign]/uploads/route';
import { buildPlan, detectPhoneColumn, parseCsvText, planHash, validateRows, type Fleet, type Mode, type ParsedCsv, type Plan } from '@/lib/contacts';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3, V4 } from '../helpers/server';

// Fila 2 y 3: mismo teléfono, créditos distintos (válidas). Fila 4: crédito repetido (inválida).
const CSV = 'id_credito,contact_phone,first_name\n123,5215500000001,Ana\n456,5215500000001,Ana\n123,5215500000009,Otra\n';
const S3_PUT = 'https://csv-bucket.test.invalid';

async function clientPlan(csv: string, fleet: Fleet, enabled: string[], mode: Mode = 'single', agent?: string) {
  const p = parseCsvText(csv, fleet) as ParsedCsv;
  const phone = detectPhoneColumn(p.header, fleet) as { column: string };
  const rows = validateRows(p, fleet, phone.column).valid;
  const plan = buildPlan({ fleet, mode, enabled, agent, rows }) as Plan;
  return { agents: plan.agents, counts: plan.counts, hash: await planHash(plan, rows) };
}

const req = (body: unknown) => postUpload(authedRequest('/api/campaigns/didi_vip/uploads', { method: 'POST', body: JSON.stringify(body) }), ctx({ campaign: 'didi_vip' }));

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BFF: duplicados por crédito', () => {
  it('v3: entrega las dos filas del mismo teléfono con créditos distintos y omite el crédito repetido', async () => {
    const { calls } = mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () =>
        Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: 'x', agents: [{ username: 'ana', enabled: true, override: null }], inactiveOverrides: [] } }),
      [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () =>
        Response.json({ success: true, data: { uploadId: 'x', status: 'completed', totalRows: 2, perAgent: [{ agent: 'ana', rows: 2, key: 'k', historicKey: 'h' }] } }),
    });
    const plan = await clientPlan(CSV, 'v3', ['ana'], 'single', 'ana');
    expect(plan.counts).toEqual({ ana: 2 });
    const res = await req({ fleet: 'v3', mode: 'single', agent: 'ana', fileName: 'c.csv', csv: CSV, plan });
    expect(res.status).toBe(200);
    const sent = JSON.parse(calls.find((c) => c.url.endsWith('/contacts'))!.body!);
    expect(sent.files).toEqual([{ agent: 'ana', csv: 'id_credito,contact_phone,first_name\n123,5215500000001,Ana\n456,5215500000001,Ana\n' }]);
  });

  it('v4: el CSV subido tiene una fila por crédito', async () => {
    const { calls } = mockFetch(LEADER, {
      [`GET ${V4}/admin/agent-roster`]: () =>
        Response.json({ campaign: 'didi_vip', generatedAt: 'x', agents: [{ operatorId: 'luis', enabled: true, override: null, lastSeen: null, active: false }], inactiveOverrides: [] }),
      [`POST ${V4}/uploads/presign`]: () => Response.json({ url: `${S3_PUT}/csv-uploads/lider/1_c.csv?X-Amz-Signature=abc`, key: 'csv-uploads/lider/1_c.csv', metadata: {} }),
      [`PUT ${S3_PUT}/csv-uploads/lider/1_c.csv`]: () => new Response(null, { status: 200 }),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v4', ['luis'], 'single', 'luis');
    const res = await req({ fleet: 'v4', mode: 'single', agent: 'luis', fileName: 'c.csv', csv: CSV, countryCode: '52', plan });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({ fleet: 'v4', status: 'processing' });
    expect(calls.find((c) => c.method === 'PUT')!.body).toBe('id_credito,contact_phone,first_name\n123,5215500000001,Ana\n456,5215500000001,Ana\n');
  });

  it('plan calculado con la regla anterior (por teléfono) → 409', async () => {
    mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () =>
        Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: 'x', agents: [{ username: 'ana', enabled: true, override: null }], inactiveOverrides: [] } }),
    });
    const plan = await clientPlan(CSV, 'v3', ['ana'], 'single', 'ana');
    const res = await req({ fleet: 'v3', mode: 'single', agent: 'ana', fileName: 'c.csv', csv: CSV, plan: { ...plan, counts: { ana: 1 } } });
    expect(res.status).toBe(409);
  });
});
