import { withAccess } from '@/server/access/withAccess';
import { callUpstream, upstreamMessage } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Solo rol Developer (admin o líder no bastan), igual que /api/cli-settings. */
const DEVELOPER_ONLY = (a: { isDeveloper: boolean }) => a.isDeveloper;

/** GET /api/v4/desktop-settings → v4 GET /admin/desktop-settings con el token del usuario. */
export const GET = withAccess(
  async (_req, { identity }) => {
    const res = await callUpstream(`${serverEnv().v4ApiBase}/admin/desktop-settings`, {
      token: identity.token,
      label: 'v4:desktop-settings',
    });
    return jsonResponse(ensureOk(res, 'v4:desktop-settings'));
  },
  { permission: DEVELOPER_ONLY, label: 'api/v4/desktop-settings' },
);

/** PUT /api/v4/desktop-settings `{version, values}` → v4 PUT /admin/desktop-settings. */
export const PUT = withAccess(
  async (req, { identity }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const b = (body ?? {}) as { version?: unknown; values?: unknown };
    if (typeof b.version !== 'number' || !b.values || typeof b.values !== 'object' || Array.isArray(b.values)) {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const res = await callUpstream(`${serverEnv().v4ApiBase}/admin/desktop-settings`, {
      method: 'PUT',
      token: identity.token,
      body: { version: b.version, values: b.values },
      label: 'v4:desktop-settings:update',
    });
    console.log(JSON.stringify({ evt: 'desktop_settings_update', by: identity.username, keys: Object.keys(b.values), status: res.status }));
    if (res.status === 409) throw new HttpError('conflict', 'La configuración cambió; recarga para ver el valor actual');
    if (res.status === 400) throw new HttpError('invalid_request', upstreamMessage(res.data));
    return jsonResponse(ensureOk(res, 'v4:desktop-settings:update'));
  },
  { permission: DEVELOPER_ONLY, label: 'api/v4/desktop-settings:update' },
);
