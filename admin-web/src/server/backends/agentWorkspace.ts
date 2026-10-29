/* eslint-disable @typescript-eslint/no-explicit-any -- parseo defensivo de respuestas externas */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { serverEnv } from '../env';
import { codeForStatus, HttpError } from '../errors';
import { callUpstream, upstreamMessage, type UpstreamResult } from './http';

/**
 * "Mi asignación" (add-agent-workspace): llamadas a las rutas `/agent/*` de v3
 * con el id token del usuario (mismo App Client que el CLI). Nunca registra
 * contenido de los CSV ni mensajes.
 */

export const CHANGED_MESSAGE = 'La asignación cambió; vuelve a cargarla';

/** Traduce la respuesta de v3 a datos o a un error uniforme del BFF. */
function unwrap<T>(res: UpstreamResult<any>, label: string): T {
  if (res.status >= 200 && res.status < 300) {
    const body = res.data;
    // /agent/campaigns responde sin sobre; el resto con {success,data}.
    return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
  }
  const msg = upstreamMessage(res.data);
  if (res.status === 401 || res.status === 403) {
    console.error(`[upstream:${label}] status ${res.status}`);
    throw new HttpError('forbidden', msg === 'Archivo no permitido' ? msg : 'No estás habilitado como agente v3 en esta campaña');
  }
  if (res.status === 409) throw new HttpError('conflict', msg ?? CHANGED_MESSAGE);
  const code = codeForStatus(res.status);
  throw new HttpError(code, code === 'invalid_request' || code === 'not_found' || code === 'payload_too_large' ? msg : undefined);
}

const base = () => serverEnv().v3ApiBase;
const seg = encodeURIComponent;

export async function agentCampaigns(token: string): Promise<string[]> {
  const data = unwrap<{ campaigns?: unknown }>(await callUpstream(`${base()}/agent/campaigns`, { token, label: 'v3:agent-campaigns' }), 'v3:agent-campaigns');
  return Array.isArray(data?.campaigns) ? data.campaigns.filter((c): c is string => typeof c === 'string') : [];
}

export async function listPending(token: string, campaign: string) {
  return unwrap<{ campaign: string; agent: string; items: unknown[] }>(
    await callUpstream(`${base()}/agent/assignments/${seg(campaign)}`, { token, label: 'v3:agent-assignments' }),
    'v3:agent-assignments',
  );
}

export async function readPending(token: string, campaign: string, key: string) {
  return unwrap<{ key: string; etag: string; lastModified: string | null; csv: string }>(
    await callUpstream(`${base()}/agent/assignments/${seg(campaign)}/file?key=${seg(key)}`, { token, label: 'v3:agent-file' }),
    'v3:agent-file',
  );
}

export async function listPublications(token: string, campaign: string) {
  return unwrap<{ campaign: string; agent: string; items: unknown[] }>(
    await callUpstream(`${base()}/agent/assignments/${seg(campaign)}/publications`, { token, label: 'v3:agent-publications' }),
    'v3:agent-publications',
  );
}

/** `{ts}-{8 hex}` (design D4). */
export function newPublishId(now = new Date()): string {
  return `${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${randomBytes(4).toString('hex')}`;
}

export interface PublishInput {
  template: string;
  phoneColumns: string[];
  sources: Array<{ key: string; etag: string; rows: number[] }>;
  /** `first` | `all` (v3 asume `all` si falta). */
  phoneMode?: 'first' | 'all';
  /** `<key del archivo>#<índice de fila>` → teléfono elegido. */
  overrides?: Record<string, string>;
}

/** Publica con un `publishId` por confirmación; un reintento con el mismo id ante error de red o 5xx. */
export async function publish(token: string, campaign: string, input: PublishInput, publishId = newPublishId()) {
  const url = `${base()}/agent/assignments/${seg(campaign)}/publish`;
  const body = { publishId, ...input };
  let res: UpstreamResult<any>;
  try {
    res = await callUpstream(url, { method: 'POST', token, body, timeoutMs: 29_000, label: 'v3:agent-publish' });
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'upstream_unavailable') throw e;
    console.error(JSON.stringify({ evt: 'agent_publish', campaign, publishId, status: 'retry' }));
    res = await callUpstream(url, { method: 'POST', token, body, timeoutMs: 29_000, label: 'v3:agent-publish' });
  }
  return { publishId, manifest: unwrap<Record<string, unknown>>(res, 'v3:agent-publish') };
}

/** Valida el body de la página antes de llamar a v3. */
export function parsePublishInput(body: unknown): PublishInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.template !== 'string' || !b.template.trim()) throw new HttpError('invalid_request', 'Escribe el mensaje');
  if (!Array.isArray(b.phoneColumns) || !b.phoneColumns.every((c) => typeof c === 'string')) throw new HttpError('invalid_request', 'Columnas de teléfono inválidas');
  if (!Array.isArray(b.sources) || b.sources.length === 0) throw new HttpError('invalid_request', 'Selecciona al menos una fila');
  const sources = b.sources.map((s: any) => {
    if (typeof s?.key !== 'string' || typeof s?.etag !== 'string' || !Array.isArray(s?.rows)) throw new HttpError('invalid_request', 'Selección inválida');
    return { key: s.key, etag: s.etag, rows: s.rows as number[] };
  });
  const out: PublishInput = { template: b.template, phoneColumns: b.phoneColumns as string[], sources };
  // v3 valida el modo y que cada teléfono elegido sea de su fila (400 si no).
  if (b.phoneMode !== undefined) {
    if (b.phoneMode !== 'first' && b.phoneMode !== 'all') throw new HttpError('invalid_request', 'Modo de teléfono inválido');
    out.phoneMode = b.phoneMode;
  }
  if (b.overrides !== undefined) {
    const o = b.overrides;
    if (!o || typeof o !== 'object' || Array.isArray(o) || !Object.values(o).every((v) => typeof v === 'string')) {
      throw new HttpError('invalid_request', 'Teléfonos elegidos inválidos');
    }
    out.overrides = o as Record<string, string>;
  }
  return out;
}
