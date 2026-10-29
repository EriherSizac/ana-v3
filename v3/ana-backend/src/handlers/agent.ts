import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { requireAgentToken, type AgentAuthEvent } from '../lib/agentAuth';
import { CAMPAIGN_RE } from '../lib/identifiers';
import { getEnabledAgentsCached } from '../lib/roster';
import { bucketName, s3 } from '../lib/s3Json';
import { agentSettingsResponse } from './cliSettings';
import { getAgentIdentity } from '../lib/agentIdentity';

/**
 * Rutas `/agent/*` del CLI v3 (authorizer `cognitoAgentJwt` + verificación en
 * el handler, siempre estrictas: spec v3/agent-auth y v3/backend-api-security).
 */

type Result = { statusCode: number; headers: Record<string, string>; body: string };
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const CAMPAIGN_AGENTS_PREFIX = 'campaign-agents/';

/** Campañas con lista derivada (`campaign-agents/{campaign}.json`), paginado. */
export async function listDerivedCampaigns(): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucketName(), Prefix: CAMPAIGN_AGENTS_PREFIX, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) {
      const name = (o.Key ?? '').slice(CAMPAIGN_AGENTS_PREFIX.length);
      if (!name.endsWith('.json') || name.includes('/')) continue;
      const campaign = name.slice(0, -'.json'.length);
      if (CAMPAIGN_RE.test(campaign)) out.push(campaign);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/**
 * GET /agent/campaigns → `{username, campaigns, crmUserId, displayName}`: campañas
 * habilitadas (minúsculas, orden alfabético) + identidad CRM del agente desde la
 * API de Roles (null si no está disponible; crm-interactions-agent-identity).
 */
export const getAgentCampaigns = async (event: AgentAuthEvent): Promise<Result> => {
  const auth = await requireAgentToken(event, 'GET /agent/campaigns');
  if (!auth.ok) return auth.response;
  try {
    const campaigns = await listDerivedCampaigns();
    const enabled: string[] = [];
    for (const campaign of campaigns) {
      try {
        if ((await getEnabledAgentsCached(campaign)).includes(auth.username)) enabled.push(campaign);
      } catch (e) {
        // Lista ilegible o vencida: la campaña no se ofrece (fail-closed), sin cortar las demás.
        console.error(JSON.stringify({ evt: 'agent_campaigns_roster_error', campaign, name: (e as Error)?.name ?? 'Error' }));
      }
    }
    enabled.sort((a, b) => a.localeCompare(b));
    const identity = await getAgentIdentity(auth.username);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: auth.username, campaigns: enabled, ...identity }),
    };
  } catch (e) {
    console.error(JSON.stringify({ evt: 'agent_campaigns_error', name: (e as Error)?.name ?? 'Error' }));
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

/** GET /agent/settings (add-cli-remote-settings) con la autenticación de agente. */
export const getAgentSettings = async (event: AgentAuthEvent): Promise<Result> => {
  const auth = await requireAgentToken(event, 'GET /agent/settings');
  if (!auth.ok) return auth.response;
  return agentSettingsResponse();
};
