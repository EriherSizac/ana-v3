import { legacyAllowed } from '@/lib/legacy';
import { withAccess } from '@/server/access/withAccess';
import { proxyLegacy } from '@/server/backends/legacy';

export const dynamic = 'force-dynamic';

/** GET /api/campaigns/{campaign}/legacy-agents → v3. */
export const GET = withAccess<{ campaign: string }>(
  async (_req, { identity, campaign }) => proxyLegacy(identity.token, `/admin/campaigns/${encodeURIComponent(campaign)}/legacy-agents`),
  { permission: (a) => legacyAllowed(a), campaignFrom: 'path', label: 'api/legacy-agents' },
);
