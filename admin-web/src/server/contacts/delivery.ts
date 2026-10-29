import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  agentFiles,
  assignmentsTooLong,
  buildPlan,
  detectPhoneColumn,
  hasReservedColumn,
  RESERVED_COLUMN_ERROR,
  unknownVariableError,
  variablesResolvingToUploadId,
  LIMITS,
  V3_INLINE_MAX_BYTES,
  parseCsvText,
  planHash,
  validateRows,
  sendColumnError,
  validRowsCsv,
  v4PhoneColumn,
  v4Assignments,
  type Fleet,
  type Mode,
} from '@/lib/contacts';
import { enabledRecipients, getRoster } from '../backends/rosters';
import { callUpstream, upstreamMessage } from '../backends/http';
import { serverEnv } from '../env';
import { codeForStatus, HttpError } from '../errors';

/** Body de `POST /api/campaigns/{campaign}/uploads` (design D8). */
export interface UploadRequest {
  fleet: Fleet;
  mode: Mode;
  agent?: string | null;
  fileName: string;
  /** CSV en la solicitud (v3 hasta 4 MB, v4 hasta 10 MB). Vacío en la carga v3 por S3. */
  csv: string;
  /** Carga v3 grande (support-crm-base-upload): CSV maestro ya subido con `POST .../uploads/presign`. */
  large?: { uploadId: string; sourceKey: string };
  /** Toggle "Incluir supervisores" (add-supervisor-contact-access): filtra el roster igual que la vista previa. */
  includeSupervisors: boolean;
  /** v4: código de país (default `52`) y columna de teléfono. Sin plantilla: el agente escribe el mensaje. */
  countryCode?: string;
  phoneColumn?: string | null;
  plan: { agents: string[]; counts: Record<string, number>; hash: string };
  /** link-review-contacts-to-uploads: origen de una reasignación (opcional, solo v3 `single`). */
  source?: unknown;
}

export const ROSTER_CHANGED = 'El roster cambió; revisa la nueva vista previa';

export function parseUploadRequest(body: unknown): UploadRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.fleet !== 'v3' && b.fleet !== 'v4') throw new HttpError('invalid_request', 'Flota inválida');
  if (b.mode !== 'distribute' && b.mode !== 'single') throw new HttpError('invalid_request', 'Modo inválido');
  let large: UploadRequest['large'];
  if (b.sourceKey !== undefined || b.uploadId !== undefined) {
    if (b.fleet !== 'v3') throw new HttpError('invalid_request', 'La carga por S3 solo aplica a v3');
    if (typeof b.uploadId !== 'string' || !UPLOAD_ID_RE.test(b.uploadId)) throw new HttpError('invalid_request', 'uploadId inválido');
    if (typeof b.sourceKey !== 'string' || !b.sourceKey) throw new HttpError('invalid_request', 'sourceKey inválido');
    if (b.csv !== undefined) throw new HttpError('invalid_request', 'csv y sourceKey son excluyentes');
    large = { uploadId: b.uploadId, sourceKey: b.sourceKey };
  } else if (typeof b.csv !== 'string' || !b.csv) throw new HttpError('invalid_request', 'Archivo requerido');
  if (typeof b.fileName !== 'string' || !b.fileName.trim()) throw new HttpError('invalid_request', 'Nombre de archivo requerido');
  const plan = b.plan as UploadRequest['plan'] | undefined;
  if (!plan || !Array.isArray(plan.agents) || typeof plan.hash !== 'string' || !plan.counts || typeof plan.counts !== 'object') {
    throw new HttpError('invalid_request', 'Plan requerido');
  }
  return {
    fleet: b.fleet,
    mode: b.mode,
    agent: typeof b.agent === 'string' ? b.agent : null,
    fileName: b.fileName.trim().slice(0, 255),
    csv: typeof b.csv === 'string' ? b.csv : '',
    ...(large ? { large } : {}),
    includeSupervisors: b.includeSupervisors === true,
    countryCode: typeof b.countryCode === 'string' && /^\d{1,4}$/.test(b.countryCode) ? b.countryCode : '52',
    phoneColumn: typeof b.phoneColumn === 'string' ? b.phoneColumn : null,
    plan,
    ...(b.source !== undefined ? { source: b.source } : {}),
  };
}

