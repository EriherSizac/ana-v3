// File: Resuelve el acceso efectivo de un usuario (guía §6):
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { getUserRoles } from './roles';
import { getManyRolePermissions } from './rolePerms';
import { getCached, putCached } from './accessCache';
import { canonicalOperatorId, catalogCampaigns, normalizeUserCampaigns } from './identity';
import {
  ANA_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  SUPERADMIN_USERNAME,
  isLeaderRole,
  isAgentRole,
  isSuperadminRole,
  isDeveloperRole,
  ROUTE_PERMISSIONS,
  type AnaPermission,
} from './permissions';

/**
 * Modo del flag de enforcement (v4-enforce-permissions D1), leído en cada
 * llamada: `true` → enforce, `report` → permite y registra `perm_would_deny`,
 * cualquier otro valor → off (permite sin registro).
 */
export type PermissionsMode = 'off' | 'report' | 'enforce';
export function permissionsMode(): PermissionsMode {
  const v = process.env.PERMISSIONS_ENFORCED;
  return v === 'true' ? 'enforce' : v === 'report' ? 'report' : 'off';
}

export interface UserAccess {
  username: string;
  roleIds: string[];
  roleNames: string[];
  campaigns: string[];
  permissions: string[];
  isAdmin: boolean;
  isLeader: boolean;
  /** Rol cuyo nombre contiene "developer" (v4-add-desktop-remote-settings D3); no da permisos ana:*. */
  isDeveloper: boolean;
}

const ALL_PERMS = Object.values(ANA_PERMISSIONS);

/**
 * Resuelve el acceso efectivo de un usuario (guía §6):
 *  roles externos → permisos locales por rol → UNIÓN.
 *  + superadmin (erick.silva) = todo.
 *  + líder (role_name ~ /líder/) = upload + distribute.
 */
export async function resolveUserAccess(rawUsername: string): Promise<UserAccess> {
  // operatorId canónico (v4-canonical-identity-keys D1) en caché, roles y comparaciones.
  const username = canonicalOperatorId(rawUsername);
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
      isDeveloper: false,
    };
  }

  const cached = await getCached(username);
  if (cached) return cached;

  // Marca de inicio: putCached la usa para no pisar una invalidación que ocurra
  // mientras resolvemos (anti resurrección por carrera).
  const startedAt = Date.now();
  const roles = await getUserRoles(username);

  // Superadmin por rol (design D7): acceso total del superadmin fijo con los
  // roles reales; se cachea e invalida como cualquier acceso.
  const superRole = roles.find((r) => isSuperadminRole(r.role_name));
  if (superRole) {
    console.log(JSON.stringify({ evt: 'superadmin_role', username, role: superRole.role_name }));
    const access: UserAccess = {
      username,
      roleIds: roles.map((r) => r.role_id),
      roleNames: roles.map((r) => r.role_name),
      campaigns: ['*'],
      permissions: ALL_PERMS,
      isAdmin: true,
      isLeader: true,
      isDeveloper: roles.some((r) => isDeveloperRole(r.role_name)),
    };
    await putCached(access, startedAt);
    return access;
  }

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

  // 3) Rol de agente ("Agente <Campaña>"): envío de campaña por defecto, POR ROL.
  //    Un deny `-ana:campaign:message:send` de ESE rol (local o inline) lo quita.
  const sendDeny = `-${ANA_PERMISSIONS.CAMPAIGN_SEND}`;
  for (const r of roles) {
    if (!isAgentRole(r.role_name)) continue;
    const local = permsByRole.get(r.role_id) ?? [];
    const inline = (r.permissions ?? []).map((p) => p.permission_name);
    if (!local.includes(sendDeny) && !inline.includes(sendDeny)) {
      explicitGrants.add(ANA_PERMISSIONS.CAMPAIGN_SEND);
    }
  }

  // Base = defaults (chats view/reply) ∪ grants explícitos.
  const permissions = new Set<string>([...DEFAULT_PERMISSIONS, ...explicitGrants]);
  // Aplica denies: quita lo desactivado salvo que algún rol lo otorgue explícito.
  for (const d of denied) if (!explicitGrants.has(d)) permissions.delete(d);

  const isLeader = roles.some((r) => isLeaderRole(r.role_name));
  if (isLeader) {
    // El líder siempre puede subir/repartir y ver a su equipo (override deny).
    permissions.add(ANA_PERMISSIONS.CONTACTS_UPLOAD);
    permissions.add(ANA_PERMISSIONS.CONTACTS_DISTRIBUTE);
    permissions.add(ANA_PERMISSIONS.CHATS_VIEW);
    permissions.add(ANA_PERMISSIONS.CHATS_TEAM_VIEW);
    permissions.add(ANA_PERMISSIONS.TEAM_JOBS_VIEW);
    permissions.add(ANA_PERMISSIONS.TEAM_JOBS_MANAGE);
    // Sube y envía sus propios CSV (v4-enforce-permissions).
    permissions.add(ANA_PERMISSIONS.CAMPAIGN_SEND);
    // Gestiona excepciones de agentes en sus campañas.
    permissions.add(ANA_PERMISSIONS.AGENTS_MANAGE);
  }

  const isAdmin = explicitGrants.has(ANA_PERMISSIONS.ADMIN_CONSOLE);
  if (isAdmin) for (const p of ALL_PERMS) permissions.add(p);

  const access: UserAccess = {
    username,
    roleIds: roles.map((r) => r.role_id),
    roleNames: roles.map((r) => r.role_name),
    campaigns: normalizeUserCampaigns(
      roles.map((r) => r.campaign_name),
      roles.length > 0 ? await catalogCampaigns() : [],
    ),
    permissions: [...permissions],
    isAdmin,
    isLeader,
    isDeveloper: roles.some((r) => isDeveloperRole(r.role_name)),
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
export function can(access: UserAccess, perm: AnaPermission, route?: string): boolean {
  if (perm === ANA_PERMISSIONS.ADMIN_CONSOLE) return access.isAdmin;
  const mode = permissionsMode();
  if (mode === 'off') return true; // flag off → no bloquear rutas normales
  const allowed = access.isAdmin || access.permissions.includes(perm);
  if (allowed || mode === 'enforce') return allowed;
  // report: permite y deja constancia de lo que se negaría.
  console.log(JSON.stringify({ evt: 'perm_would_deny', route: route ?? null, username: access.username, perm }));
  return true;
}

/** Chequeo normal (sujeto al flag) del permiso que `ROUTE_PERMISSIONS` asigna a la ruta. */
export function canRoute(access: UserAccess, routeKey: string): boolean {
  const perm = ROUTE_PERMISSIONS[routeKey];
  return perm ? can(access, perm, routeKey) : true;
}

/**
 * Para rutas que hoy no resuelven el acceso (cola del agente, interacciones):
 * con el flag apagado no se consulta nada (mismo costo y comportamiento que
 * antes); en report/enforce se resuelve y se aplica `canRoute`.
 */
export async function routeAllowed(username: string, routeKey: string): Promise<boolean> {
  if (permissionsMode() === 'off' || !ROUTE_PERMISSIONS[routeKey]) return true;
  return canRoute(await resolveUserAccess(username), routeKey);
}
