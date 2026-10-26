import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { getUserRoles } from '@/server/directory/rolesApi';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/;

/** Detalle de roles de un usuario (`GET /users/{username}` con permisos inline). Solo lectura. */
export const GET = withAccess<{ username: string }>(
  async (_req, { params }) => {
    const username = String(params.username ?? '');
    if (!USERNAME_RE.test(username)) throw new HttpError('invalid_request', 'Usuario inválido');
    try {
      return jsonResponse({ username, roles: await getUserRoles(username), rolesAvailable: true });
    } catch (e) {
      console.error('[api/users/:username] API de Roles falló', e instanceof Error ? e.message : 'error');
      return jsonResponse({ username, roles: null, rolesAvailable: false });
    }
  },
  { permission: PERMISSIONS.AGENTS_MANAGE, label: 'api/users/detail' },
);
