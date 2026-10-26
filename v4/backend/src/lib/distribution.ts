// File: Reparto de contactos restringido a agentes habilitados (AGENT_ROSTER_FILTER).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { getEligibleAgents } from './dashboard';
import { listEnabledAgents } from './agents';
import { normalizeId } from './campaignAgentsList';

/** Flag de transición (design D6). Se lee en cada llamada; default apagado. */
export const rosterFilterOn = (): boolean => process.env.AGENT_ROSTER_FILTER === 'true';

/**
 * Agentes para el reparto automático (`distribute` sin `assignments`).
 * Flag apagado: elegibles del Dashboard (comportamiento previo).
 * Flag encendido: elegibles del Dashboard ∩ habilitados (lista derivada vigente
 * menos `enabled:false`). Si la lista está en error → [] (el caller manda los
 * jobs al uploader).
 */
export async function getDistributableAgents(campaign: string): Promise<string[]> {
  const eligible = await getEligibleAgents(campaign);
  if (!rosterFilterOn()) return eligible;
  let enabled: string[];
  try {
    enabled = await listEnabledAgents(campaign);
  } catch (e) {
    console.error('[distribution] roster no disponible', campaign, e instanceof Error ? e.message : e);
    return [];
  }
  const ok = new Set(enabled.map(normalizeId));
  return eligible.filter((op) => ok.has(normalizeId(op)));
}

export type AssignmentsCheck =
  | { ok: true }
  | { ok: false; status: 400 | 503; error: string };

/**
 * Con el flag encendido, todos los destinatarios de `assignments` deben estar
 * habilitados (400 si alguno no; 503 si la lista está en error).
 */
export async function checkAssignmentsEnabled(campaign: string, operatorIds: string[]): Promise<AssignmentsCheck> {
  if (!rosterFilterOn()) return { ok: true };
  let enabled: string[];
  try {
    enabled = await listEnabledAgents(campaign);
  } catch {
    return { ok: false, status: 503, error: 'roster no disponible' };
  }
  const ok = new Set(enabled.map(normalizeId));
  const bad = operatorIds.find((op) => !ok.has(normalizeId(op)));
  return bad === undefined ? { ok: true } : { ok: false, status: 400, error: `agente no habilitado: ${bad}` };
}
