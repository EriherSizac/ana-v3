// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getEnabled } from '@/app/api/campaigns/[campaign]/enabled-agents/route';
import { GET as getUploads, POST as postUpload } from '@/app/api/campaigns/[campaign]/uploads/route';
import { buildPlan, detectPhoneColumn, parseCsvText, planHash, validateRows, type Fleet, type Mode, type ParsedCsv, type Plan } from '@/lib/contacts';
import { signToken } from '../helpers/jwt';
import { ADMIN, authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3, V4, type Route } from '../helpers/server';

const CSV = 'contact_phone,first_name\n5215500000001,Ana\n5215500000002,Beto\n5215500000003,Carla\n,SinTel\n';
const S3_PUT = 'https://csv-bucket.test.invalid';

async function clientPlan(csv: string, fleet: Fleet, enabled: string[], mode: Mode = 'distribute', agent?: string) {
  const p = parseCsvText(csv, fleet) as ParsedCsv;
  const phone = detectPhoneColumn(p.header, fleet) as { column: string };
  const rows = validateRows(p, fleet, phone.column).valid;
  const plan = buildPlan({ fleet, mode, enabled, agent, rows }) as Plan;
  return { agents: plan.agents, counts: plan.counts, hash: await planHash(plan, rows) };
}

const v3Roster = (enabled: string[]) =>
  Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: 'x', agents: enabled.map((u) => ({ username: u, enabled: true, override: null })), inactiveOverrides: [] } });
const v4Roster = (enabled: string[]) =>
  Response.json({ campaign: 'didi_vip', generatedAt: 'x', agents: enabled.map((u) => ({ operatorId: u, enabled: true, override: null, lastSeen: null, active: false })), inactiveOverrides: [] });

const manifest = (perAgent: Array<[string, number]>) => ({
  success: true,
  data: { uploadId: 'x', status: 'completed', totalRows: perAgent.reduce((n, [, r]) => n + r, 0), perAgent: perAgent.map(([agent, rows]) => ({ agent, rows, key: `agents/didi_vip/${agent}`, historicKey: 'h' })) },
});

