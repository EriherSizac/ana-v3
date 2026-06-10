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
 * Lista todos los roles vía la jerarquía (GET /roles/hierarchy). No hay endpoint
 * "list all roles" plano; la jerarquía trae subordinate_role/superior_role.
 * Dedupe por id. (Roles 'unrelated' sin relación podrían no aparecer.)
 */
export async function listAllRoles(): Promise<RoleSummary[]> {
  try {
    const res = await fetch(`${ROLES_API_BASE}/roles/hierarchy`, {
      headers: { 'X-Api-Key': ROLES_API_KEY },
    });
    if (!res.ok) {
      console.error('[roles] GET /roles/hierarchy falló', res.status);
      return [];
    }
    const data = (await res.json()) as any;
    const rows = data?.data?.hierarchy ?? [];
    const byId = new Map<string, RoleSummary>();
    for (const row of rows) {
      for (const r of [row.subordinate_role, row.superior_role]) {
        if (r?.id && !byId.has(r.id)) {
          byId.set(r.id, {
            role_id: r.id,
            role_name: r.name,
            campaign_name: r.campaign_name ?? '*',
          });
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.role_name.localeCompare(b.role_name));
  } catch (e) {
    console.error('[roles] error red /roles/hierarchy', e);
    return [];
  }
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
