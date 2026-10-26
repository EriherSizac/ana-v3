import { withAccess } from '@/server/access/withAccess';
import { callUpstream, upstreamMessage } from '@/server/backends/http';
import { ensureOk } from '@/server/backends/v4';
import { serverEnv } from '@/server/env';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Solo rol Developer (admin o líder no bastan; design D3). */
const DEVELOPER_ONLY = (a: { isDeveloper: boolean }) => a.isDeveloper;

interface CliSettingsView {
  settings: Record<string, boolean>;
  catalog: Array<{ key: string; type: string; default: boolean; label?: string; description: string }>;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** GET /api/cli-settings → v3 GET /admin/cli-settings con el token del usuario. */
export const GET = withAccess(
  async (_req, { identity }) => {
    const res = await callUpstream<{ data?: CliSettingsView }>(`${serverEnv().v3ApiBase}/admin/cli-settings`, {
      token: identity.token,
      label: 'v3:cli-settings',
    });
    return jsonResponse(ensureOk(res, 'v3:cli-settings').data);
  },
  { permission: DEVELOPER_ONLY, label: 'api/cli-settings' },
);

/** POST /api/cli-settings `{settings:{llave:valor}}` → v3 POST /admin/cli-settings. */
export const POST = withAccess(
  async (req, { identity }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError('invalid_request', 'Solicitud inválida');
    }
    const settings = (body as { settings?: unknown } | null)?.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new HttpError('invalid_request', 'settings inválido');
    const res = await callUpstream<{ data?: CliSettingsView; message?: string }>(`${serverEnv().v3ApiBase}/admin/cli-settings`, {
      method: 'POST',
      token: identity.token,
      body: { settings },
      label: 'v3:cli-settings:update',
    });
    if (res.status === 409) throw new HttpError('conflict', 'La configuración cambió; recarga para ver el valor actual');
    if (res.status === 400) throw new HttpError('invalid_request', upstreamMessage(res.data));
    return jsonResponse(ensureOk(res, 'v3:cli-settings:update').data);
  },
  { permission: DEVELOPER_ONLY, label: 'api/cli-settings:update' },
);
