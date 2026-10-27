import 'server-only';

// Validación del cuerpo de POST /api/realtime/refresh (add-realtime-admin-web D8).

export type RefreshBody = { scope: 'all' } | { scope: 'user'; username: string } | { scope: 'campaign'; campaign: string };

/** Valida `{scope, username?, campaign?}`; null si el alcance es inválido o no trae destino. */
export function parseRefresh(raw: unknown): RefreshBody | null {
  const b = (raw ?? {}) as { scope?: unknown; username?: unknown; campaign?: unknown };
  if (b.scope === 'all') return { scope: 'all' };
  if (b.scope === 'user' && typeof b.username === 'string' && b.username.trim() && b.username.trim().length <= 128)
    return { scope: 'user', username: b.username.trim() };
  if (b.scope === 'campaign' && typeof b.campaign === 'string' && b.campaign.trim() && b.campaign.trim() !== '*' && b.campaign.trim().length <= 128)
    return { scope: 'campaign', campaign: b.campaign.trim() };
  return null;
}
