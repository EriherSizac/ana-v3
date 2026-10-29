import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdminAccess } from '../lib/adminAccess';
import { adminError, adminInternal, adminOk, parseJsonBody, type AdminEvent, type AdminResult } from '../lib/adminHttp';
import { duplicateCredit, headerColumns, isPhoneColumnName, singleLineRows, stripBom } from '../lib/contactsCsv';
import { parseCampaignParam, parseUsername } from '../lib/identifiers';
import { convertDateRows, incomingKey, MAX_SOURCE_BYTES, splitMaster } from '../lib/contactsSource';
import { getEnabledAgents, RosterError } from '../lib/roster';
import { bucketName, getText, putJson, s3 } from '../lib/s3Json';

/**
 * POST /admin/campaigns/{campaign}/contacts — carga de contactos de ANA Admin.
 * GET  /admin/campaigns/{campaign}/uploads  — historial (50 más recientes).
 * (authorizer `cognitoAdminJwt`; spec v3/agent-assignments de add-contact-upload-console)
 *
 * Escribe en las asignaciones pendientes del agente
 * `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv` + copia en
 * `historic/` (add-supervisor-contact-access D5: el agente publica a `agents/`
 * desde "Mi asignación"), sin mensaje, con manifiesto idempotente en
 * `uploads/{campaign}/{uploadId}.json`. Nunca registra contenido de los CSV.
 */

export const CONTACTS_UPLOAD = 'ana:contacts:list:upload';
export const CONTACTS_DISTRIBUTE = 'ana:contacts:list:distribute';
export const MAX_BODY_BYTES = 5_500_000;
const MAX_FILES = 200;
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const HISTORY_LIMIT = 50;
/** Columna reservada (link-review-contacts-to-uploads D1): última columna con el uploadId. */
export const UPLOAD_ID_COLUMN = 'ana_upload_id';
const ASSIGNMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SOURCE_ITEMS = 5000;

export interface ReviewSource {
  type: 'review';
  fromUploadId: string;
  items: Array<{ agent: string; assignmentId: string; phone: string }>;
}

/** Valida `source` (origen de una reasignación). Devuelve el source o el mensaje de error. */
export function parseSource(raw: unknown): ReviewSource | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'source inválido' };
  const r = raw as Record<string, unknown>;
  if (r.type !== 'review') return { error: 'source.type debe ser review' };
  if (typeof r.fromUploadId !== 'string' || (r.fromUploadId !== 'none' && !UPLOAD_ID_RE.test(r.fromUploadId))) {
    return { error: 'source.fromUploadId inválido' };
  }
  if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > MAX_SOURCE_ITEMS) {
    return { error: `source.items debe tener entre 1 y ${MAX_SOURCE_ITEMS} elementos` };
  }
  const items: ReviewSource['items'] = [];
  for (const it of r.items) {
    const agent = parseUsername((it as { agent?: unknown })?.agent);
    const assignmentId = (it as { assignmentId?: unknown })?.assignmentId;
    const phone = (it as { phone?: unknown })?.phone;
    if (!agent || typeof assignmentId !== 'string' || !ASSIGNMENT_ID_RE.test(assignmentId) || typeof phone !== 'string' || !phone.replace(/\D/g, '')) {
      return { error: 'source.items inválido' };
    }
    items.push({ agent, assignmentId, phone });
  }
  return { type: 'review', fromUploadId: r.fromUploadId, items };
}

/** Agrega `ana_upload_id` como última columna de cada fila (encabezado incluido). */
export function appendUploadIdColumn(csv: string, uploadId: string): string {
  const lines = csv.replace(/\n$/, '').split('\n');
  return lines.map((l, i) => (i === 0 ? `${l},${UPLOAD_ID_COLUMN}` : l.trim() ? `${l},${uploadId}` : l)).join('\n') + '\n';
}

/**
 * Filas del CSV como las escribía la carga (recorta cada línea, omite vacías,
 * termina en salto de línea) sin agregar columna `message`.
 */
