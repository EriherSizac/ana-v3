import { normalizeKeySegment } from './campaign';
import { getText, isConditionalConflict, putJsonConditional } from './s3Json';

/**
 * Contrato `v3/agent-roster` (design D1):
 *  - `campaign-agents/{campaign}.json`: lista derivada (la escribe solo la
 *    sincronización de v4). schemaVersion 1, vigencia 24 h.
 *  - `rosters/{campaign}.json`: solo excepciones por agente. schemaVersion 2.
 *  - Regla efectiva: derivado (lista vigente) ∧ no `enabled:false`.
 *
 * Lo consumen la autenticación del CLI (`migrate-cli-to-cognito-login`), la
 * carga de contactos y las rutas /admin/*. Todas las funciones reciben la
 * campaña y el username YA normalizados.
 */

export const LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ROSTER_WRITE_RETRIES = 3;

export const campaignAgentsKey = (campaign: string): string => `campaign-agents/${campaign}.json`;
export const rosterKey = (campaign: string): string => `rosters/${campaign}.json`;

export interface DerivedAgent {
  username: string;
  cognitoUsername: string;
  roleIds: string[];
}

export interface CampaignAgentsList {
  schemaVersion: 1;
  campaign: string;
  generatedAt: string | null;
  agents: DerivedAgent[];
}

export interface RosterOverride {
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface RosterV2 {
  schemaVersion: 2;
  campaign: string;
  updatedAt: string | null;
  updatedBy: string | null;
  overrides: Record<string, RosterOverride>;
}

/** Lista derivada o roster ilegible, de otra versión o vencido: fail-closed. */
export class RosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterError';
  }
}

/** Escritura condicional agotada tras los reintentos. */
export class RosterConflictError extends Error {
  constructor() {
    super('El roster cambió, intenta de nuevo');
    this.name = 'RosterConflictError';
  }
}

/** Se intentó habilitar a usuarios que no están en la lista derivada. */
export class NotAgentError extends Error {
  constructor(public readonly agents: string[]) {
    super('No es agente de la campaña');
    this.name = 'NotAgentError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Valida la forma de la lista derivada. Lanza RosterError. */
export function parseCampaignAgents(text: string, campaign: string, now = Date.now()): CampaignAgentsList {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RosterError(`campaign-agents/${campaign}.json: JSON inválido`);
  }
  if (!isObj(data) || data.schemaVersion !== 1) throw new RosterError(`campaign-agents/${campaign}.json: versión no soportada`);
  const generatedAt = typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : NaN;
  if (!Number.isFinite(generatedAt)) throw new RosterError(`campaign-agents/${campaign}.json: generatedAt inválido`);
  if (now - generatedAt > LIST_MAX_AGE_MS) throw new RosterError(`campaign-agents/${campaign}.json: lista vencida`);
  if (!Array.isArray(data.agents)) throw new RosterError(`campaign-agents/${campaign}.json: agents inválido`);
  const agents: DerivedAgent[] = [];
  for (const a of data.agents) {
    if (!isObj(a) || typeof a.username !== 'string') throw new RosterError(`campaign-agents/${campaign}.json: agente inválido`);
    const username = normalizeKeySegment(a.username);
    if (!username) throw new RosterError(`campaign-agents/${campaign}.json: agente inválido`);
    agents.push({
      username,
      cognitoUsername: typeof a.cognitoUsername === 'string' ? a.cognitoUsername : a.username,
      roleIds: Array.isArray(a.roleIds) ? a.roleIds.filter((r): r is string => typeof r === 'string') : [],
    });
  }
  agents.sort((x, y) => x.username.localeCompare(y.username));
  return { schemaVersion: 1, campaign, generatedAt: data.generatedAt as string, agents };
}

/** Lista derivada vigente. Inexistente = sin agentes (`generatedAt: null`). */
export async function readCampaignAgents(campaign: string, now = Date.now()): Promise<CampaignAgentsList> {
  const obj = await getText(campaignAgentsKey(campaign));
  if (obj.text === undefined) return { schemaVersion: 1, campaign, generatedAt: null, agents: [] };
  return parseCampaignAgents(obj.text, campaign, now);
}

export const emptyRoster = (campaign: string): RosterV2 => ({
  schemaVersion: 2,
  campaign,
  updatedAt: null,
  updatedBy: null,
  overrides: {},
});

/** Valida la forma del roster v2 (`enabled` booleano). Lanza RosterError. */
export function parseRoster(text: string, campaign: string): RosterV2 {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RosterError(`rosters/${campaign}.json: JSON inválido`);
  }
  if (!isObj(data) || data.schemaVersion !== 2) throw new RosterError(`rosters/${campaign}.json: versión no soportada`);
  if (!isObj(data.overrides)) throw new RosterError(`rosters/${campaign}.json: overrides inválido`);
  const overrides: Record<string, RosterOverride> = {};
  for (const [user, o] of Object.entries(data.overrides)) {
    if (!isObj(o) || typeof o.enabled !== 'boolean') throw new RosterError(`rosters/${campaign}.json: enabled no booleano`);
    overrides[normalizeKeySegment(user)] = {
      enabled: o.enabled,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : '',
    };
  }
  return {
    schemaVersion: 2,
    campaign,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    overrides,
  };
}

