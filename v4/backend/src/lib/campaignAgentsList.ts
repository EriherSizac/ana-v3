// File: Lista derivada de agentes por campaña (campaign-agents/{campaign}.json en el bucket de v3).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// La lista vive en el bucket de v3 (us-east-1), no en los de v4 (us-east-2).
export const V3_BUCKET = () => process.env.V3_BUCKET ?? '';
const V3_BUCKET_REGION = process.env.V3_BUCKET_REGION || 'us-east-1';

export const v3s3 = new S3Client({ region: V3_BUCKET_REGION });

export const CAMPAIGN_AGENTS_PREFIX = 'campaign-agents/';
export const LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // vigencia de la lista: 24 h
const CACHE_TTL_MS = 60 * 1000;

/** Tipo de integrante de la lista (add-supervisor-contact-access D2). */
export type MemberKind = 'agent' | 'supervisor';

/** Tipo efectivo: `kind` ausente o desconocido = agente (listas anteriores). */
export const memberKind = (a: { kind?: unknown }): MemberKind => (a.kind === 'supervisor' ? 'supervisor' : 'agent');

export interface CampaignAgent {
  /** username normalizado (trim + minúsculas). */
  username: string;
  /** username tal como lo emite el pool (operatorId en v4). */
  cognitoUsername: string;
  roleIds: string[];
  /** Ausente = agente. */
  kind?: MemberKind;
}

export interface CampaignAgentsList {
  schemaVersion: 1;
  campaign: string;
  generatedAt: string;
  agents: CampaignAgent[];
}

/** Error de roster: lista ilegible, de otra versión o vencida (fail-closed). */
export class RosterListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterListError';
  }
}

/** Normalización de campaña y username (misma regla que v3: trim + minúsculas). */
export const normalizeId = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase() : '';

export const campaignAgentsKey = (campaign: string) =>
  `${CAMPAIGN_AGENTS_PREFIX}${normalizeId(campaign)}.json`;

/** Valida el contenido de una lista (lanza RosterListError si no es válida o está vencida). */
export function parseCampaignAgentsList(text: string, now = Date.now()): CampaignAgentsList {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RosterListError('lista de agentes ilegible');
  }
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.agents)) {
    throw new RosterListError('lista de agentes con versión no soportada');
  }
  const generated = Date.parse(data.generatedAt);
  if (!Number.isFinite(generated)) throw new RosterListError('lista de agentes sin generatedAt');
  if (now - generated > LIST_MAX_AGE_MS) throw new RosterListError('lista de agentes vencida');
  for (const a of data.agents) {
    if (!a || typeof a.username !== 'string' || typeof a.cognitoUsername !== 'string') {
      throw new RosterListError('lista de agentes ilegible');
    }
  }
  return data as CampaignAgentsList;
}

const cache = new Map<string, { at: number; list: CampaignAgentsList | null }>();

/** Solo pruebas. */
export function clearCampaignAgentsCache(): void {
  cache.clear();
}

/**
 * Lee la lista derivada de una campaña. `null` = la lista no existe (sin
 * agentes). Lanza RosterListError si es ilegible/vencida o S3 falla.
 * Caché de 60 s por campaña (solo resultados válidos; los errores no se cachean).
 */
export async function readCampaignAgents(campaign: string): Promise<CampaignAgentsList | null> {
  const c = normalizeId(campaign);
  const hit = cache.get(c);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    // La vigencia de 24 h se re-evalúa aunque esté en caché.
    if (hit.list && now - Date.parse(hit.list.generatedAt) > LIST_MAX_AGE_MS) {
      throw new RosterListError('lista de agentes vencida');
    }
    return hit.list;
  }
  let text: string;
  try {
    const res = await v3s3.send(new GetObjectCommand({ Bucket: V3_BUCKET(), Key: campaignAgentsKey(c) }));
    text = (await res.Body?.transformToString('utf-8')) ?? '';
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      cache.set(c, { at: now, list: null });
      return null;
    }
    console.error('[campaignAgents] lectura falló', c, e?.name);
    throw new RosterListError('lista de agentes no disponible');
  }
  const list = parseCampaignAgentsList(text, now);
  cache.set(c, { at: now, list });
  return list;
}

/** Escribe una lista (solo la usa syncCampaignAgents). */
export async function writeCampaignAgents(list: CampaignAgentsList): Promise<void> {
  await v3s3.send(
    new PutObjectCommand({
      Bucket: V3_BUCKET(),
      Key: campaignAgentsKey(list.campaign),
      Body: JSON.stringify(list),
      ContentType: 'application/json',
    }),
  );
}
