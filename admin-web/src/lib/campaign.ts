// Normalización de identificadores de campaña y de usuario. Misma regla que
// v3 (`fix-campaign-case-normalization`, D1): trim + toLowerCase() plano.

export function normalizeCampaign(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// Segmento seguro para llaves S3 y rutas: sin `/`, `\`, espacios ni control.
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function isValidCampaign(c: string): boolean {
  return c === '*' ? false : CAMPAIGN_RE.test(c) && !c.includes('..');
}
