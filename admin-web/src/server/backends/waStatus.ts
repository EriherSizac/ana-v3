/* eslint-disable @typescript-eslint/no-explicit-any -- parseo defensivo de respuestas externas */
import 'server-only';
import { serverEnv } from '../env';
import { codeForStatus, HttpError } from '../errors';
import { callUpstream, upstreamMessage, type UpstreamResult } from './http';

/**
 * Registro de estado de WhatsApp (add-whatsapp-status-registry): proxy de v3
 * con el id token del usuario. Valida forma y tamaño antes de llamar; nunca
 * registra teléfonos.
 */

export const MAX_LOOKUP = 2000;
export const MAX_MARK = 500;
const PHONE_RE = /^[0-9+()\s-]{1,32}$/;

const readJson = async (req: Request): Promise<Record<string, unknown>> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError('invalid_request', 'Solicitud inválida');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('invalid_request', 'Solicitud inválida');
  return body as Record<string, unknown>;
};

const phonesOf = (raw: unknown, max: number): string[] => {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError('invalid_request', 'phones requerido');
  if (raw.length > max) throw new HttpError('invalid_request', `Máximo ${max} teléfonos por solicitud`);
  if (!raw.every((p) => typeof p === 'string' && PHONE_RE.test(p))) throw new HttpError('invalid_request', 'Teléfono inválido');
  return raw as string[];
};

export async function parseLookupInput(req: Request): Promise<{ phones: string[] }> {
  return { phones: phonesOf((await readJson(req)).phones, MAX_LOOKUP) };
}

export interface MarkInput {
  phones: string[];
  status: 'no_whatsapp' | 'has_whatsapp';
  note?: string;
}

export async function parseMarkInput(req: Request): Promise<MarkInput> {
  const b = await readJson(req);
  if (b.status !== 'no_whatsapp' && b.status !== 'has_whatsapp') throw new HttpError('invalid_request', 'status inválido');
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 200)) throw new HttpError('invalid_request', 'note inválida');
  return { phones: phonesOf(b.phones, MAX_MARK), status: b.status, ...(typeof b.note === 'string' ? { note: b.note } : {}) };
}

function unwrap<T>(res: UpstreamResult<any>, label: string, agentRoute: boolean): T {
  if (res.status >= 200 && res.status < 300) {
    const body = res.data;
    return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`[upstream:${label}] status ${res.status}`);
    if (agentRoute) throw new HttpError('forbidden', 'No estás habilitado como agente v3 en esta campaña');
    if (res.status === 401) throw new HttpError('upstream_unavailable');
    throw new HttpError('forbidden');
  }
  const code = codeForStatus(res.status);
  throw new HttpError(code, code === 'invalid_request' ? upstreamMessage(res.data) : undefined);
}

const seg = encodeURIComponent;
const base = () => serverEnv().v3ApiBase;

/** v3 `POST /agent/wa-status/lookup`. */
export async function agentLookup(token: string, campaign: string, input: { phones: string[] }) {
  const res = await callUpstream(`${base()}/agent/wa-status/lookup`, { method: 'POST', token, body: { campaign, phones: input.phones }, timeoutMs: 29_000, label: 'v3:wa-status-lookup' });
  return unwrap<{ items: Record<string, unknown> }>(res, 'v3:wa-status-lookup', true);
}

/** v3 `POST /agent/wa-status`. */
export async function agentMark(token: string, campaign: string, input: MarkInput) {
  const res = await callUpstream(`${base()}/agent/wa-status`, { method: 'POST', token, body: { campaign, ...input }, timeoutMs: 15_000, label: 'v3:wa-status-mark' });
  return unwrap<{ updated: number; rejected: unknown[] }>(res, 'v3:wa-status-mark', true);
}

/** v3 `POST /admin/campaigns/{campaign}/wa-status/lookup` (vista previa de carga). */
export async function campaignLookup(token: string, campaign: string, input: { phones: string[] }) {
  const res = await callUpstream(`${base()}/admin/campaigns/${seg(campaign)}/wa-status/lookup`, {
    method: 'POST',
    token,
    body: { phones: input.phones },
    timeoutMs: 29_000,
    label: 'v3:campaign-wa-status-lookup',
  });
  return unwrap<{ items: Record<string, unknown> }>(res, 'v3:campaign-wa-status-lookup', false);
}