/** Roster (excepciones) + ETag. Inexistente = sin excepciones. */
export async function readRoster(campaign: string): Promise<{ roster: RosterV2; etag: string | null }> {
  const obj = await getText(rosterKey(campaign));
  if (obj.text === undefined) return { roster: emptyRoster(campaign), etag: null };
  return { roster: parseRoster(obj.text, campaign), etag: obj.etag };
}

/** Regla efectiva sobre datos ya leídos. */
export const isEnabledIn = (list: CampaignAgentsList, roster: RosterV2, username: string): boolean =>
  list.agents.some((a) => a.username === username) && roster.overrides[username]?.enabled !== false;

/** ¿El agente está habilitado en la campaña? Lanza RosterError si los datos son ilegibles. */
export async function isAgentEnabled(campaign: string, username: string, now = Date.now()): Promise<boolean> {
  const [list, { roster }] = await Promise.all([readCampaignAgents(campaign, now), readRoster(campaign)]);
  return isEnabledIn(list, roster, normalizeKeySegment(username));
}

/** Usernames habilitados de la campaña (orden alfabético). Lanza RosterError. */
export async function getEnabledAgents(campaign: string, now = Date.now()): Promise<string[]> {
  const [list, { roster }] = await Promise.all([readCampaignAgents(campaign, now), readRoster(campaign)]);
  return list.agents.filter((a) => roster.overrides[a.username]?.enabled !== false).map((a) => a.username);
}

// Caché ≤ 60 s para lectores de alta frecuencia (autenticación del CLI).
const READER_TTL_MS = 60_000;
const readerCache = new Map<string, { enabled: string[]; expiresAt: number }>();

/** Como getEnabledAgents con caché de 60 s; los errores no se cachean. */
export async function getEnabledAgentsCached(campaign: string): Promise<string[]> {
  const hit = readerCache.get(campaign);
  if (hit && hit.expiresAt > Date.now()) return hit.enabled;
  const enabled = await getEnabledAgents(campaign);
  readerCache.set(campaign, { enabled, expiresAt: Date.now() + READER_TTL_MS });
  return enabled;
}

/** Solo pruebas. */
export const clearRosterReaderCache = (): void => readerCache.clear();

export interface EffectiveAgent {
  username: string;
  enabled: boolean;
  override: RosterOverride | null;
}

export interface EffectiveRoster {
  campaign: string;
  generatedAt: string | null;
  agents: EffectiveAgent[];
  inactiveOverrides: Array<{ username: string } & RosterOverride>;
}

/** Vista de administración: lista derivada con estado efectivo + excepciones sin efecto. */
export function buildEffectiveRoster(list: CampaignAgentsList, roster: RosterV2): EffectiveRoster {
  const derived = new Set(list.agents.map((a) => a.username));
  return {
    campaign: list.campaign,
    generatedAt: list.generatedAt,
    agents: list.agents.map((a) => {
      const override = roster.overrides[a.username] ?? null;
      return { username: a.username, enabled: override?.enabled !== false, override };
    }),
    inactiveOverrides: Object.entries(roster.overrides)
      .filter(([u]) => !derived.has(u))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, o]) => ({ username, ...o })),
  };
}

export async function readEffectiveRoster(campaign: string, now = Date.now()): Promise<EffectiveRoster> {
  const [list, { roster }] = await Promise.all([readCampaignAgents(campaign, now), readRoster(campaign)]);
  return buildEffectiveRoster(list, roster);
}

export interface RosterChange {
  username: string;
  enabled: boolean;
}

/**
 * Guarda excepciones con lectura-modificación-escritura condicional y hasta
 * 3 intentos (design D2). `enabled:true` para alguien fuera de la lista
 * derivada → NotAgentError sin escribir. Conflicto persistente → RosterConflictError.
 */
export async function updateRoster(
  campaign: string,
  changes: RosterChange[],
  by: string,
  now: () => Date = () => new Date(),
): Promise<EffectiveRoster> {
  const list = await readCampaignAgents(campaign, now().getTime());
  const derived = new Set(list.agents.map((a) => a.username));
  const notAgents = changes.filter((c) => c.enabled && !derived.has(c.username)).map((c) => c.username);
  if (notAgents.length > 0) throw new NotAgentError(notAgents);

  for (let attempt = 0; attempt < ROSTER_WRITE_RETRIES; attempt++) {
    const { roster, etag } = await readRoster(campaign);
    const ts = now().toISOString();
    const next: RosterV2 = {
      ...roster,
      campaign,
      updatedAt: ts,
      updatedBy: by,
      overrides: { ...roster.overrides },
    };
    for (const c of changes) next.overrides[c.username] = { enabled: c.enabled, updatedAt: ts, updatedBy: by };
    try {
      await putJsonConditional(rosterKey(campaign), next, etag);
      return buildEffectiveRoster(list, next);
    } catch (e) {
      if (!isConditionalConflict(e)) throw e;
    }
  }
  throw new RosterConflictError();
}
