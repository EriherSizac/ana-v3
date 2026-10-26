import { withAccess } from '@/server/access/withAccess';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Acceso efectivo del usuario (sin gate de entrada: la UI muestra "Sin acceso"). */
export const GET = withAccess(
  async (_req, { access }) =>
    jsonResponse({
      username: access.username,
      permissions: access.permissions,
      campaigns: access.campaigns,
      roleNames: access.roleNames,
      isAdmin: access.isAdmin,
      isLeader: access.isLeader,
      isDeveloper: access.isDeveloper,
    }),
  { entry: false, label: 'api/me' },
);
