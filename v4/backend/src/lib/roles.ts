// File: GET /users/{username} → roles del usuario (con campaña). [] si falla.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Cliente de la API externa de Roles & Permisos (fuente de verdad de identidad).
// Ver Implementar_roles_locales.md §1 y §12.
const ROLES_API_BASE = process.env.ROLES_API_BASE!;
const ROLES_API_KEY = process.env.ROLES_API_KEY!;

export interface ExternalRole {
  role_id: string;
  role_name: string;
  campaign_name: string;
  // `/users/{username}` trae permisos INLINE (gotcha del doc SSO): campo
  // `permission_name`, NO `name`. No llamar /roles/{id}/permissions.
  permissions?: { permission_name: string }[];
}

export interface RoleSummary {
  role_id: string;
  role_name: string;
  campaign_name: string;
}

/**
 * Lista TODOS los roles. El API no tiene endpoint plano: se unen dos fuentes
 * para cubrir también roles sin relación de jerarquía (p.ej. "Líder Zendere"):
 *  1. GET /roles/hierarchy → roles con superior/subordinado.
 *  2. GET /users → roles asignados a cualquier usuario.
 * Dedupe por id. (Un rol sin jerarquía y sin usuarios aún no aparecería.)
 */
export async function listAllRoles(): Promise<RoleSummary[]> {
  const byId = new Map<string, RoleSummary>();
  const add = (id?: string, name?: string, campaign?: string) => {
    if (id && !byId.has(id)) {
      byId.set(id, { role_id: id, role_name: name ?? id, campaign_name: campaign ?? '*' });
    }
  };

  // 1) Jerarquía.
  try {
    const res = await fetch(`${ROLES_API_BASE}/roles/hierarchy`, {
      headers: { 'X-Api-Key': ROLES_API_KEY },
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      for (const row of data?.data?.hierarchy ?? []) {
        for (const r of [row.subordinate_role, row.superior_role]) {
          if (r) add(r.id, r.name, r.campaign_name);
        }
      }
    } else {
      console.error('[roles] GET /roles/hierarchy falló', res.status);
    }
  } catch (e) {
    console.error('[roles] error red /roles/hierarchy', e);
  }

  // 2) Roles asignados a usuarios (cubre roles fuera de la jerarquía).
  try {
    const res = await fetch(`${ROLES_API_BASE}/users`, {
      headers: { 'X-Api-Key': ROLES_API_KEY },
    });
    if (res.ok) {
      const data = (await res.json()) as { users?: { roles?: any[] }[] };
      for (const u of data.users ?? [])
        for (const r of u.roles ?? []) add(r.id, r.name, r.campaign ?? r.campaign_name);
    } else {
      console.error('[roles] GET /users falló', res.status);
    }
  } catch (e) {
    console.error('[roles] error red /users', e);
  }

  return [...byId.values()].sort((a, b) => a.role_name.localeCompare(b.role_name));
}

/** GET /users/{username} → roles del usuario (con campaña). [] si falla. */
export async function getUserRoles(username: string): Promise<ExternalRole[]> {
  try {
    const res = await fetch(`${ROLES_API_BASE}/users/${encodeURIComponent(username)}`, {
      headers: { 'X-Api-Key': ROLES_API_KEY },
    });
    if (!res.ok) {
      console.error('[roles] GET /users falló', res.status);
      return [];
    }
    const data = (await res.json()) as { roles?: ExternalRole[] };
    return data.roles ?? [];
  } catch (e) {
    console.error('[roles] error red', e);
    return [];
  }
}
