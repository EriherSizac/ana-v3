/* eslint-disable @typescript-eslint/no-explicit-any -- parseo defensivo de respuestas externas */
import 'server-only';
import { serverEnv } from '../env';
import { codeForStatus, HttpError } from '../errors';
import { callUpstream, upstreamMessage, type UpstreamResult } from './http';

/**
 * Historial de envíos (add-agent-send-history): proxy de las consultas de v3
 * con el id token del usuario. Solo reenvía parámetros conocidos; nunca
 * registra filas ni teléfonos.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED: Record<string, (v: string) => boolean> = {
  from: (v) => DAY_RE.test(v),
  to: (v) => DAY_RE.test(v),
  status: (v) => /^[a-z_,]{1,60}$/.test(v),
  publicationId: (v) => /^[A-Za-z0-9-]{1,64}$/.test(v),
  q: (v) => v.length <= 64,
  sort: (v) => ['sentAt', 'status', 'credit'].includes(v),
  order: (v) => v === 'asc' || v === 'desc',
  cursor: (v) => /^\d{1,7}$/.test(v),
  limit: (v) => /^\d{1,3}$/.test(v),
};

/** Query segura para v3. `agent` solo en la vista de campaña. Lanza 400 si algo no cumple. */
export function resultsQuery(url: URL, opts: { allowAgent: boolean }): string {
  const out = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (k === 'agent' && opts.allowAgent) {
      if (!/^[A-Za-z0-9._@+-]{1,128}$/.test(v)) throw new HttpError('invalid_request', 'agent inválido');
      out.set(k, v);
      continue;
    }
    const check = ALLOWED[k];
    if (!check) continue;
    if (!check(v)) throw new HttpError('invalid_request', `${k} inválido`);
    out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

function unwrap<T>(res: UpstreamResult<any>, label: string, agentRoute: boolean): T {
  if (res.status >= 200 && res.status < 300) {
    const body = res.data;
    return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
  }
  const msg = upstreamMessage(res.data);
  if (res.status === 401 || res.status === 403) {
    console.error(`[upstream:${label}] status ${res.status}`);
    if (agentRoute) throw new HttpError('forbidden', 'No estás habilitado como agente v3 en esta campaña');
    if (res.status === 401) throw new HttpError('upstream_unavailable');
    throw new HttpError('forbidden');
  }
  const code = codeForStatus(res.status);
  throw new HttpError(code, code === 'invalid_request' ? msg : undefined);
}

const seg = encodeURIComponent;

/** v3 `GET /agent/results/{campaign}` (historial propio). */
export async function agentResults(token: string, campaign: string, query: string) {
  const res = await callUpstream(`${serverEnv().v3ApiBase}/agent/results/${seg(campaign)}${query}`, { token, timeoutMs: 29_000, label: 'v3:agent-results' });
  return unwrap<Record<string, unknown>>(res, 'v3:agent-results', true);
}

/** v3 `GET /admin/campaigns/{campaign}/results` (vista de campaña). */
export async function campaignResults(token: string, campaign: string, query: string) {
  const res = await callUpstream(`${serverEnv().v3ApiBase}/admin/campaigns/${seg(campaign)}/results${query}`, { token, timeoutMs: 29_000, label: 'v3:campaign-results' });
  return unwrap<Record<string, unknown>>(res, 'v3:campaign-results', false);
}