const req = (campaign: string, body: unknown, token?: string) =>
  postUpload(authedRequest(`/api/campaigns/${campaign}/uploads`, { method: 'POST', body: JSON.stringify(body), token }), ctx({ campaign }));

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/campaigns/[campaign]/uploads — v3', () => {
  const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
    [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster(['ana', 'beto']),
    [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () => Response.json(manifest([['ana', 2], ['beto', 1]])),
    ...over,
  });

  it('verifica el plan y entrega un archivo por agente con uploadId y el token del usuario', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, routes());
    const plan = await clientPlan(CSV, 'v3', ['beto', 'ana']);
    const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'Hola {first_name}', plan }, token);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.fleet).toBe('v3');
    expect(body.manifest.perAgent.map((p: any) => p.agent)).toEqual(['ana', 'beto']);
    const call = calls.find((c) => c.url.endsWith('/contacts'))!;
    expect(call.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(call.headers.get('x-admin-key')).toBeNull();
    const sent = JSON.parse(call.body!);
    expect(sent.uploadId).toMatch(/^\d{8}T\d{6}-[0-9a-f]{8}$/);
    expect(sent.mode).toBe('distribute');
    // add-supervisor-contact-access: quien carga ya no define el mensaje.
    expect(sent).not.toHaveProperty('message');
    expect(sent.files).toEqual([
      { agent: 'ana', csv: 'contact_phone,first_name\n5215500000001,Ana\n5215500000003,Carla\n' },
      { agent: 'beto', csv: 'contact_phone,first_name\n5215500000002,Beto\n' },
    ]);
  });

  it('error de red → reintenta una vez con el mismo uploadId', async () => {
    let n = 0;
    const { calls } = mockFetch(
      LEADER,
      routes({
        [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () => {
          if (++n === 1) throw new TypeError('fetch failed');
          return Response.json(manifest([['ana', 2], ['beto', 1]]));
        },
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
    const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'Hola', plan });
    expect(res.status).toBe(200);
    const posts = calls.filter((c) => c.url.endsWith('/contacts'));
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0]!.body!).uploadId).toBe(JSON.parse(posts[1]!.body!).uploadId);
  });

  it('roster cambió entre vista previa y confirmación → 409 sin entregar', async () => {
    const { calls } = mockFetch(LEADER, routes({ [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => v3Roster(['ana']) }));
    const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
    const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'Hola', plan });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error).toEqual({ code: 'conflict', message: 'El roster cambió; revisa la nueva vista previa' });
    expect(calls.some((c) => c.url.endsWith('/contacts'))).toBe(false);
  });

  it('409 de v3 (agentes no habilitados) → 409 roster cambió', async () => {
    mockFetch(LEADER, routes({ [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () => Response.json({ success: false, message: 'Agentes no habilitados' }, { status: 409 }) }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
    const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'Hola', plan });
    expect(res.status).toBe(409);
  });

  it('v3 sin mensaje ni columna message → se entrega (el agente escribe el mensaje)', async () => {
    mockFetch(LEADER, routes());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
    const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, plan });
    expect(res.status).toBe(200);
  });

  describe('Incluir supervisores', () => {
    const withSup = (sup: { enabled: boolean } = { enabled: true }) => () =>
      Response.json({
        success: true,
        data: {
          campaign: 'didi_vip',
          generatedAt: 'x',
          agents: [
            { username: 'ana', enabled: true, override: null, kind: 'agent' },
            { username: 'sara', enabled: sup.enabled, override: null, kind: 'supervisor' },
          ],
          inactiveOverrides: [],
        },
      });

    it('toggle apagado: el plan solo usa agentes; un plan con la supervisora → 409', async () => {
      const { calls } = mockFetch(LEADER, routes({ [`GET ${V3}/admin/campaigns/didi_vip/roster`]: withSup() }));
      const plan = await clientPlan(CSV, 'v3', ['ana', 'sara']);
      const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, plan });
      expect(res.status).toBe(409);
      expect(calls.some((c) => c.url.endsWith('/contacts'))).toBe(false);
    });

    it('toggle encendido: reparte también a la supervisora', async () => {
      const { calls } = mockFetch(LEADER, routes({ [`GET ${V3}/admin/campaigns/didi_vip/roster`]: withSup() }));
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const plan = await clientPlan(CSV, 'v3', ['ana', 'sara']);
      const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, includeSupervisors: true, plan });
      expect(res.status).toBe(200);
      const sent = JSON.parse(calls.find((c) => c.url.endsWith('/contacts'))!.body!);
      expect(sent.files.map((x: any) => x.agent)).toEqual(['ana', 'sara']);
    });

    it('supervisora deshabilitada tras la vista previa → 409', async () => {
      mockFetch(LEADER, routes({ [`GET ${V3}/admin/campaigns/didi_vip/roster`]: withSup({ enabled: false }) }));
      const plan = await clientPlan(CSV, 'v3', ['ana', 'sara']);
      const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, includeSupervisors: true, plan });
      expect(res.status).toBe(409);
    });

    it('supervisor (upload + distribute sin gestión) puede cargar', async () => {
      mockFetch({ ...LEADER, permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute', 'ana:campaign:message:send'], isLeader: false, roleNames: ['Supervisor DIDI VIP'] }, routes());
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
      const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, plan });
      expect(res.status).toBe(200);
    });
  });

  it('sin permiso de reparto → 403; campaña ajena → 403', async () => {
    mockFetch({ ...LEADER, permissions: ['ana:contacts:list:upload'] }, routes());
    const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
    expect((await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'x', plan })).status).toBe(403);
    setupServerTest();
    mockFetch(LEADER, routes());
    expect((await req('zendere', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'x', plan })).status).toBe(403);
  });

  it('no registra datos de contactos en logs (éxito y error)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(LEADER, routes());
    const plan = await clientPlan(CSV, 'v3', ['ana', 'beto']);
    await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'Hola secreto', plan });
    setupServerTest();
    mockFetch(LEADER, routes({ [`POST ${V3}/admin/campaigns/didi_vip/contacts`]: () => new Response('boom 5215500000001', { status: 500 }) }));
    const res = await req('didi_vip', { fleet: 'v3', mode: 'distribute', fileName: 'c.csv', csv: CSV, message: 'Hola secreto', plan });
    expect(res.status).toBe(503);
    const out = [...log.mock.calls, ...err.mock.calls].flat().map(String).join('\n');
    expect(out).toContain('contacts_upload');
    expect(out).toContain('uploadId');
    for (const s of ['5215500000001', 'Ana', 'Carla', 'secreto']) expect(out).not.toContain(s);
  });
});

