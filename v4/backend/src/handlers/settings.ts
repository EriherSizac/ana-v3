// File: Configuración remota del desktop v4 (v4-add-desktop-remote-settings).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok, bad, claimUser } from '../lib/http';
import { resolveUserAccess } from '../lib/access';
import { adminView, effectiveSettings, readSettings, validateUpdate, writeSettings } from '../lib/desktopSettings';
import { emitRealtime, forceRefresh } from '../lib/realtime';

/**
 * GET  /settings                → valores efectivos (cualquier autenticado).
 * GET  /admin/desktop-settings  → catálogo + valor + auditoría (solo Developer).
 * PUT  /admin/desktop-settings  → {version, values}; versión condicional (409).
 *
 * Developer = rol cuyo nombre contiene "developer" (sin mayúsculas ni acentos),
 * hard check: no depende de PERMISSIONS_ENFORCED ni de permisos `ana:*`.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const user = claimUser(event);
  if (!user) return bad('no autenticado', 401);
  try {
    if (event.routeKey === 'GET /settings') {
      const stored = await readSettings();
      return ok({ version: stored?.version ?? 0, values: effectiveSettings(stored) });
    }
    const access = await resolveUserAccess(user);
    if (event.routeKey === 'GET /admin/desktop-settings') {
      if (!access.isDeveloper) return bad('sin permiso', 403);
      return ok(adminView(await readSettings()));
    }
    if (event.routeKey === 'PUT /admin/desktop-settings') {
      if (!access.isDeveloper) return bad('sin permiso', 403);
      let body: { version?: unknown; values?: unknown };
      try {
        body = JSON.parse(event.body ?? '{}');
      } catch {
        return bad('body inválido');
      }
      const v = validateUpdate(body.values);
      if (!v.ok) return bad(v.error);
      if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0) return bad('falta version');
      const current = await readSettings();
      if ((current?.version ?? 0) !== body.version) return bad('la configuración cambió', 409);
      const saved = await writeSettings(current, body.version, v.values, access.username);
      if (!saved) return bad('la configuración cambió', 409);
      console.log(JSON.stringify({ evt: 'desktop_settings_update', by: access.username, keys: Object.keys(v.values), version: saved.version }));
      // Realtime (add-realtime-gateway D12): aviso a desktops y admins y
      // actualización forzada de todos los desktops. Nunca lanza.
      await Promise.all([
        emitRealtime({ type: 'settings.changed', ref: { scope: 'desktop' } }),
        forceRefresh({ reason: 'settings', target: { kind: 'client', client: 'desktop' }, by: access.username }),
      ]);
      return ok(adminView(saved));
    }
    return bad(`ruta no manejada: ${event.routeKey}`, 404);
  } catch (e) {
    console.error('[settings] error', event.routeKey, e);
    return bad('error interno', 500);
  }
};
