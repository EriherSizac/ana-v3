// File: Resuelve el acceso efectivo de un usuario (guía §6):
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { getUserRoles } from './roles';
import { getManyRolePermissions } from './rolePerms';
import { getCached, putCached } from './accessCache';
import {
  ANA_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  SUPERADMIN_USERNAME,
  LEADER_NAME_RE,
  type AnaPermission,
} from './permissions';

// Flag de enforcement (guía §8). Apagado → todo permitido. Encender por stage.
const ENFORCED = process.env.PERMISSIONS_ENFORCED === 'true';

export interface UserAccess {
  username: string;
  roleIds: string[];
  roleNames: string[];
  campaigns: string[];
  permissions: string[];
  isAdmin: boolean;
  isLeader: boolean;
}

const ALL_PERMS = Object.values(ANA_PERMISSIONS);

/**
 * Resuelve el acceso efectivo de un usuario (guía §6):
 *  roles externos → permisos locales por rol → UNIÓN.
 *  + superadmin (erick.silva) = todo.
 *  + líder (role_name ~ /líder/) = upload + distribute.
 */
export async function resolveUserAccess(username: string): Promise<UserAccess> {
  // Superadmin: estático, no se cachea (siempre correcto).
  if (username === SUPERADMIN_USERNAME) {
    return {
      username,
      roleIds: [],
      roleNames: ['superadmin'],
      campaigns: ['*'],
      permissions: ALL_PERMS,
      isAdmin: true,
      isLeader: true,
    };
  }

  const cached = await getCached(username);
  if (cached) return cached;

  // Marca de inicio: putCached la usa para no pisar una invalidación que ocurra
  // mientras resolvemos (anti resurrección por carrera).
  const startedAt = Date.now();
  const roles = await getUserRoles(username);
  const permsByRole = await getManyRolePermissions(roles.map((r) => r.role_id));

  // Grants explícitos (+perm) y denies (-perm), del almacén local + inline.
  const explicitGrants = new Set<string>();
  const denied = new Set<string>();
  const consume = (p?: string) => {
    if (!p) return;
    if (p.startsWith('-')) denied.add(p.slice(1));
    else explicitGrants.add(p);
  };
  // 1) Almacén local rol→permisos (admin UI). Puede traer denies `-perm`.
  for (const r of roles) for (const p of permsByRole.get(r.role_id) ?? []) consume(p);
  // 2) Permisos INLINE de la API externa (gotcha doc SSO: permission_name).
  for (const r of roles)
    for (const p of r.permissions ?? [])
      if (/^-?ana:/.test(p.permission_name ?? '')) consume(p.permission_name);

  // Base = defaults (chats view/reply) ∪ grants explícitos.
  const permissions = new Set<string>([...DEFAULT_PERMISSIONS, ...explicitGrants]);
  // Aplica denies: quita lo desactivado salvo que algún rol lo otorgue explícito.
  for (const d of denied) if (!explicitGrants.has(d)) permissions.delete(d);

  const isLeader = roles.some((r) => LEADER_NAME_RE.test(r.role_name));
  if (isLeader) {
    // El líder siempre puede subir/repartir y ver a su equipo (override deny).
    permissions.add(ANA_PERMISSIONS.CONTACTS_UPLOAD);
    permissions.add(ANA_PERMISSIONS.CONTACTS_DISTRIBUTE);
    permissions.add(ANA_PERMISSIONS.CHATS_VIEW);
    permissions.add(ANA_PERMISSIONS.CHATS_TEAM_VIEW);
  }

  const isAdmin = explicitGrants.has(ANA_PERMISSIONS.ADMIN_CONSOLE);
  if (isAdmin) for (const p of ALL_PERMS) permissions.add(p);

  const access: UserAccess = {
    username,
    roleIds: roles.map((r) => r.role_id),
    roleNames: roles.map((r) => r.role_name),
    campaigns: [...new Set(roles.map((r) => r.campaign_name))],
    permissions: [...permissions],
    isAdmin,
    isLeader,
  };
  // No cachear lookups vacíos: un [] puede ser fallo transitorio de la API
  // externa, no "sin roles" real (guía §6: no convertir un outage en denegación).
  if (roles.length > 0) await putCached(access, startedAt);
  return access;
}

/**
 * ¿El acceso permite el permiso? Respeta el flag de enforcement para permisos
 * normales, PERO el permiso de admin SIEMPRE se exige (fail-closed) — el flag
 * de rollout no debe abrir el sink de administración.
 */
export function can(access: UserAccess, perm: AnaPermission): boolean {
  if (perm === ANA_PERMISSIONS.ADMIN_CONSOLE) return access.isAdmin;
  if (!ENFORCED) return true; // flag off → no bloquear rutas normales
  return access.isAdmin || access.permissions.includes(perm);
}