export function normalizeRows(csv: string): { csv: string; contactCount: number } {
  // Filas lógicas: saltos de línea dentro de comillas → espacio (support-crm-base-upload).
  // Números de serie de Excel en columnas de fecha → dd/mm/yyyy (support-crm-base-upload "Fechas de Excel").
  const out = convertDateRows(singleLineRows(csv));
  if (out.length === 0) out.push('');
  return { csv: out.join('\n') + '\n', contactCount: out.length - 1 };
}

export interface ManifestEntry {
  agent: string;
  rows: number;
  key: string;
  historicKey: string;
}

export interface UploadManifest {
  schemaVersion: 1;
  uploadId: string;
  campaign: string;
  fileName: string;
  mode: 'distribute' | 'single';
  uploadedBy: string;
  uploadedAt: string;
  status: 'completed' | 'failed';
  /** Dónde quedaron los archivos (add-supervisor-contact-access): pendientes del agente. */
  destination: 'assignments';
  /** Siempre null: quien carga ya no define el mensaje. */
  message: string | null;
  totalRows: number;
  perAgent: ManifestEntry[];
  /** Lo agrega link-review-contacts-to-uploads (opcional). */
  source?: unknown;
}

export const manifestKey = (campaign: string, uploadId: string): string => `uploads/${campaign}/${uploadId}.json`;

/** Timestamp seguro para llaves S3 (mismo formato que la carga de supervisor). */
export const makeTimestampForKey = (d = new Date()): string => d.toISOString().replace(/[:.]/g, '-');

const bodyBytes = (event: AdminEvent): number => {
  if (!event.body) return 0;
  return event.isBase64Encoded ? Math.floor((event.body.length * 3) / 4) : Buffer.byteLength(event.body, 'utf8');
};

interface ParsedUpload {
  uploadId: string;
  fileName: string;
  mode: 'distribute' | 'single';
  files: Array<{ agent: string; csv: string }>;
  source?: ReviewSource;
  /** Carga grande (support-crm-base-upload): CSV maestro en S3 y plan a verificar. */
  sourceKey?: string;
  plan?: { agents: string[]; counts: Record<string, number>; hash: string };
}

/** Plan del body de una carga por S3: agentes en orden, conteos y hash. */
function parsePlan(raw: unknown): NonNullable<ParsedUpload['plan']> | { error: string } {
  const p = raw as { agents?: unknown; counts?: unknown; hash?: unknown } | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.agents) || p.agents.length === 0 || p.agents.length > MAX_FILES) return { error: 'plan inválido' };
  const agents: string[] = [];
  for (const a of p.agents) {
    const u = parseUsername(a);
    if (!u || agents.includes(u)) return { error: 'plan.agents inválido' };
    agents.push(u);
  }
  if (typeof p.hash !== 'string' || !/^[0-9a-f]{64}$/.test(p.hash)) return { error: 'plan.hash inválido' };
  if (!p.counts || typeof p.counts !== 'object' || Array.isArray(p.counts)) return { error: 'plan.counts inválido' };
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.counts as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { error: 'plan.counts inválido' };
    counts[k] = v;
  }
  return { agents, counts, hash: p.hash };
}

