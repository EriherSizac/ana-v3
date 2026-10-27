// File: POST /admin/realtime/refresh — actualización forzada manual (add-realtime-gateway D12).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { bad, claimUser } from '../lib/http';
import { resolveUserAccess } from '../lib/access';
import { campaignKey, canonicalOperatorId } from '../lib/identity';
import { forceRefresh, type ForceTarget } from '../lib/realtime';

const accepted = (body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 202,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Cuerpo → destino; null si el alcance es inválido o no trae destino. */
export function parseRefreshBody(body: any): ForceTarget | null {
  const scope = body?.scope;
  if (scope === 'all') return { kind: 'all' };
  if (scope === 'user') {
    const u = canonicalOperatorId(body?.username);
    return u ? { kind: 'user', users: [u] } : null;
  }
  if (scope === 'campaign') {
    const c = campaignKey(body?.campaign);
    return c && c !== '*' ? { kind: 'campaign', campaign: c } : null;
  }
  return null;
}

/**
 * `{scope:"user",username}` | `{scope:"campaign",campaign}` | `{scope:"all"}` → 202.
 * Chequeo fijo `access.isAdmin` (`ana:admin:console:manage` o superadmin), sin
 * depender de PERMISSIONS_ENFORCED. El reparto lo hace `notify` (no se espera).
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);
  if (event.routeKey !== 'POST /admin/realtime/refresh') return bad(`ruta no manejada: ${event.routeKey}`, 404);
  try {
    const access = await resolveUserAccess(user);
    if (!access.isAdmin) return bad('sin permiso', 403);
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return bad('body inválido');
    }
    const target = parseRefreshBody(body);
    if (!target) return bad('alcance inválido');
    const requested = await forceRefresh({ reason: 'manual', target, by: access.username });
    const dest = target.kind === 'user' ? target.users[0] : target.kind === 'campaign' ? target.campaign : 'all';
    console.log(JSON.stringify({ evt: 'realtime_force', by: access.username, scope: (body as any).scope, target: dest, requested }));
    return accepted({ ok: true, scope: (body as any).scope, target: dest, requested });
  } catch (e) {
    console.error('[realtimeAdmin] error', e);
    return bad('error interno', 500);
  }
};