/** `{ts}-{8 hex}` (design D5). */
export function newUploadId(now = new Date()): string {
  const ts = now.toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return `${ts}-${randomBytes(4).toString('hex')}`;
}

const sameCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a).filter((k) => a[k]! > 0).sort();
  const kb = Object.keys(b).filter((k) => b[k]! > 0).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/**
 * Recalcula el plan con el roster vigente (D1) y lo compara con el de la
 * vista previa. Lanza 400 por archivo inválido y 409 si difiere.
 */
export async function verifyPlan(req: UploadRequest, token: string, campaign: { v3: string; v4: string }) {
  const fleet = req.fleet;
  // v3 en la solicitud: hasta 4 MB (lo que admite la Lambda); más grande va por S3.
  const inlineMax = fleet === 'v3' ? V3_INLINE_MAX_BYTES : LIMITS[fleet].maxBytes;
  if (Buffer.byteLength(req.csv, 'utf8') > inlineMax) {
    throw new HttpError('payload_too_large', `El archivo supera ${fleet === 'v3' ? '4 MB' : LIMITS[fleet].label} para ${fleet}`);
  }
  const parsed = parseCsvText(req.csv, fleet);
  if ('error' in parsed) throw new HttpError('invalid_request', parsed.error);
  const phone = detectPhoneColumn(parsed.header, fleet, req.phoneColumn);
  if ('error' in phone) throw new HttpError('invalid_request', phone.error);
  const sendError = sendColumnError(parsed.header, fleet, phone.column);
  if (sendError) throw new HttpError('invalid_request', sendError);
  if (fleet === 'v3' && hasReservedColumn(parsed.header)) throw new HttpError('invalid_request', RESERVED_COLUMN_ERROR);
  const { valid } = validateRows(parsed, fleet, phone.column);
  if (valid.length === 0) throw new HttpError('invalid_request', 'El archivo no tiene filas válidas');
  if (fleet === 'v3') {
    const bad = variablesResolvingToUploadId(valid.map((r) => r.record.message ?? ''), parsed.header);
    if (bad.length) throw new HttpError('invalid_request', unknownVariableError(bad));
  }

  const roster = await getRoster(fleet, token, campaign[fleet]);
  const enabled = enabledRecipients(roster, req.includeSupervisors).agents;
  const plan = buildPlan({ fleet, mode: req.mode, enabled, agent: req.agent, rows: valid });
  if ('error' in plan) throw new HttpError('conflict', ROSTER_CHANGED);
  const hash = await planHash(plan, valid);
  if (hash !== req.plan.hash || plan.agents.join('\n') !== req.plan.agents.join('\n') || !sameCounts(plan.counts, req.plan.counts)) {
    throw new HttpError('conflict', ROSTER_CHANGED);
  }
  if (fleet === 'v4' && assignmentsTooLong(plan)) {
    throw new HttpError('invalid_request', 'Demasiados agentes para un reparto en v4 (assignments > 1500 caracteres)');
  }
  return { parsed, valid, plan, phoneColumn: phone.column };
}

type Verified = Awaited<ReturnType<typeof verifyPlan>>;

// ── Carga v3 grande por S3 (support-crm-base-upload) ─────────────────────

export const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const V3_MAX_ROWS = LIMITS.v3.maxRows;

/** Llave del CSV maestro (misma que `incomingKey` de v3/ana-backend). */
export const incomingKey = (campaign: string, uploadId: string): string => `uploads-incoming/${campaign}/${uploadId}.csv`;

