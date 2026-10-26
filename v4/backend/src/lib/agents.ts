// File: Roster de agentes por campaña (heartbeat + excepciones administrativas).
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';
import { normalizeId, readCampaignAgents } from './campaignAgentsList';

// Roster de agentes por campaña. PK=campaign, SK=operatorId. Persistente (no
// TTL): el líder/admin necesitan ver a sus agentes aunque estén offline.
// `lastSeen` (heartbeat al conectar WhatsApp) distingue activos de inactivos.
// `enabled`/`enabledUpdatedAt`/`enabledUpdatedBy` = excepción administrativa
// (add-agent-roster-management D6); el heartbeat nunca los toca.
const AGENTS_TABLE = () => process.env.AGENTS_TABLE!;
const ACTIVE_MS = 10 * 60 * 1000; // heartbeat dentro de 10 min = activo

export interface AgentEntry {
  campaign: string;
  operatorId: string;
  lastSeen: number;
  active: boolean;
  enabled?: boolean;
  enabledUpdatedAt?: string;
  enabledUpdatedBy?: string;
}

/** Heartbeat: solo actualiza `lastSeen` (crea la entrada si no existe). */
export async function registerAgent(campaign: string, operatorId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: AGENTS_TABLE(),
      Key: { campaign, operatorId },
      UpdateExpression: 'SET lastSeen = :t',
      ExpressionAttributeValues: { ':t': Date.now() },
    }),
  );
}

/** Fija excepciones (enabled + autor/fecha) sin tocar `lastSeen`. */
export async function setAgentOverrides(
  campaign: string,
  entries: { operatorId: string; enabled: boolean }[],
  by: string,
): Promise<void> {
  const at = new Date().toISOString();
  for (const e of entries) {
    await ddb.send(
      new UpdateCommand({
        TableName: AGENTS_TABLE(),
        Key: { campaign, operatorId: e.operatorId },
        UpdateExpression: 'SET enabled = :e, enabledUpdatedAt = :a, enabledUpdatedBy = :b',
        ExpressionAttributeValues: { ':e': e.enabled, ':a': at, ':b': by },
      }),
    );
  }
}

/** Todos los agentes del roster de una campaña, con flag de actividad. */
export async function listCampaignAgents(campaign: string): Promise<AgentEntry[]> {
  const now = Date.now();
  const res = await ddb.send(
    new QueryCommand({
      TableName: AGENTS_TABLE(),
      KeyConditionExpression: 'campaign = :c',
      ExpressionAttributeValues: { ':c': campaign },
    }),
  );
  return (res.Items ?? []).map((i) => ({
    campaign,
    operatorId: i.operatorId as string,
    lastSeen: (i.lastSeen as number) ?? 0,
    active: ((i.lastSeen as number) ?? 0) > now - ACTIVE_MS,
    ...(typeof i.enabled === 'boolean'
      ? {
          enabled: i.enabled,
          enabledUpdatedAt: i.enabledUpdatedAt as string | undefined,
          enabledUpdatedBy: i.enabledUpdatedBy as string | undefined,
        }
      : {}),
  }));
}

/**
 * operatorIds habilitados en v4 para la campaña: lista derivada vigente
 * (campaign-agents/, ≤ 24 h, caché 60 s) menos entradas con `enabled:false`.
 * Comparación por username normalizado (`Ana.Lopez` = `ana.lopez`); devuelve
 * el `cognitoUsername` (operatorId tal como lo emite el pool).
 * Lanza RosterListError si la lista está en error (ilegible o vencida).
 */
export async function listEnabledAgents(campaign: string): Promise<string[]> {
  const list = await readCampaignAgents(campaign);
  if (!list) return [];
  const entries = await listCampaignAgents(campaign);
  const disabled = new Set(entries.filter((e) => e.enabled === false).map((e) => normalizeId(e.operatorId)));
  return list.agents.filter((a) => !disabled.has(normalizeId(a.username))).map((a) => a.cognitoUsername);
}

/** operatorIds activos (para reparto del líder). */
export async function listActiveAgents(campaign: string): Promise<string[]> {
  const agents = await listCampaignAgents(campaign);
  return agents.filter((a) => a.active).map((a) => a.operatorId);
}

/** ¿operatorId es agente de alguna de esas campañas? (autz de vista del líder) */
export async function isAgentInCampaigns(operatorId: string, campaigns: string[]): Promise<boolean> {
  for (const campaign of campaigns) {
    const res = await ddb.send(new GetCommand({ TableName: AGENTS_TABLE(), Key: { campaign, operatorId } }));
    if (res.Item) return true;
  }
  return false;
}

/** Campañas distintas del roster (para que el admin elija). */
export async function listCampaigns(): Promise<string[]> {
  const res = await ddb.send(new ScanCommand({ TableName: AGENTS_TABLE(), ProjectionExpression: 'campaign' }));
  return [...new Set((res.Items ?? []).map((i) => i.campaign as string))];
}
