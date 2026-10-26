import { legacyAllowed } from '@/lib/legacy';
import { withAccess } from '@/server/access/withAccess';
import { proxyLegacy } from '@/server/backends/legacy';
import { HttpError } from '@/server/errors';

export const dynamic = 'force-dynamic';

const SEGMENT_RE = /^[A-Za-z0-9@._+-]{1,128}$/;

/** GET /api/campaigns/{campaign}/legacy-chats/{agent}/{phone} → v3 (contiene URLs firmadas: nunca se cachea). */
export const GET = withAccess<{ campaign: string; agent: string; phone: string }>(
  async (_req, { identity, campaign, params }) => {
    const agent = String(params.agent ?? '');
    const phone = String(params.phone ?? '');
    if (!SEGMENT_RE.test(agent) || !SEGMENT_RE.test(phone)) throw new HttpError('invalid_request', 'Conversación inválida');
    return proxyLegacy(
      identity.token,
      `/admin/campaigns/${encodeURIComponent(campaign)}/legacy-chats/${encodeURIComponent(agent)}/${encodeURIComponent(phone)}`,
      { notFoundMessage: 'Conversación no encontrada' },
    );
  },
  { permission: (a) => legacyAllowed(a), campaignFrom: 'path', label: 'api/legacy-chat' },
);
