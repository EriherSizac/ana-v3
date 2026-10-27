// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getCampaigns } from '@/app/api/agent/campaigns/route';
import { GET as getPending } from '@/app/api/agent/assignments/[campaign]/route';
import { GET as getFile } from '@/app/api/agent/assignments/[campaign]/file/route';
import { POST as postPublish } from '@/app/api/agent/assignments/[campaign]/publish/route';
import { GET as getPublications } from '@/app/api/agent/assignments/[campaign]/publications/route';
import { GET as getUsers } from '@/app/api/users/route';
import { GET as getEnabled } from '@/app/api/campaigns/[campaign]/enabled-agents/route';
import { canEnter } from '@/lib/access';
import { allowedSections } from '@/lib/sections';
import { signToken } from '../helpers/jwt';
import { authedRequest, bodyOf, ctx, LEADER, mockFetch, setupServerTest, V3, type MeAccess, type Route } from '../helpers/server';

/** add-agent-workspace 2.1 / 2.3: entrada de agentes y rutas BFF /api/agent/*. */
const AGENT_SEND: MeAccess = {
  permissions: ['ana:chats:conversation:view', 'ana:chats:message:reply', 'ana:campaign:message:send'],
  campaigns: ['DIDI_VIP'],
  roleNames: ['Agente DIDI VIP'],
  isAdmin: false,
  isLeader: false,
};
const NO_SEND: MeAccess = { ...AGENT_SEND, permissions: ['ana:chats:conversation:view'] };

const KEY = 'assignments/agents/didi_vip/ana.lopez-contacts-T1.csv';
const publishBody = { template: 'Hola {{first_name}}', phoneColumns: ['phone_number'], sources: [{ key: KEY, etag: '"e1"', rows: [0, 1] }] };
const manifest = { schemaVersion: 1, publishId: 'x', contacts: 2, rows: 2, key: 'agents/didi_vip/ana.lopez-contacts-T2.csv', sources: [] };

const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  [`GET ${V3}/agent/campaigns`]: () => Response.json({ username: 'ana.lopez', campaigns: ['didi_vip'] }),
  [`GET ${V3}/agent/assignments/didi_vip`]: () => Response.json({ success: true, data: { campaign: 'didi_vip', agent: 'ana.lopez', items: [{ key: KEY }] } }),
  [`GET ${V3}/agent/assignments/didi_vip/file`]: () => Response.json({ success: true, data: { key: KEY, etag: '"e1"', csv: 'phone_number\n5215500000001\n' } }),
  [`POST ${V3}/agent/assignments/didi_vip/publish`]: () => Response.json({ success: true, data: manifest }),
  [`GET ${V3}/agent/assignments/didi_vip/publications`]: () => Response.json({ success: true, data: { campaign: 'didi_vip', agent: 'ana.lopez', items: [manifest] } }),
  ...over,
});

const publishReq = (body: unknown = publishBody, campaign = 'didi_vip', token?: string) =>
  postPublish(authedRequest(`/api/agent/assignments/${campaign}/publish`, { method: 'POST', body: JSON.stringify(body), token }), ctx({ campaign }));