/** Valida el body de la carga. Devuelve los datos o el mensaje de error (400). */
export function parseUploadBody(body: unknown): ParsedUpload | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body inválido' };
  const b = body as Record<string, unknown>;
  if (typeof b.uploadId !== 'string' || !UPLOAD_ID_RE.test(b.uploadId)) return { error: 'uploadId inválido' };
  if (typeof b.fileName !== 'string' || !b.fileName.trim() || b.fileName.length > 255) return { error: 'fileName inválido' };
  if (b.mode !== 'distribute' && b.mode !== 'single') return { error: 'mode inválido' };
  // `message` se ignora (clientes anteriores lo enviaban): el agente escribe el mensaje.
  let source: ReviewSource | undefined;
  if (b.source !== undefined && b.source !== null) {
    const parsedSource = parseSource(b.source);
    if ('error' in parsedSource) return { error: parsedSource.error };
    if (b.mode !== 'single') return { error: 'source requiere mode single' };
    source = parsedSource;
  }
  if (b.sourceKey !== undefined) {
    // Carga grande: los archivos por agente salen del CSV maestro en S3.
    if (typeof b.sourceKey !== 'string' || !b.sourceKey) return { error: 'sourceKey inválido' };
    if (b.files !== undefined) return { error: 'files y sourceKey son excluyentes' };
    const plan = parsePlan(b.plan);
    if ('error' in plan) return { error: plan.error };
    if (b.mode === 'single' && plan.agents.length !== 1) return { error: 'plan.agents inválido' };
    return { uploadId: b.uploadId, fileName: b.fileName.trim(), mode: b.mode, files: [], sourceKey: b.sourceKey, plan, ...(source ? { source } : {}) };
  }
  if (!Array.isArray(b.files) || b.files.length === 0) return { error: 'files debe tener al menos un archivo' };
  if (b.files.length > MAX_FILES) return { error: `files admite como máximo ${MAX_FILES} archivos` };
  const seen = new Set<string>();
  const files: ParsedUpload['files'] = [];
  for (const f of b.files) {
    if (!f || typeof f !== 'object') return { error: 'Archivo inválido' };
    const agent = parseUsername((f as { agent?: unknown }).agent);
    if (!agent) return { error: 'Agente inválido' };
    const csv = (f as { csv?: unknown }).csv;
    if (typeof csv !== 'string') return { error: `${agent}: csv inválido` };
    if (seen.has(agent)) return { error: `Agente repetido: ${agent}` };
    seen.add(agent);
    files.push({ agent, csv: stripBom(csv) });
  }
  return {
    uploadId: b.uploadId,
    fileName: b.fileName.trim(),
    mode: b.mode,
    files,
    ...(source ? { source } : {}),
  };
}

/** Valida cada CSV (columna de teléfono, filas). `null` si todo bien. */
export function validateFiles(p: Pick<ParsedUpload, 'files'>): string | null {
  for (const f of p.files) {
    const cols = headerColumns(f.csv);
    if (cols.some((c) => c.toLowerCase() === UPLOAD_ID_COLUMN)) return `${f.agent}: columna reservada ${UPLOAD_ID_COLUMN}`;
    if (!cols.some(isPhoneColumnName)) return `${f.agent}: falta columna de teléfono`;
    if (singleLineRows(f.csv).length < 2) return `${f.agent}: sin filas`;
  }
  // Duplicados por crédito entre todas las filas de la carga (support-crm-base-upload).
  const dup = duplicateCredit(p.files.map((f) => f.csv));
  if (dup !== null) return `Crédito duplicado: ${dup}`;
  return null;
}

async function readManifest(campaign: string, uploadId: string): Promise<UploadManifest | null> {
  const obj = await getText(manifestKey(campaign, uploadId));
  if (obj.text === undefined) return null;
  try {
    return JSON.parse(obj.text) as UploadManifest;
  } catch {
    return null;
  }
}