/**
 * Carga por S3: el BFF no recibe el archivo, así que verifica el roster con
 * el plan (orden de agentes y conteos de un reparto de `Σcounts` filas). La
 * Lambda de v3 verifica conteos y hash contra el CSV maestro.
 */
export async function verifyLargePlan(req: UploadRequest, token: string, campaign: string): Promise<{ rows: number; agents: string[] }> {
  const large = req.large!;
  if (large.sourceKey !== incomingKey(campaign, large.uploadId)) throw new HttpError('invalid_request', 'sourceKey no corresponde a la carga');
  if (!/^[0-9a-f]{64}$/.test(req.plan.hash)) throw new HttpError('invalid_request', 'Plan requerido');
  const counts = Object.values(req.plan.counts);
  if (counts.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 0)) throw new HttpError('invalid_request', 'Plan requerido');
  const rows = counts.reduce((a, n) => a + n, 0);
  if (rows === 0) throw new HttpError('invalid_request', 'El archivo no tiene filas válidas');
  if (rows > V3_MAX_ROWS) throw new HttpError('payload_too_large', `El archivo supera ${V3_MAX_ROWS.toLocaleString('es-MX')} filas para v3`);
  const roster = await getRoster('v3', token, campaign);
  const enabled = enabledRecipients(roster, req.includeSupervisors).agents;
  const fake = new Array(rows).fill(null).map(() => ({ rowNumber: 0, values: [], phone: '', digits: '', record: {} }));
  const plan = buildPlan({ fleet: 'v3', mode: req.mode, enabled, agent: req.agent, rows: fake });
  if ('error' in plan || plan.agents.join('\n') !== req.plan.agents.join('\n') || !sameCounts(plan.counts, req.plan.counts)) {
    throw new HttpError('conflict', ROSTER_CHANGED);
  }
  return { rows, agents: plan.agents };
}

/** `POST /admin/campaigns/{c}/contacts/presign` de v3: URL firmada (PUT) para el CSV maestro. */
export async function presignV3(token: string, campaign: string, uploadId: string, bytes: number) {
  const { v3ApiBase } = serverEnv();
  const res = await callUpstream<{ data?: { uploadId: string; sourceKey: string; url: string; expiresIn: number; headers: Record<string, string>; maxBytes: number } }>(
    `${v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/contacts/presign`,
    { method: 'POST', token, body: { uploadId, bytes }, label: 'v3:contacts:presign' },
  );
  if (res.status === 413) throw new HttpError('payload_too_large', `El archivo supera ${LIMITS.v3.label} para v3`);
  if (res.status < 200 || res.status >= 300 || !res.data?.data?.url) {
    const code = codeForStatus(res.status);
    throw new HttpError(code === 'unauthenticated' ? 'upstream_unavailable' : code, code === 'invalid_request' ? upstreamMessage(res.data) : undefined);
  }
  return res.data.data;
}

/** Entrega v3 por S3: la Lambda lee el CSV maestro, reparte, valida y escribe lo mismo que en línea. */
export async function deliverV3Large(req: UploadRequest, token: string, campaign: string): Promise<V3Manifest> {
  const large = req.large!;
  return postV3Contacts(
    {
      uploadId: large.uploadId,
      fileName: req.fileName,
      mode: req.mode,
      sourceKey: large.sourceKey,
      plan: { agents: req.plan.agents, counts: req.plan.counts, hash: req.plan.hash },
      ...(req.source !== undefined ? { source: req.source } : {}),
    },
    token,
    campaign,
    large.uploadId,
  );
}

export interface V3Manifest {
  uploadId: string;
  status: string;
  totalRows: number;
  perAgent: Array<{ agent: string; rows: number; key: string; historicKey: string }>;
  [k: string]: unknown;
}