beforeEach(() => setupServerTest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('entrada y navegación', () => {
  const access = { username: 'ana.lopez', campaigns: ['didi_vip'], roleNames: ['Agente DIDI VIP'], isAdmin: false, isLeader: false, isDeveloper: false };

  it('un agente con envío entra y solo ve "Mi asignación"', () => {
    const a = { ...access, permissions: AGENT_SEND.permissions! };
    expect(canEnter(a)).toBe(true);
    expect(allowedSections(a).map((s) => s.href)).toEqual(['/mi-asignacion']);
  });

  it('sin envío no entra', () => {
    expect(canEnter({ ...access, permissions: NO_SEND.permissions! })).toBe(false);
  });

  it('el agente recibe 403 en rutas de otras secciones', async () => {
    mockFetch(AGENT_SEND, routes());
    expect((await getUsers(authedRequest('/api/users'), ctx())).status).toBe(403);
    expect((await getEnabled(authedRequest('/api/campaigns/didi_vip/enabled-agents?fleet=v3'), ctx({ campaign: 'didi_vip' }))).status).toBe(403);
  });
});

describe('/api/agent/*', () => {
  it('campañas del agente desde v3 con el token del usuario', async () => {
    const token = signToken();
    const { calls } = mockFetch(AGENT_SEND, routes());
    const res = await getCampaigns(authedRequest('/api/agent/campaigns', { token }), ctx());
    expect(await bodyOf(res)).toEqual({ campaigns: ['didi_vip'] });
    const call = calls.find((c) => c.url === `${V3}/agent/campaigns`)!;
    expect(call.headers.get('authorization')).toBe(`Bearer ${token}`);
  });

  it('sin permiso de envío → 403 sin llamar a v3', async () => {
    const { calls } = mockFetch(NO_SEND, routes());
    expect((await getCampaigns(authedRequest('/api/agent/campaigns'), ctx())).status).toBe(403);
    expect(calls.some((c) => c.url.startsWith(V3))).toBe(false);
  });

  it('campaña fuera de sus roles → 403 sin llamar a v3', async () => {
    const { calls } = mockFetch(AGENT_SEND, routes());
    const res = await getPending(authedRequest('/api/agent/assignments/zendere'), ctx({ campaign: 'zendere' }));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.startsWith(V3))).toBe(false);
  });

  it('pendientes, archivo e historial se reenvían a v3', async () => {
    const { calls } = mockFetch(AGENT_SEND, routes());
    expect((await bodyOf(await getPending(authedRequest('/api/agent/assignments/didi_vip'), ctx({ campaign: 'didi_vip' })))).items).toHaveLength(1);
    const file = await bodyOf(await getFile(authedRequest(`/api/agent/assignments/didi_vip/file?key=${encodeURIComponent(KEY)}`), ctx({ campaign: 'didi_vip' })));
    expect(file).toMatchObject({ key: KEY, etag: '"e1"' });
    expect(calls.find((c) => c.url.includes('/file'))!.url).toContain(`key=${encodeURIComponent(KEY)}`);
    expect((await bodyOf(await getPublications(authedRequest('/api/agent/assignments/didi_vip/publications'), ctx({ campaign: 'didi_vip' })))).items).toHaveLength(1);
  });

  it('403 de v3 (no habilitado / archivo ajeno) → 403 uniforme', async () => {
    mockFetch(AGENT_SEND, routes({ [`GET ${V3}/agent/assignments/didi_vip/file`]: () => Response.json({ error: 'Archivo no permitido' }, { status: 403 }) }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await getFile(authedRequest('/api/agent/assignments/didi_vip/file?key=x'), ctx({ campaign: 'didi_vip' }));
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.message).toBe('Archivo no permitido');
  });

  it('publish: publishId generado, cuerpo de la página y token del usuario', async () => {
    const token = signToken();
    const { calls } = mockFetch(AGENT_SEND, routes());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await publishReq(publishBody, 'didi_vip', token);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.manifest).toMatchObject({ contacts: 2 });
    const call = calls.find((c) => c.url.endsWith('/publish'))!;
    expect(call.headers.get('authorization')).toBe(`Bearer ${token}`);
    const sent = JSON.parse(call.body!);
    expect(sent.publishId).toMatch(/^\d{8}T\d{6}-[0-9a-f]{8}$/);
    expect(body.publishId).toBe(sent.publishId);
    expect(sent).toMatchObject(publishBody);
  });

  it('publish: error de red → un reintento con el mismo publishId', async () => {
    let n = 0;
    const { calls } = mockFetch(
      AGENT_SEND,
      routes({
        [`POST ${V3}/agent/assignments/didi_vip/publish`]: () => {
          if (++n === 1) throw new TypeError('fetch failed');
          return Response.json({ success: true, data: manifest });
        },
      }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await publishReq()).status).toBe(200);
    const posts = calls.filter((c) => c.url.endsWith('/publish'));
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0]!.body!).publishId).toBe(JSON.parse(posts[1]!.body!).publishId);
  });

  it('publish: 409 de v3 → 409 con el mensaje; 400 → mensaje de v3', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(AGENT_SEND, routes({ [`POST ${V3}/agent/assignments/didi_vip/publish`]: () => Response.json({ success: false, message: 'La asignación cambió; vuelve a cargarla' }, { status: 409 }) }));
    const r409 = await publishReq();
    expect(r409.status).toBe(409);
    expect((await bodyOf(r409)).error).toEqual({ code: 'conflict', message: 'La asignación cambió; vuelve a cargarla' });
    setupServerTest();
    mockFetch(AGENT_SEND, routes({ [`POST ${V3}/agent/assignments/didi_vip/publish`]: () => Response.json({ success: false, message: 'Variable desconocida: {{apodo}}' }, { status: 400 }) }));
    const r400 = await publishReq();
    expect((await bodyOf(r400)).error.message).toBe('Variable desconocida: {{apodo}}');
  });

  it('publish: body inválido → 400 sin llamar a v3', async () => {
    const { calls } = mockFetch(AGENT_SEND, routes());
    expect((await publishReq({ ...publishBody, template: ' ' })).status).toBe(400);
    expect((await publishReq({ ...publishBody, sources: [] })).status).toBe(400);
    expect(calls.some((c) => c.url.endsWith('/publish'))).toBe(false);
  });

  it('logs sin teléfonos, plantillas ni mensajes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(AGENT_SEND, routes());
    await publishReq({ ...publishBody, template: 'Hola secreto {{first_name}}' });
    setupServerTest();
    mockFetch(AGENT_SEND, routes({ [`POST ${V3}/agent/assignments/didi_vip/publish`]: () => new Response('boom 5215500000001', { status: 500 }) }));
    expect((await publishReq({ ...publishBody, template: 'Hola secreto' })).status).toBe(503);
    const out = [...log.mock.calls, ...err.mock.calls].flat().map(String).join('\n');
    expect(out).toContain('agent_publish');
    expect(out).toContain('publishId');
    for (const s of ['secreto', '5215500000001', 'first_name']) expect(out).not.toContain(s);
  });

  it('el líder (que también tiene envío) usa las mismas rutas', async () => {
    mockFetch({ ...LEADER, permissions: [...LEADER.permissions!, 'ana:campaign:message:send'] }, routes());
    expect((await getPending(authedRequest('/api/agent/assignments/didi_vip'), ctx({ campaign: 'didi_vip' }))).status).toBe(200);
  });
});
