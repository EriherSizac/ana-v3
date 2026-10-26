import { normalizeKeySegment, normalizePathSegment } from './campaign';

/**
 * Identificadores de las rutas /admin/* (spec v3/agent-roster, "Normalización
 * de campaña y agente"). La normalización (trim + toLowerCase) es la de
 * `campaign.ts`; aquí solo se agrega la validación de formato.
 */
export const CAMPAIGN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._@+-]{0,127}$/;

/** Campaña de un path param: decodifica, normaliza y valida. `null` si es inválida. */
export const parseCampaignParam = (raw: unknown): string | null => {
  const c = normalizePathSegment(raw);
  return CAMPAIGN_RE.test(c) ? c : null;
};

/** Campaña de un body/query: normaliza y valida. `null` si es inválida. */
export const parseCampaign = (raw: unknown): string | null => {
  const c = normalizeKeySegment(raw);
  return CAMPAIGN_RE.test(c) ? c : null;
};

/** Username (agente o autor): normaliza y valida. `null` si es inválido. */
export const parseUsername = (raw: unknown): string | null => {
  const u = normalizeKeySegment(raw);
  return USERNAME_RE.test(u) ? u : null;
};

/** Username de un path param (decodifica escapes `%`). */
export const parseUsernameParam = (raw: unknown): string | null => {
  const u = normalizePathSegment(raw);
  return USERNAME_RE.test(u) ? u : null;
};