export const uploadContacts = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  if (bodyBytes(event) > MAX_BODY_BYTES) return adminError(413, 'Archivo demasiado grande');

  const auth = await requireAdminAccess(event, { permissions: [CONTACTS_UPLOAD, CONTACTS_DISTRIBUTE], campaign });
  if (!auth.ok) return auth.response;

  const body = parseJsonBody(event);
  if (body === undefined) return adminError(400, 'Body inválido');
  const parsed = parseUploadBody(body);
  if ('error' in parsed) return adminError(400, parsed.error);
  if (parsed.sourceKey !== undefined) {
    if (parsed.sourceKey !== incomingKey(campaign, parsed.uploadId)) return adminError(400, 'sourceKey no corresponde a la carga');
  } else {
    const invalid = validateFiles(parsed);
    if (invalid) return adminError(400, invalid);
  }

  const ctx = { evt: 'admin_contacts_upload', campaign, uploadId: parsed.uploadId, by: auth.username };
  try {
    // Idempotencia: una carga completada con el mismo uploadId se devuelve tal cual.
    const existing = await readManifest(campaign, parsed.uploadId);
    if (existing?.status === 'completed') {
      console.log(JSON.stringify({ ...ctx, status: 'duplicate' }));
      return adminOk(existing);
    }

    let enabled: string[];
    try {
      enabled = await getEnabledAgents(campaign);
    } catch (e) {
      if (e instanceof RosterError) {
        console.error(JSON.stringify({ ...ctx, status: 'roster_error', message: e.message }));
        return adminError(500, 'Roster ilegible');
      }
      throw e;
    }
    if (parsed.sourceKey !== undefined) {
      const loaded = await loadFromSource(parsed, ctx);
      if ('response' in loaded) return loaded.response;
      parsed.files = loaded.files;
    }
    const notEnabled = parsed.files.map((f) => f.agent).filter((a) => !enabled.includes(a));
    if (notEnabled.length > 0) return adminError(409, 'Agentes no habilitados', { agents: notEnabled });

    const ts = makeTimestampForKey();
    const perAgent: ManifestEntry[] = [];
    const written: string[] = [];
    let failure: unknown = null;
    for (const f of parsed.files) {
      const processed = normalizeRows(f.csv);
      const csv = appendUploadIdColumn(processed.csv, parsed.uploadId);
      const key = `assignments/agents/${campaign}/${f.agent}-contacts-${ts}.csv`;
      const historicKey = `historic/agents/${campaign}/${f.agent}-contacts-${ts}.csv`;
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: csv, ContentType: 'text/csv' }));
        written.push(key);
        await s3.send(new PutObjectCommand({ Bucket: bucketName(), Key: historicKey, Body: csv, ContentType: 'text/csv' }));
      } catch (e) {
        failure = e;
        break;
      }
      perAgent.push({ agent: f.agent, rows: processed.contactCount, key, historicKey });
    }

    const manifest: UploadManifest = {
      schemaVersion: 1,
      uploadId: parsed.uploadId,
      campaign,
      fileName: parsed.fileName,
      mode: parsed.mode,
      uploadedBy: auth.username,
      uploadedAt: new Date().toISOString(),
      status: failure ? 'failed' : 'completed',
      destination: 'assignments',
      message: null,
      totalRows: perAgent.reduce((n, p) => n + p.rows, 0),
      perAgent,
      ...(parsed.source !== undefined ? { source: parsed.source } : {}),
    };

    if (failure) {
      // Rollback best-effort de los pendientes ya escritos (assignments/).
      const rolledBack: string[] = [];
      for (const key of written) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
          rolledBack.push(key);
        } catch {
          /* queda en written sin rolledBack */
        }
      }
      try {
        await putJson(manifestKey(campaign, parsed.uploadId), manifest);
      } catch {
        /* el manifiesto failed es best-effort */
      }
      const err = failure as { name?: string };
      console.error(JSON.stringify({ ...ctx, status: 'failed', error: err?.name ?? 'Error', written: written.length, rolledBack: rolledBack.length }));
      return adminError(500, 'Error interno del servidor', { written, rolledBack });
    }

    await putJson(manifestKey(campaign, parsed.uploadId), manifest);
    if (parsed.sourceKey !== undefined) {
      // El CSV maestro ya no se necesita (la regla de ciclo de vida limpia los que queden).
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: parsed.sourceKey }));
      } catch {
        console.error(JSON.stringify({ ...ctx, status: 'incoming_not_deleted' }));
      }
    }
    console.log(JSON.stringify({ ...ctx, status: 'completed', files: perAgent.length, totalRows: manifest.totalRows, viaS3: parsed.sourceKey !== undefined }));
    return adminOk(manifest);
  } catch (e) {
    return adminInternal('uploadContacts', e);
  }
};

const isNotFound = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
};

/**
 * Lee el CSV maestro de `uploads-incoming/`, lo reparte según el plan y aplica
 * las mismas validaciones que la carga en línea. El plan (conteos y hash) debe
 * coincidir con el archivo; si no, 409 (la vista previa ya no corresponde).
 */
