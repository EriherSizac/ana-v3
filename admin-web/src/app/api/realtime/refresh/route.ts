import { withAccess } from '@/server/access/withAccess';
import { callUpstream, upstreamMessage } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';
import { parseRefresh } from '@/server/realtime';

export const dynamic = 'force-dynamic';

/** Solo `ana:admin:console:manage` o superadmin (`isAdmin` de v4 `/me`), igual que v4. */
const ADMIN_ONLY = (a: { isAdmin: boolean }) => a.isAdmin;

/**
 * POST /api/realtime/refresh → v4 POST /admin/realtime/refresh con el token del
 * usuario (add-realtime-admin-web D8): fuerza que las sesiones del alcance
 * relean su acceso. v4 vuelve a autorizar.
 */
export const POST = withAccess(
  async (req, { identity }) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const body = parseRefresh(raw);
    if (!body) throw new HttpError('invalid_request', 'Elige un usuario, una campaña o todos');
    const res = await callUpstream(`${serverEnv().v4ApiBase}/admin/realtime/refresh`, {
      method: 'POST',
      token: identity.token,
      body,
      label: 'v4:realtime-refresh',
    });
    console.log(
      JSON.stringify({
        evt: 'realtime_force',
        by: identity.username,
        scope: body.scope,
        target: body.scope === 'user' ? body.username : body.scope === 'campaign' ? body.campaign : 'all',
        status: res.status,
      }),
    );
    if (res.status === 400) throw new HttpError('invalid_request', upstreamMessage(res.data));
    return jsonResponse(ensureOk(res, 'v4:realtime-refresh'), 202);
  },
  { permission: ADMIN_ONLY, label: 'api/realtime/refresh' },
);
