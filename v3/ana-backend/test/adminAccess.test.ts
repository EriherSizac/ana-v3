import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireAdminAccess, isDeveloper } from '../src/lib/adminAccess';
import { parseCampaign, parseCampaignParam, parseUsername } from '../src/lib/identifiers';
import { ADMIN, AGENT, LEADER_DIDI, adminEvent, mockV4Me, parse } from './helpers/admin';

afterEach(() => vi.unstubAllGlobals());

describe('identifiers', () => {
  it('normaliza campaña y agente', () => {
    expect(parseCampaignParam('DIDI_VIP ')).toBe('didi_vip');
    expect(parseCampaignParam('DIDI%5FVIP')).toBe('didi_vip');
    expect(parseUsername(' Erick.Silva ')).toBe('erick.silva');
  });
  it.each(['ventas/norte', '', '-x', 'a'.repeat(65), 'con espacio', '*'])('campaña inválida: %j', (c) => {
    expect(parseCampaign(c)).toBeNull();
  });
  it.each(['a/b', '', '.x', 'a'.repeat(129), 'con espacio'])('username inválido: %j', (u) => {
    expect(parseUsername(u)).toBeNull();
  });
  it('acepta usernames con @ y +', () => {
    expect(parseUsername('Ana+qa@pernexium.com.mx')).toBe('ana+qa@pernexium.com.mx');
  });
});

describe('requireAdminAccess (v4 GET /me)', () => {
  it('permiso presente y campaña propia → continúa; propaga el mismo token', async () => {
    const fetch = mockV4Me(LEADER_DIDI);
    const r = await requireAdminAccess(adminEvent({ username: 'Lider.Didi', token: 'tok-abc' }), {
      permissions: ['ana:admin:agents:manage'],
      campaign: 'didi_vip',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.username).toBe('lider.didi');
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe('Bearer tok-abc');
  });

  it('caché por usuario 60 s', async () => {
    const fetch = mockV4Me(LEADER_DIDI);
    await requireAdminAccess(adminEvent({}), {});
    await requireAdminAccess(adminEvent({}), {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('v4 caído → 503 "Autorización no disponible" y no se cachea', async () => {
    mockV4Me('down');
    const r = await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.statusCode).toBe(503);
      expect(parse(r.response)).toEqual({ success: false, message: 'Autorización no disponible' });
    }
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access: LEADER_DIDI }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const r2 = await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'] });
    expect(r2.ok).toBe(true);
  });

  it('v4 5xx → 503', async () => {
    mockV4Me(() => new Response('x', { status: 500 }));
    const r = await requireAdminAccess(adminEvent({}), {});
    expect(!r.ok && r.response.statusCode).toBe(503);
  });

  it('sin permiso → 403 "Sin permiso"', async () => {
    mockV4Me(AGENT);
    const r = await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'] });
    expect(!r.ok && parse(r.response)).toEqual({ success: false, message: 'Sin permiso' });
  });

  it('campaña ajena → 403 "Sin permiso para esta campaña"', async () => {
    mockV4Me(LEADER_DIDI);
    const r = await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'], campaign: 'zendere' });
    expect(!r.ok && r.response.statusCode).toBe(403);
    expect(!r.ok && parse(r.response).message).toBe('Sin permiso para esta campaña');
  });

  it('admin pasa en cualquier campaña y `*` también', async () => {
    mockV4Me(ADMIN);
    expect((await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'], campaign: 'zendere' })).ok).toBe(true);
    mockV4Me({ ...LEADER_DIDI, campaigns: ['*'] });
    expect((await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'], campaign: 'zendere' })).ok).toBe(true);
  });

  it('sin token → 401 sin llamar a v4', async () => {
    const fetch = mockV4Me(ADMIN);
    const r = await requireAdminAccess(adminEvent({ token: null }), {});
    expect(!r.ok && r.response.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no depende de flags de enforcement', async () => {
    process.env.PERMISSIONS_ENFORCED = 'false';
    mockV4Me(AGENT);
    const r = await requireAdminAccess(adminEvent({}), { permissions: ['ana:admin:agents:manage'] });
    expect(r.ok).toBe(false);
    delete process.env.PERMISSIONS_ENFORCED;
  });

  it('isDeveloper normaliza mayúsculas y acentos', () => {
    expect(isDeveloper({ roleNames: ['Developér'] })).toBe(true);
    expect(isDeveloper({ roleNames: ['Líder'] })).toBe(false);
  });
});
