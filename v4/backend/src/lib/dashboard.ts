// File: operatorIds (username) de agentes elegibles de una campaña:
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Cliente de la API de agentes del dashboard (imery). Devuelve los agentes
// ACTIVOS elegibles de una campaña para repartir contactos. Ver api-agentes.md.
const BASE = process.env.DASHBOARD_BASE_PATH!;
const KEY = process.env.DASHBOARD_API_KEY!;

interface DashUser {
  username?: string;
  user_id?: string;
  email?: string;
  active?: boolean;
  roles?: { id: string; name: string }[];
}

// Emails internos NO son agentes externos elegibles.
const INTERNAL_EMAIL = /@pernexium\.com\.mx|@dirsa/i;

/**
 * operatorIds (username) de agentes elegibles de una campaña:
 *  - active === true
 *  - email externo (no interno)
 *  - si hay rol requerido para la campaña (env AGENT_ROLE_<CAMPAÑA>), debe traerlo
 * [] si la API falla (el caller decide el fallback).
 */
export async function getEligibleAgents(campaign: string): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/users/campaign/${encodeURIComponent(campaign)}`, {
      headers: { 'X-Api-Key': KEY },
    });
    if (!res.ok) {
      console.error('[dashboard] /users/campaign falló', res.status);
      return [];
    }
    const { users = [] } = (await res.json()) as { users?: DashUser[] };
    const requiredRole = process.env[`AGENT_ROLE_${campaign.toUpperCase()}`];

    return users
      .filter((u) => u.active)
      .filter((u) => !INTERNAL_EMAIL.test(u.email ?? ''))
      .filter((u) => !requiredRole || (u.roles ?? []).some((r) => r.id === requiredRole))
      .map((u) => u.username ?? u.user_id ?? '')
      .filter(Boolean);
  } catch (e) {
    console.error('[dashboard] error red /users/campaign', e);
    return [];
  }
}
