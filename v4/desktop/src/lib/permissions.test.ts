import { describe, expect, it } from 'vitest';
import {
  ANA_PERMISSIONS as P,
  PERMISSION_CATALOG,
  canReply,
  checkedFromStored,
  permissionsToSave,
  teamPanel,
  visibleTabs,
} from './permissions';

const user = (permissions: string[], over: Partial<{ isAdmin: boolean; isLeader: boolean }> = {}) => ({
  isAdmin: false,
  isLeader: false,
  permissions,
  ...over,
});

describe('visibleTabs (desktop-shell)', () => {
  it('agente con defaults + envío, sin subida → Chats y Mi asignación', () => {
    expect(visibleTabs(user([P.CHATS_VIEW, P.CHATS_REPLY, P.CAMPAIGN_SEND]))).toEqual(['chats', 'assignment']);
  });
  it('sin permiso de envío → no ve Mi asignación', () => {
    expect(visibleTabs(user([P.CHATS_VIEW]))).toEqual(['chats']);
  });
  it('falla /me → sin pestañas', () => expect(visibleTabs(null)).toEqual([]));
  it('admin ve todas; líder ve Campañas', () => {
    expect(visibleTabs(user([], { isAdmin: true }))).toEqual(['chats', 'assignment', 'campaigns', 'admin']);
    expect(visibleTabs(user([P.CHATS_VIEW, P.CAMPAIGN_SEND], { isLeader: true }))).toContain('campaigns');
  });
});

describe('teamPanel (team-viewer)', () => {
  it('líder: Ver como, pendientes y Mover', () => {
    const leader = user([P.CHATS_TEAM_VIEW, P.TEAM_JOBS_VIEW, P.TEAM_JOBS_MANAGE], { isLeader: true });
    expect(teamPanel(leader)).toEqual({ show: true, viewAs: true, jobs: true, move: true });
  });
  it('agente sin permisos de equipo → sin panel', () => {
    expect(teamPanel(user([P.CHATS_VIEW, P.CAMPAIGN_SEND])).show).toBe(false);
  });
  it('supervisor de solo lectura → pendientes sin Mover', () => {
    expect(teamPanel(user([P.TEAM_JOBS_VIEW]))).toEqual({ show: true, viewAs: false, jobs: true, move: false });
  });
  it('canReply', () => {
    expect(canReply(user([P.CHATS_REPLY]))).toBe(true);
    expect(canReply(user([P.CHATS_VIEW]))).toBe(false);
  });
});

describe('editor de roles (role-admin-ui)', () => {
  it('catálogo de 9 con sus etiquetas', () => {
    expect(PERMISSION_CATALOG.map((c) => c.label)).toEqual([
      'Consola de administración',
      'Subir contactos (CSV)',
      'Repartir contactos entre agentes',
      'Ver conversaciones',
      'Ver conversaciones de agentes',
      'Responder mensajes',
      'Enviar campañas',
      'Ver pendientes del equipo',
      'Reasignar pendientes del equipo',
    ]);
    expect(PERMISSION_CATALOG).toHaveLength(9);
  });
  it('guardar conserva ana:admin:agents:manage (no mostrado) y agrega el marcado', () => {
    const stored = ['ana:admin:agents:manage'];
    const checked = checkedFromStored(stored);
    checked.add(P.CONTACTS_UPLOAD);
    const out = permissionsToSave(stored, checked);
    expect(out).toEqual(expect.arrayContaining(['ana:admin:agents:manage', P.CONTACTS_UPLOAD]));
    expect(out).not.toContain(`-${P.CHATS_VIEW}`);
  });
  it('deny de default se refleja y se conserva al guardar sin cambios', () => {
    const stored = [`-${P.CHATS_REPLY}`, '-ana:otro:permiso:x'];
    const checked = checkedFromStored(stored);
    expect(checked.has(P.CHATS_REPLY)).toBe(false);
    expect(permissionsToSave(stored, checked).sort()).toEqual([`-${P.CHATS_REPLY}`, '-ana:otro:permiso:x'].sort());
  });
});
