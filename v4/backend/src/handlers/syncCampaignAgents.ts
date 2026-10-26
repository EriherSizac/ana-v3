// File: Sincronización programada (EventBridge, cada 5 min) de campaign-agents/{campaign}.json.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { deriveCampaignAgents, defaultDeriveDeps, type DeriveDeps } from '../lib/campaignAgents';
import { writeCampaignAgents, type CampaignAgentsList } from '../lib/campaignAgentsList';

export interface SyncDeps {
  derive: DeriveDeps;
  write: (list: CampaignAgentsList) => Promise<void>;
}

/**
 * Corrida atómica: primero se calcula TODO; si cualquier lectura falla no se
 * escribe ninguna lista (se conservan las anteriores) y la invocación termina
 * con error (métrica Errors → alarma tras 3 fallos seguidos, design D12).
 */
export async function runSync(deps: SyncDeps): Promise<{ campaigns: number; agents: number }> {
  const startedAt = Date.now();
  let result;
  try {
    result = await deriveCampaignAgents(deps.derive);
  } catch (e) {
    console.error(
      JSON.stringify({
        evt: 'agent_sync',
        status: 'failed',
        phase: 'read',
        error: e instanceof Error ? e.message : 'error',
        ms: Date.now() - startedAt,
      }),
    );
    throw e;
  }

  let written = 0;
  try {
    for (const list of result.lists) {
      await deps.write(list);
      written++;
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        evt: 'agent_sync',
        status: 'failed',
        phase: 'write',
        written,
        error: e instanceof Error ? e.message : 'error',
      }),
    );
    throw e;
  }

  console.log(
    JSON.stringify({
      evt: 'agent_sync',
      status: 'ok',
      campaigns: result.lists.length,
      ...result.stats,
      ms: Date.now() - startedAt,
    }),
  );
  return { campaigns: result.lists.length, agents: result.stats.agents };
}

export const handler = async (): Promise<void> => {
  await runSync({ derive: defaultDeriveDeps(), write: writeCampaignAgents });
};