async function loadFromSource(parsed: ParsedUpload, ctx: Record<string, unknown>): Promise<{ files: ParsedUpload['files'] } | { response: AdminResult }> {
  const plan = parsed.plan!;
  let text: string;
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: parsed.sourceKey! }));
    if ((out.ContentLength ?? 0) > MAX_SOURCE_BYTES) return { response: adminError(413, 'Archivo demasiado grande') };
    text = stripBom((await out.Body?.transformToString('utf-8')) ?? '');
  } catch (e) {
    if (isNotFound(e)) return { response: adminError(400, 'No se encontró el archivo subido; vuelve a cargarlo') };
    throw e;
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) return { response: adminError(413, 'Archivo demasiado grande') };
  const split = splitMaster(text, plan.agents, parsed.mode);
  if ('error' in split) return { response: adminError(400, split.error) };
  const files = split.files;
  const invalid = validateFiles({ files });
  if (invalid) return { response: adminError(400, invalid) };
  const expected = Object.entries(plan.counts).filter(([, n]) => n > 0);
  const actual = Object.entries(split.counts).filter(([, n]) => n > 0);
  const sameCounts = expected.length === actual.length && actual.every(([a, n]) => plan.counts[a] === n);
  if (!sameCounts || split.hash !== plan.hash) {
    console.error(JSON.stringify({ ...ctx, status: 'plan_mismatch', rows: split.rows }));
    return { response: adminError(409, 'El plan no coincide con el archivo') };
  }
  return { files };
}

/**
 * POST /admin/campaigns/{campaign}/contacts/presign — URL firmada (PUT, 15 min)
 * para subir el CSV maestro de una carga grande a
 * `uploads-incoming/{campaign}/{uploadId}.csv`. El tamaño declarado se firma
 * (Content-Length) y no puede superar 50 MB.
 */
export const PRESIGN_TTL_SECONDS = 900;

export const presignContacts = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const auth = await requireAdminAccess(event, { permissions: [CONTACTS_UPLOAD, CONTACTS_DISTRIBUTE], campaign });
  if (!auth.ok) return auth.response;
  const body = parseJsonBody(event) as { uploadId?: unknown; bytes?: unknown } | undefined;
  if (!body || typeof body !== 'object') return adminError(400, 'Body inválido');
  if (typeof body.uploadId !== 'string' || !UPLOAD_ID_RE.test(body.uploadId)) return adminError(400, 'uploadId inválido');
  const bytes = body.bytes;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return adminError(400, 'bytes inválido');
  if (bytes > MAX_SOURCE_BYTES) return adminError(413, 'El archivo supera 50 MB para v3');
  try {
    const sourceKey = incomingKey(campaign, body.uploadId);
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucketName(), Key: sourceKey, ContentType: 'text/csv', ContentLength: bytes }),
      { expiresIn: PRESIGN_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    console.log(JSON.stringify({ evt: 'admin_contacts_presign', campaign, uploadId: body.uploadId, by: auth.username, bytes }));
    return adminOk({ uploadId: body.uploadId, sourceKey, url, expiresIn: PRESIGN_TTL_SECONDS, headers: { 'Content-Type': 'text/csv' }, maxBytes: MAX_SOURCE_BYTES });
  } catch (e) {
    return adminInternal('presignContacts', e);
  }
};

/** Manifiesto sin el texto del mensaje (para el historial). */
const withoutMessage = (m: UploadManifest): Omit<UploadManifest, 'message'> => {
  const { message: _omit, ...rest } = m;
  return rest;
};

export const listUploads = async (event: AdminEvent): Promise<AdminResult> => {
  const campaign = parseCampaignParam(event.pathParameters?.campaign);
  if (!campaign) return adminError(400, 'Campaña inválida');
  const auth = await requireAdminAccess(event, { permissions: [CONTACTS_UPLOAD, CONTACTS_DISTRIBUTE], campaign });
  if (!auth.ok) return auth.response;
  try {
    const objects: Array<{ key: string; lastModified: number }> = [];
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: `uploads/${campaign}/`, ContinuationToken: token }));
      for (const o of res.Contents ?? []) {
        if (o.Key?.endsWith('.json')) objects.push({ key: o.Key, lastModified: o.LastModified?.getTime() ?? 0 });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    objects.sort((a, b) => b.lastModified - a.lastModified);
    const items: Array<Omit<UploadManifest, 'message'>> = [];
    for (const o of objects.slice(0, HISTORY_LIMIT)) {
      const obj = await getText(o.key);
      if (obj.text === undefined) continue;
      try {
        items.push(withoutMessage(JSON.parse(obj.text) as UploadManifest));
      } catch {
        console.error(JSON.stringify({ evt: 'admin_uploads_list', campaign, unreadable: o.key }));
      }
    }
    items.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return adminOk({ campaign, items });
  } catch (e) {
    return adminInternal('listUploads', e);
  }
};
