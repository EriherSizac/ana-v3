import { legacyAllowed } from '@/lib/legacy';
import { withAccess } from '@/server/access/withAccess';
import { proxyLegacy } from '@/server/backends/legacy';

export const dynamic = 'force-dynamic';

/** GET /api/campaigns/{campaign}/legacy-chats?agent=&phone=&from=&to=&page= → v3 (sin caché). */
export const GET = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => {
    const src = new URL(req.url).searchParams;
    const qs = new URLSearchParams();
    for (const k of ['agent', 'phone', 'from', 'to', 'page']) {
      const v = src.get(k);
      if (v) qs.set(k, v.slice(0, 64));
    }
    return proxyLegacy(identity.token, `/admin/campaigns/${encodeURIComponent(campaign)}/legacy-chats${qs.size ? `?${qs}` : ''}`);
  },
  { permission: (a) => legacyAllowed(a), campaignFrom: 'path', label: 'api/legacy-chats' },
);