describe('POST /api/campaigns/[campaign]/uploads — v4', () => {
  const routes = (put: Route = () => new Response(null, { status: 200 })): Record<string, Route> => ({
    [`GET ${V4}/admin/agent-roster`]: () => v4Roster(['Ana.Lopez', 'luis']),
    [`POST ${V4}/uploads/presign`]: () =>
      Response.json({ url: `${S3_PUT}/csv-uploads/lider/1_c.csv?X-Amz-Signature=abc&x-amz-meta-campaign=didi_vip`, key: 'csv-uploads/lider/1_c.csv', metadata: {} }),
    [`PUT ${S3_PUT}/csv-uploads/lider/1_c.csv`]: put,
  });

  it('asignar a un agente: presign con assignments {agente:1}, distribute y PUT con solo filas válidas', async () => {
    const token = signToken();
    const { calls } = mockFetch(LEADER, routes());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v4', ['Ana.Lopez', 'luis'], 'single', 'Ana.Lopez');
    const res = await req('didi_vip', { fleet: 'v4', mode: 'single', agent: 'Ana.Lopez', fileName: 'c.csv', csv: CSV, template: '{mensaje}', countryCode: '52', plan }, token);
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ fleet: 'v4', status: 'processing', srcKey: 'csv-uploads/lider/1_c.csv' });
    const presign = calls.find((c) => c.url.endsWith('/uploads/presign'))!;
    expect(presign.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(JSON.parse(presign.body!)).toMatchObject({
      campaign: 'didi_vip',
      distribute: true,
      assignments: { 'Ana.Lopez': 1 },
      countryCode: '52',
      phoneColumn: 'contact_phone',
    });
    // Sin plantilla: v4 usa {mensaje} por defecto y el agente escribe el mensaje en el desktop.
    expect(JSON.parse(presign.body!)).not.toHaveProperty('template');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toBe('contact_phone,first_name\n5215500000001,Ana\n5215500000002,Beto\n5215500000003,Carla\n');
    expect(put.headers.get('authorization')).toBeNull();
  });

  it('reparto: assignments con peso 1 por agente en el orden del plan', async () => {
    const { calls } = mockFetch(LEADER, routes());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v4', ['luis', 'Ana.Lopez']);
    await req('didi_vip', { fleet: 'v4', mode: 'distribute', fileName: 'c.csv', csv: CSV, plan });
    expect(Object.keys(JSON.parse(calls.find((c) => c.url.endsWith('/uploads/presign'))!.body!).assignments)).toEqual(['Ana.Lopez', 'luis']);
  });

  it('assignments > 1500 caracteres → bloqueado', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `agente.numero.${i}`);
    const { calls } = mockFetch(ADMIN, { [`GET ${V4}/admin/agent-roster`]: () => v4Roster(many) });
    const csv = 'phone\n' + many.map((_, i) => 5215500000100 + i).join('\n');
    const plan = await clientPlan(csv, 'v4', many);
    const res = await req('didi_vip', { fleet: 'v4', mode: 'distribute', fileName: 'c.csv', csv, plan });
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.url.endsWith('/uploads/presign'))).toBe(false);
  });

  it('fallo del PUT → 503', async () => {
    mockFetch(LEADER, routes(() => new Response('denied', { status: 403 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const plan = await clientPlan(CSV, 'v4', ['Ana.Lopez', 'luis']);
    const res = await req('didi_vip', { fleet: 'v4', mode: 'distribute', fileName: 'c.csv', csv: CSV, plan });
    expect(res.status).toBe(503);
  });
});

describe('GET /api/campaigns/[campaign]/uploads y enabled-agents', () => {
  it('v3: historial normalizado', async () => {
    mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/uploads`]: () =>
        Response.json({ success: true, data: { campaign: 'didi_vip', items: [{ uploadId: 'u1', fileName: 'c.csv', uploadedBy: 'lider', uploadedAt: '2026-10-01T00:00:00Z', mode: 'distribute', status: 'completed', totalRows: 3, perAgent: [{ agent: 'ana', rows: 3, key: 'k', historicKey: 'h' }] }] } }),
    });
    const body = await bodyOf(await getUploads(authedRequest('/api/campaigns/didi_vip/uploads?fleet=v3'), ctx({ campaign: 'didi_vip' })));
    expect(body.items).toEqual([
      { fleet: 'v3', id: 'u1', fileName: 'c.csv', uploadedBy: 'lider', uploadedAt: '2026-10-01T00:00:00Z', mode: 'distribute', totalRows: 3, validRows: 3, status: 'completed', reason: null, perAgent: [{ agent: 'ana', rows: 3 }] },
    ]);
  });

  it('v4: historial con srcKey y rechazo', async () => {
    const { calls } = mockFetch(LEADER, {
      [`GET ${V4}/uploads/history`]: () =>
        Response.json({ campaign: 'didi_vip', items: [{ campaign: 'didi_vip', srcKey: 'k1', fileName: 'big.csv', uploadedBy: 'lider', uploadedAt: 'x', mode: 'assignments', totalRows: 60000, validRows: null, jobs: 0, perAgent: {}, status: 'rejected', reason: 'too_many_rows' }] }),
    });
    const body = await bodyOf(await getUploads(authedRequest('/api/campaigns/didi_vip/uploads?fleet=v4&srcKey=k1'), ctx({ campaign: 'didi_vip' })));
    expect(body.items[0]).toMatchObject({ fleet: 'v4', id: 'k1', status: 'rejected', reason: 'too_many_rows' });
    expect(calls.find((c) => c.url.includes('/uploads/history'))!.url).toContain('srcKey=k1');
  });

  it('enabled-agents devuelve solo habilitados', async () => {
    mockFetch(LEADER, {
      [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () =>
        Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: 'x', agents: [{ username: 'ana', enabled: true, override: null }, { username: 'luis', enabled: false, override: { enabled: false } }], inactiveOverrides: [] } }),
    });
    const body = await bodyOf(await getEnabled(authedRequest('/api/campaigns/didi_vip/enabled-agents?fleet=v3'), ctx({ campaign: 'didi_vip' })));
    expect(body.agents).toEqual(['ana']);
  });

  it('enabled-agents excluye supervisores salvo includeSupervisors=1 (y los marca)', async () => {
    const roster = () =>
      Response.json({ campaign: 'didi_vip', generatedAt: 'x', agents: [
        { operatorId: 'Ana.Lopez', enabled: true, override: null, lastSeen: null, active: false, kind: 'agent' },
        { operatorId: 'sara', enabled: true, override: null, lastSeen: null, active: false, kind: 'supervisor' },
        { operatorId: 'luis', enabled: true, override: null, lastSeen: null, active: false },
      ], inactiveOverrides: [] });
    mockFetch(LEADER, { [`GET ${V4}/admin/agent-roster`]: roster });
    const off = await bodyOf(await getEnabled(authedRequest('/api/campaigns/didi_vip/enabled-agents?fleet=v4'), ctx({ campaign: 'didi_vip' })));
    expect(off).toMatchObject({ agents: ['Ana.Lopez', 'luis'], supervisors: [], includeSupervisors: false });
    const on = await bodyOf(await getEnabled(authedRequest('/api/campaigns/didi_vip/enabled-agents?fleet=v4&includeSupervisors=1'), ctx({ campaign: 'didi_vip' })));
    expect(on).toMatchObject({ agents: ['Ana.Lopez', 'sara', 'luis'], supervisors: ['sara'], includeSupervisors: true });
  });

  it('enabled-agents permitido al supervisor; 403 a quien solo carga', async () => {
    mockFetch({ ...LEADER, permissions: ['ana:contacts:list:upload', 'ana:contacts:list:distribute'], isLeader: false }, {
      [`GET ${V3}/admin/campaigns/didi_vip/roster`]: () => Response.json({ success: true, data: { campaign: 'didi_vip', generatedAt: 'x', agents: [], inactiveOverrides: [] } }),
    });
    expect((await getEnabled(authedRequest('/api/campaigns/didi_vip/enabled-agents?fleet=v3'), ctx({ campaign: 'didi_vip' }))).status).toBe(200);
    setupServerTest();
    mockFetch({ ...LEADER, permissions: ['ana:contacts:list:upload'], isLeader: false }, {});
    expect((await getEnabled(authedRequest('/api/campaigns/didi_vip/enabled-agents?fleet=v3'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
  });
});
