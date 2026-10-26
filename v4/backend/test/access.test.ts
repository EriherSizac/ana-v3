import { beforeEach, describe, expect, it, vi } from 'vitest';

const roles = vi.hoisted(() => ({ value: [] as any[] }));
const local = vi.hoisted(() => ({ value: new Map<string, string[]>() }));

vi.mock('../src/lib/roles', () => ({ getUserRoles: async () => roles.value }));
vi.mock('../src/lib/rolePerms', () => ({ getManyRolePermissions: async () => local.value }));
vi.mock('../src/lib/accessCache', () => ({ getCached: async () => null, putCached: async () => {} }));

import { resolveUserAccess } from '../src/lib/access';
import { ANA_PERMISSIONS, isAgentRole, sanitizeRolePermissions } from '../src/lib/permissions';

const role = (id: string, name: string, campaign: string, perms: string[] = []) => ({
  role_id: id,
  role_name: name,
  campaign_name: campaign,
  permissions: perms.map((p) => ({ permission_name: p })),
});

const SEND = ANA_PERMISSIONS.CAMPAIGN_SEND;
const MANAGE = ANA_PERMISSIONS.AGENTS_MANAGE;

describe('resolveUserAccess: agentes y gestión', () => {
  beforeEach(() => {
    roles.value = [];
    local.value = new Map();
  });

  it('líder recibe ana:admin:agents:manage', async () => {
    roles.value = [role('r1', 'Líder DIDI VIP', 'didi_vip')];
    const a = await resolveUserAccess('luis');
    expect(a.permissions).toContain(MANAGE);
    // v4-enforce-permissions: el líder también envía sus propios CSV.
    expect(a.permissions).toContain(SEND);
  });

  it('admin recibe ana:admin:agents:manage (todo el catálogo)', async () => {
    roles.value = [role('r1', 'Admin', '*', [ANA_PERMISSIONS.ADMIN_CONSOLE])];
    const a = await resolveUserAccess('admin.x');
    expect(a.isAdmin).toBe(true);
    expect(a.permissions).toContain(MANAGE);
  });

  it('un agente no recibe ana:admin:agents:manage', async () => {
    roles.value = [role('r1', 'Agente Prueba', 'prueba')];
    const a = await resolveUserAccess('ana.lopez');
    expect(a.permissions).not.toContain(MANAGE);
  });

  it.each(['Agente Prueba', 'agente prueba', 'AGENTE Prueba', 'Agénte prueba'])('%s recibe envío por defecto', async (name) => {
    roles.value = [role('r1', name, 'prueba')];
    expect((await resolveUserAccess('ana.lopez')).permissions).toContain(SEND);
  });

  it('deny local -ana:campaign:message:send lo quita', async () => {
    roles.value = [role('r1', 'Agente Prueba', 'prueba')];
    local.value = new Map([['r1', [`-${SEND}`]]]);
    expect((await resolveUserAccess('ana.lopez')).permissions).not.toContain(SEND);
  });

  it('deny inline -ana:campaign:message:send lo quita', async () => {
    roles.value = [role('r1', 'Agente Prueba', 'prueba', [`-${SEND}`])];
    expect((await resolveUserAccess('ana.lopez')).permissions).not.toContain(SEND);
  });

  it('Calidad Prueba no recibe envío por defecto', async () => {
    roles.value = [role('r1', 'Calidad Prueba', 'prueba')];
    expect((await resolveUserAccess('q')).permissions).not.toContain(SEND);
  });

  it('isAgentRole', () => {
    expect(isAgentRole('Agente DIDI VIP')).toBe(true);
    expect(isAgentRole('Líder DIDI VIP')).toBe(false);
  });

  it('setRolePerms acepta ambos permisos (grant y deny)', () => {
    expect(sanitizeRolePermissions([MANAGE, SEND, `-${SEND}`, `-${MANAGE}`, 'ana:inventado', 'otro'])).toEqual([
      MANAGE,
      SEND,
      `-${SEND}`,
      `-${MANAGE}`,
    ]);
  });
});
