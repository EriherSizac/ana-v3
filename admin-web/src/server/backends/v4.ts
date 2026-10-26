import 'server-only';
import { serverEnv } from '../env';
import { codeForStatus, HttpError } from '../errors';
import { callUpstream, upstreamMessage } from './http';

/** Lanza HttpError uniforme para respuestas 4xx de un backend. */
export function ensureOk<T>(res: { status: number; data: T }, label: string): T {
  if (res.status >= 200 && res.status < 300) return res.data;
  const code = codeForStatus(res.status);
  // 401 de un backend con un token ya verificado = problema de configuración, no de sesión.
  if (code === 'unauthenticated') {
    console.error(`[upstream:${label}] 401 con token verificado`);
    throw new HttpError('upstream_unavailable');
  }
  throw new HttpError(code, upstreamMessage(res.data) && code !== 'forbidden' ? upstreamMessage(res.data) : undefined);
}

/** v4 `GET /agents/campaigns` con el token del usuario. */
export async function listCampaigns(token: string): Promise<string[]> {
  const { v4ApiBase } = serverEnv();
  const res = await callUpstream<{ campaigns?: unknown }>(`${v4ApiBase}/agents/campaigns`, {
    token,
    label: 'v4:campaigns',
  });
  const data = ensureOk(res, 'v4:campaigns');
  return Array.isArray(data?.campaigns) ? data.campaigns.filter((c): c is string => typeof c === 'string') : [];
}
