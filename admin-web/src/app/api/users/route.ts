import { PERMISSIONS } from '@/lib/access';
import { isValidCampaign, normalizeCampaign } from '@/lib/campaign';
import { FLEETS, type Fleet } from '@/lib/agents';
import { campaignAllowed, withAccess } from '@/server/access/withAccess';
import { buildListing, type RosterResult } from '@/server/agents/listing';
import { getRoster } from '@/server/backends/rosters';
import { invalidatePoolUsers, listPoolUsers } from '@/server/directory/cognito';
import { invalidateRoles, listUserRoles } from '@/server/directory/rolesApi';
import { HttpError, jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users?search=&page=&campaign=&filter=v3:agent&refresh=1
 * Usuarios del pool + roles (API de Roles) + estado de agente por flota.
 */
export const GET = withAccess(
  async (req, { access, identity }) => {
    const url = new URL(req.url);
    const search = (url.searchParams.get('search') ?? '').slice(0, 100);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const filters = url.searchParams.getAll('filter').filter((f) => /^v[34]:(agent|disabled|not_agent)$/.test(f));
    const rawCampaign = url.searchParams.get('campaign');
    let campaign: string | null = null;
    if (rawCampaign) {
      campaign = normalizeCampaign(rawCampaign);
      if (!isValidCampaign(campaign)) throw new HttpError('invalid_request', 'Campaña inválida');
      if (!campaignAllowed(access, campaign)) throw new HttpError('forbidden', 'Campaña no permitida');
    }
    if (url.searchParams.get('refresh') === '1') {
      invalidatePoolUsers();
      invalidateRoles();
    }

    let users;
    try {
      users = await listPoolUsers();
    } catch (e) {
      console.error('[api/users] ListUsers falló', e instanceof Error ? e.name : 'error');
      throw new HttpError('upstream_unavailable', 'No se pudo leer el directorio de usuarios. Intenta de nuevo.');
    }
    // La API de Roles caída no bloquea el listado ("Roles no disponibles").
    const roles = await listUserRoles().catch((e) => {
      console.error('[api/users] API de Roles falló', e instanceof Error ? e.message : 'error');
      return null;
    });

    let rosters: Record<Fleet, RosterResult> | null = null;
    if (campaign) {
      const results = await Promise.allSettled(FLEETS.map((f) => getRoster(f, identity.token, f === 'v4' ? rawCampaign!.trim() : campaign!)));
      rosters = Object.fromEntries(
        FLEETS.map((f, i) => {
          const r = results[i]!;
          return [
            f,
            r.status === 'fulfilled'
              ? { ok: true, roster: r.value }
              : { ok: false, message: r.reason instanceof HttpError ? r.reason.message : 'No disponible' },
          ];
        }),
      ) as Record<Fleet, RosterResult>;
    }

    return jsonResponse(buildListing({ users, roles, campaign, rosters, search, filters, page }));
  },
  { permission: PERMISSIONS.AGENTS_MANAGE, label: 'api/users' },
);
