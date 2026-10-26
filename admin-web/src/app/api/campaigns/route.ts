import { withAccess } from '@/server/access/withAccess';
import { listCampaigns } from '@/server/backends/v4';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Campañas seleccionables: v4 `GET /agents/campaigns` (catálogo ∩ campañas del usuario). */
export const GET = withAccess(
  async (_req, { identity }) => jsonResponse({ campaigns: await listCampaigns(identity.token) }),
  { label: 'api/campaigns' },
);
