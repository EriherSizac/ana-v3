// File: Todos los agentes del roster de una campaña, con flag de actividad.
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';

// Roster de agentes por campaña. PK=campaign, SK=operatorId. Persistente (no
// TTL): el líder/admin necesitan ver a sus agentes aunque estén offline.
// `lastSeen` (heartbeat al conectar WhatsApp) distingue activos de inactivos.
const AGENTS_TABLE = process.env.AGENTS_TABLE!;
const ACTIVE_MS = 10 * 60 * 1000; // heartbeat dentro de 10 min = activo

export interface AgentEntry {
  campaign: string;
  operatorId: string;
  lastSeen: number;
  active: boolean;
}

export async function registerAgent(campaign: string, operatorId: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: AGENTS_TABLE,
      Item: { campaign, operatorId, lastSeen: Date.now() },
    }),
  );
}

/** Todos los agentes del roster de una campaña, con flag de actividad. */
export async function listCampaignAgents(campaign: string): Promise<AgentEntry[]> {
  const now = Date.now();
  const res = await ddb.send(
    new QueryCommand({
      TableName: AGENTS_TABLE,
      KeyConditionExpression: 'campaign = :c',
      ExpressionAttributeValues: { ':c': campaign },
    }),
  );
  return (res.Items ?? []).map((i) => ({
    campaign,
    operatorId: i.operatorId as string,
    lastSeen: (i.lastSeen as number) ?? 0,
    active: ((i.lastSeen as number) ?? 0) > now - ACTIVE_MS,
  }));
}

/** operatorIds activos (para reparto del líder). */
export async function listActiveAgents(campaign: string): Promise<string[]> {
  const agents = await listCampaignAgents(campaign);
  return agents.filter((a) => a.active).map((a) => a.operatorId);
}

/** ¿operatorId es agente de alguna de esas campañas? (autz de vista del líder) */
export async function isAgentInCampaigns(
  operatorId: string,
  campaigns: string[],
): Promise<boolean> {
  for (const campaign of campaigns) {
    const res = await ddb.send(
      new GetCommand({ TableName: AGENTS_TABLE, Key: { campaign, operatorId } }),
    );
    if (res.Item) return true;
  }
  return false;
}

/** Campañas distintas del roster (para que el admin elija). */
export async function listCampaigns(): Promise<string[]> {
  const res = await ddb.send(
    new ScanCommand({ TableName: AGENTS_TABLE, ProjectionExpression: 'campaign' }),
  );
  return [...new Set((res.Items ?? []).map((i) => i.campaign as string))];
}
