import { PERMISSIONS } from '@/lib/access';
import { withAccess } from '@/server/access/withAccess';
import { campaignLookup, parseLookupInput } from '@/server/backends/waStatus';
import { jsonResponse } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** POST /api/campaigns/{campaign}/wa-status/lookup {phones} — estado de WhatsApp para la vista previa de carga (v3 admin). */
export const POST = withAccess<{ campaign: string }>(
  async (req, { identity, campaign }) => jsonResponse(await campaignLookup(identity.token, campaign, await parseLookupInput(req))),
  { permission: PERMISSIONS.CONTACTS_UPLOAD, campaignFrom: 'path', label: 'api/campaign-wa-status-lookup' },
);
