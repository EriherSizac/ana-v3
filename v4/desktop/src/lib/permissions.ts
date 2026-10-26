// File: permissions
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

// Espejo del catálogo del backend (backend/src/lib/permissions.ts).
export const ANA_PERMISSIONS = {
  ADMIN_CONSOLE: 'ana:admin:console:manage',
  CONTACTS_UPLOAD: 'ana:contacts:list:upload',
  CONTACTS_DISTRIBUTE: 'ana:contacts:list:distribute',
  CHATS_VIEW: 'ana:chats:conversation:view',
  CHATS_TEAM_VIEW: 'ana:chats:team:view',
  CHATS_REPLY: 'ana:chats:message:reply',
  CAMPAIGN_SEND: 'ana:campaign:message:send',
  TEAM_JOBS_VIEW: 'ana:team:jobs:view',
  TEAM_JOBS_MANAGE: 'ana:team:jobs:manage',
} as const;

// Permisos default ON (salvo deny explícito). Espejo del backend.
export const DEFAULT_PERMISSIONS: string[] = [
  ANA_PERMISSIONS.CHATS_VIEW,
  ANA_PERMISSIONS.CHATS_REPLY,
];

/** Los 9 permisos que muestra el editor de roles, con su etiqueta. */
export const PERMISSION_CATALOG: readonly { perm: string; label: string }[] = [
  { perm: ANA_PERMISSIONS.ADMIN_CONSOLE, label: 'Consola de administración' },
  { perm: ANA_PERMISSIONS.CONTACTS_UPLOAD, label: 'Subir contactos (CSV)' },
  { perm: ANA_PERMISSIONS.CONTACTS_DISTRIBUTE, label: 'Repartir contactos entre agentes' },
  { perm: ANA_PERMISSIONS.CHATS_VIEW, label: 'Ver conversaciones' },
  { perm: ANA_PERMISSIONS.CHATS_TEAM_VIEW, label: 'Ver conversaciones de agentes' },
  { perm: ANA_PERMISSIONS.CHATS_REPLY, label: 'Responder mensajes' },
  { perm: ANA_PERMISSIONS.CAMPAIGN_SEND, label: 'Enviar campañas' },
  { perm: ANA_PERMISSIONS.TEAM_JOBS_VIEW, label: 'Ver pendientes del equipo' },
  { perm: ANA_PERMISSIONS.TEAM_JOBS_MANAGE, label: 'Reasignar pendientes del equipo' },
];

/** Forma mínima del acceso de `GET /me` que usan las reglas de visibilidad. */
export interface AccessLike {
  isAdmin: boolean;
  isLeader: boolean;
  permissions: string[];
}

/** Admin = todo; si no, el permiso explícito (misma regla que el backend). */
export function can(access: AccessLike | null, perm: string): boolean {
  if (!access) return false;
  return access.isAdmin || access.permissions.includes(perm);
}

export type Tab = 'chats' | 'assignment' | 'campaigns' | 'admin';

/** Pestañas visibles según permisos (v4-enforce-permissions); sin acceso, ninguna. */
export function visibleTabs(access: AccessLike | null): Tab[] {
  if (!access) return [];
  const tabs: Tab[] = [];
  if (can(access, ANA_PERMISSIONS.CHATS_VIEW)) tabs.push('chats');
  if (can(access, ANA_PERMISSIONS.CAMPAIGN_SEND)) tabs.push('assignment');
  if (access.isAdmin || access.isLeader || can(access, ANA_PERMISSIONS.CONTACTS_UPLOAD)) tabs.push('campaigns');
  if (access.isAdmin) tabs.push('admin');
  return tabs;
}

/** Visibilidad del panel de equipo en "Chats". */
export function teamPanel(access: AccessLike | null): {
  show: boolean;
  viewAs: boolean;
  jobs: boolean;
  move: boolean;
} {
  if (!access) return { show: false, viewAs: false, jobs: false, move: false };
  const viewAs = can(access, ANA_PERMISSIONS.CHATS_TEAM_VIEW);
  const jobs = can(access, ANA_PERMISSIONS.TEAM_JOBS_VIEW);
  const move = can(access, ANA_PERMISSIONS.TEAM_JOBS_MANAGE);
  return { show: access.isAdmin || access.isLeader || viewAs || jobs, viewAs, jobs, move };
}

/** ¿Puede responder manualmente (texto, archivo, "Registrar gestión")? */
export const canReply = (access: AccessLike | null) => can(access, ANA_PERMISSIONS.CHATS_REPLY);

const isDefault = (perm: string) => DEFAULT_PERMISSIONS.includes(perm);

/**
 * Casillas marcadas a partir de lo guardado del rol: default → ON salvo deny
 * (`-perm`); no default → ON si está el grant.
 */
export function checkedFromStored(stored: readonly string[]): Set<string> {
  const checked = new Set<string>();
  for (const { perm } of PERMISSION_CATALOG) {
    const on = isDefault(perm) ? !stored.includes(`-${perm}`) : stored.includes(perm);
    if (on) checked.add(perm);
  }
  return checked;
}

/**
 * Lista a guardar (design D6): grants/denies de las casillas + los valores
 * guardados cuya clave no está en el catálogo mostrado (se conservan tal cual).
 */
export function permissionsToSave(stored: readonly string[], checked: ReadonlySet<string>): string[] {
  const shown = new Set(PERMISSION_CATALOG.map((c) => c.perm));
  const out: string[] = [];
  for (const { perm } of PERMISSION_CATALOG) {
    const on = checked.has(perm);
    if (isDefault(perm) && !on) out.push(`-${perm}`);
    else if (!isDefault(perm) && on) out.push(perm);
  }
  for (const p of stored) {
    const bare = p.startsWith('-') ? p.slice(1) : p;
    if (!shown.has(bare) && !out.includes(p)) out.push(p);
  }
  return out;
}