/** Entrega v3 (D3): archivos por agente a la ruta de administración; reintenta una vez con el mismo uploadId. */
export async function deliverV3(req: UploadRequest, v: Verified, token: string, campaign: string, uploadId: string): Promise<V3Manifest> {
  const files = agentFiles(v.parsed.header, v.valid, v.plan).map(({ agent, csv }) => ({ agent, csv }));
  const body = {
    uploadId,
    fileName: req.fileName,
    mode: req.mode,
    files,
    ...(req.source !== undefined ? { source: req.source } : {}),
  };
  return postV3Contacts(body, token, campaign, uploadId);
}

async function postV3Contacts(body: Record<string, unknown>, token: string, campaign: string, uploadId: string): Promise<V3Manifest> {
  const { v3ApiBase } = serverEnv();
  const url = `${v3ApiBase}/admin/campaigns/${encodeURIComponent(campaign)}/contacts`;
  let res;
  try {
    res = await callUpstream<{ data?: V3Manifest; message?: string }>(url, { method: 'POST', token, body, timeoutMs: 29_000, label: 'v3:contacts' });
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'upstream_unavailable') throw e;
    console.error(JSON.stringify({ evt: 'contacts_upload', fleet: 'v3', campaign, uploadId, status: 'retry' }));
    res = await callUpstream<{ data?: V3Manifest; message?: string }>(url, { method: 'POST', token, body, timeoutMs: 29_000, label: 'v3:contacts' });
  }
  if (res.status === 409) throw new HttpError('conflict', ROSTER_CHANGED);
  if (res.status === 413) throw new HttpError('payload_too_large', 'El archivo es demasiado grande para v3');
  if (res.status < 200 || res.status >= 300 || !res.data?.data) {
    const code = codeForStatus(res.status);
    throw new HttpError(code === 'unauthenticated' ? 'upstream_unavailable' : code, code === 'invalid_request' ? upstreamMessage(res.data) : undefined);
  }
  return res.data.data;
}

/** Entrega v4 (D6): presign con el token del usuario y PUT desde el BFF con solo las filas válidas. */
export async function deliverV4(req: UploadRequest, v: Verified, token: string, campaign: string): Promise<{ srcKey: string }> {
  const { v4ApiBase } = serverEnv();
  const presign = await callUpstream<{ url?: string; key?: string; error?: string }>(`${v4ApiBase}/uploads/presign`, {
    method: 'POST',
    token,
    label: 'v4:presign',
    body: {
      filename: req.fileName,
      countryCode: req.countryCode,
      phoneColumn: v4PhoneColumn(v.phoneColumn),
      campaign,
      distribute: true,
      assignments: v4Assignments(v.plan),
    },
  });
  if (presign.status === 400 && /no habilitado/i.test(upstreamMessage(presign.data) ?? '')) throw new HttpError('conflict', ROSTER_CHANGED);
  if (presign.status === 503) throw new HttpError('upstream_unavailable');
  if (presign.status < 200 || presign.status >= 300 || !presign.data?.url || !presign.data.key) {
    const code = codeForStatus(presign.status);
    throw new HttpError(code === 'unauthenticated' ? 'upstream_unavailable' : code, code === 'invalid_request' ? upstreamMessage(presign.data) : undefined);
  }
  // Igual que el desktop: la metadata firmada viaja en la query del URL; sin headers extra.
  let put: Response;
  try {
    put = await fetch(presign.data.url, { method: 'PUT', body: validRowsCsv(v.parsed.header, v.valid, v.phoneColumn), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new HttpError('upstream_unavailable', 'No se pudo subir el archivo a v4. Intenta de nuevo.');
  }
  if (!put.ok) {
    console.error(JSON.stringify({ evt: 'contacts_upload', fleet: 'v4', campaign, status: 'put_failed', httpStatus: put.status }));
    throw new HttpError('upstream_unavailable', 'No se pudo subir el archivo a v4. Intenta de nuevo.');
  }
  return { srcKey: presign.data.key };
}
