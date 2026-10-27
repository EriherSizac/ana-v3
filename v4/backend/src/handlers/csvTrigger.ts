// File: Dispara al subir un CSV a csv-uploads/. Parsea filas y encola un SendJob por
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { S3Event } from 'aws-lambda';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { parse } from 'csv-parse/sync';
import { s3 } from '../lib/s3';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, JOB_TTL_DAYS, type SendJob } from '../lib/jobs';
import { getDistributableAgents } from '../lib/distribution';
import { normalizeContactRow } from '../lib/contacts';
import { fileNameFromKey, recordUpload, type RejectReason, type UploadRecord } from '../lib/uploads';
import { canonicalOperatorId, resolveCatalogCampaign } from '../lib/identity';
import { emitRealtime } from '../lib/realtime';

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS = 50_000;
/** Reintentos de UnprocessedItems por lote (design D6). */
export const BATCH_RETRIES = 6;
const BATCH_BASE_DELAY_MS = 100;

/** Espera inyectable (las pruebas la reemplazan para no dormir de verdad). */
export const timing = {
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

/**
 * `{"op1":2,"op2":1}` → ['op1','op1','op2']: lista expandida para que el
 * round-robin por índice respete los pesos relativos del reparto explícito.
 * Destinatarios canónicos; los repetidos tras canonizar suman sus pesos.
 */
export function expandWeights(json: string): string[] {
  try {
    const weights = JSON.parse(json) as Record<string, number>;
    const merged = new Map<string, number>();
    for (const [raw, w] of Object.entries(weights)) {
      const op = canonicalOperatorId(raw);
      const n = Math.max(0, Math.floor(Number(w)));
      if (op && n > 0) merged.set(op, (merged.get(op) ?? 0) + n);
    }
    const out: string[] = [];
    for (const [op, n] of merged) for (let i = 0; i < n; i++) out.push(op);
    return out;
  } catch {
    return [];
  }
}

/** ISO de la fecha del objeto S3 (LastModified), con fallback a la del evento. */
function objectDate(lastModified: Date | undefined, eventTime: string | undefined): string {
  const d = lastModified ?? (eventTime ? new Date(eventTime) : new Date());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Historial de cargas (add-contact-upload-console D7). Un fallo al registrar
 * NO debe romper la creación de jobs: se registra en el log y se sigue.
 */
async function safeRecord(rec: UploadRecord): Promise<void> {
  try {
    await recordUpload(rec);
    // Aviso realtime a la campaña (add-realtime-gateway); nunca lanza.
    await emitRealtime({ type: 'uploads.changed', campaign: rec.campaign, ref: { srcKey: rec.srcKey, uploadId: rec.srcKey } });
  } catch (e) {
    console.error(
      JSON.stringify({
        evt: 'upload_history',
        status: 'failed',
        campaign: rec.campaign,
        srcKey: rec.srcKey,
        error: (e as Error)?.name,
      }),
    );
  }
}

/** Registro de una carga rechazada (solo si la metadata trae campaña). */
async function recordRejected(
  key: string,
  meta: Record<string, string>,
  uploadedAt: string,
  reason: RejectReason,
  totalRows: number | null = null,
): Promise<void> {
  if (!meta.campaign) return;
  await safeRecord({
    campaign: meta.campaign,
    srcKey: key,
    fileName: fileNameFromKey(key),
    uploadedBy: meta.operatorid ?? null,
    uploadedAt,
    mode: meta.assignments ? 'assignments' : meta.distribute === '1' ? 'distribute' : 'self',
    totalRows,
    validRows: null,
    jobs: 0,
    perAgent: {},
    status: 'rejected',
    reason,
  });
}

/**
 * Procesamiento único por objeto (D6): reserva condicional del marcador
 * `UPLOAD#<srcKey>`. false = ya se procesó (evento S3 duplicado).
 */
async function claimUpload(srcKey: string): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: JOBS_TABLE,
        Item: {
          operatorId: `UPLOAD#${srcKey}`,
          jobId: 'processed',
          at: Date.now(),
          ttl: Math.floor(Date.now() / 1000) + JOB_TTL_DAYS * 86400,
        },
        ConditionExpression: 'attribute_not_exists(jobId)',
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/**
 * Escribe los jobs en lotes de 25 reintentando `UnprocessedItems` hasta
 * BATCH_RETRIES veces (espera 100 ms × 2^n con jitter). Devuelve los que no
 * se pudieron escribir (no lanza: S3 reintentaría y re-escribiría).
 */
async function writeJobs(jobs: SendJob[]): Promise<SendJob[]> {
  const failed: SendJob[] = [];
  for (let i = 0; i < jobs.length; i += 25) {
    let pending: Record<string, any>[] = jobs.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending.length > 0 && attempt <= BATCH_RETRIES; attempt++) {
      if (attempt > 0) {
        const base = BATCH_BASE_DELAY_MS * 2 ** (attempt - 1);
        await timing.sleep(base + Math.floor(Math.random() * base));
      }
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [JOBS_TABLE]: pending } }));
      pending = (res.UnprocessedItems?.[JOBS_TABLE] ?? []) as Record<string, any>[];
    }
    for (const r of pending) failed.push(r.PutRequest.Item as SendJob);
  }
  return failed;
}

const isNoSuchKey = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
};

/**
 * Dispara al subir un CSV a csv-uploads/. Parsea filas y escribe un SendJob
 * por fila en la tabla de jobs. El agente local los recoge vía /jobs/poll.
 *
 * Config de campaña (template, countryCode, phoneColumn, campaignid generado
 * por el servidor, label del cliente) va en metadata del objeto S3
 * (x-amz-meta-*), firmada al pedir el presigned URL.
 */
export const handler = async (event: S3Event): Promise<void> => {
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));

    // Guarda de tamaño antes de leer/parsear (evita CSV gigante malicioso).
    if ((rec.s3.object.size ?? 0) > MAX_CSV_BYTES) {
      console.warn(`csvTrigger: ${key} excede ${MAX_CSV_BYTES} bytes, ignorado`);
      // Sin leer el cuerpo: solo metadata (campaña/operador) para el historial.
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        await recordRejected(key, head.Metadata ?? {}, objectDate(head.LastModified, rec.eventTime), 'too_large');
      } catch (e) {
        console.error(JSON.stringify({ evt: 'upload_history', status: 'failed', srcKey: key, error: (e as Error)?.name }));
      }
      continue;
    }

    let obj;
    try {
      obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      // Evento repetido de un CSV ya procesado y borrado (D8): nada que hacer.
      if (isNoSuchKey(e)) {
        log({ evt: 'csv_missing_object', key });
        continue;
      }
      throw e;
    }
    const meta = obj.Metadata ?? {};
    const csv = await obj.Body!.transformToString('utf-8');
    const uploadedAt = objectDate(obj.LastModified, rec.eventTime);

    // operatorId viene de la metadata FIRMADA en el presign → confiable.
    const operatorId = canonicalOperatorId(meta.operatorid);
    if (!operatorId) {
      console.warn(`csvTrigger: ${key} sin operatorId en metadata, ignorado`);
      await recordRejected(key, meta, uploadedAt, 'missing_operator');
      continue;
    }
    const template = meta.template ?? '{mensaje}';
    const countryCode = meta.countrycode ?? '52';
    const phoneColumn = meta.phonecolumn ?? 'telefono';
    // Identificador de carga del servidor (D5); objetos sin él → la key sin prefijo.
    const campaignId = meta.campaignid || key.replace(/^csv-uploads\//, '');
    const label = meta.label || undefined;
    const distribute = meta.distribute === '1';
    // Grafía del catálogo (presigns viejos pudieron firmar otra).
    const campaign = meta.campaign ? await resolveCatalogCampaign(meta.campaign) : '';

    // Filas normalizadas con los alias de v3: un CSV con phone_number /
    // total_balance / message funciona con plantillas {telefono}/{saldo}/{mensaje}.
    let rows: Record<string, string>[];
    try {
      rows = (
        parse(csv, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as Record<string, string>[]
      ).map(normalizeContactRow);
    } catch (e) {
      // CSV ilegible: se registra y se termina sin lanzar (S3 no reintenta).
      log({ evt: 'csv_rejected', reason: 'parse_error', key, error: (e as Error)?.message?.slice(0, 200) });
      continue;
    }
    if (rows.length > MAX_ROWS) {
      console.warn(`csvTrigger: ${key} con ${rows.length} filas excede ${MAX_ROWS}, ignorado`);
      await recordRejected(key, meta, uploadedAt, 'too_many_rows', rows.length);
      continue;
    }

    // Procesamiento único: un evento S3 duplicado no re-escribe (ni revive) jobs.
    if (!(await claimUpload(key))) {
      log({ evt: 'csv_duplicate_event', key });
      continue;
    }

    // Destinatarios de los jobs: el propio uploader, reparto explícito por
    // pesos (meta.assignments, firmada en el presign), o round-robin entre los
    // agentes activos de la campaña (si distribute + hay agentes).
    let targets = [operatorId];
    if (meta.assignments) {
      targets = expandWeights(meta.assignments);
      if (targets.length === 0) {
        console.warn(`csvTrigger: assignments inválido en ${key}, jobs al uploader`);
        targets = [operatorId];
      }
    } else if (distribute) {
      // Agentes activos elegibles desde la API del dashboard (api-agentes.md);
      // con AGENT_ROSTER_FILTER, además habilitados (lista derivada − enabled:false).
      const agents = await getDistributableAgents(campaign);
      if (agents.length > 0) targets = agents;
      else console.warn(`csvTrigger: sin agentes elegibles en ${campaign}, jobs al uploader`);
    }

    const ttl = Math.floor(Date.now() / 1000) + JOB_TTL_DAYS * 86400;
    // Teléfono: la columna configurada, con fallback al alias normalizado
    // (CSV de v3 con phone_number aunque la config diga 'telefono').
    const phoneOf = (r: Record<string, string>) => r[phoneColumn] || r.phone || '';
    const valid = rows.filter((r) => phoneOf(r));
    const jobs: SendJob[] = valid.map((row, i) => ({
      operatorId: targets[i % targets.length], // round-robin
      jobId: `${campaignId}#${i}`,
      campaignId,
      ...(label ? { label } : {}),
      // sparse: el GSI por campaña no acepta '' como key.
      ...(campaign ? { campaign } : {}),
      phone: phoneOf(row),
      template,
      row,
      countryCode,
      srcKey: key,
      status: 'pending',
      attempts: 0,
      ttl,
    }));

    const failed = await writeJobs(jobs);
    const failedIds = new Set(failed.map((j) => `${j.operatorId}|${j.jobId}`));
    const written = jobs.filter((j) => !failedIds.has(`${j.operatorId}|${j.jobId}`));

    if (failed.length > 0) {
      // Se conserva el CSV para diagnóstico (expira a los 7 días).
      log({ evt: 'csv_jobs_partial', key, written: written.length, missing: failed.length });
    } else {
      // Los jobs llevan la fila completa: el CSV ya no se necesita (D8).
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (e) {
        console.error(JSON.stringify({ evt: 'csv_delete_failed', key, error: (e as Error)?.name }));
      }
    }

    // Aviso realtime a cada destinatario con jobs nuevos (add-realtime-gateway); nunca lanza.
    const recipients = [...new Set(written.map((j) => j.operatorId))];
    if (recipients.length > 0) {
      await emitRealtime({ type: 'jobs.changed', users: recipients, ...(campaign ? { campaign } : {}) });
    }

    if (campaign) {
      const perAgent: Record<string, number> = {};
      for (const j of written) perAgent[j.operatorId] = (perAgent[j.operatorId] ?? 0) + 1;
      await safeRecord({
        campaign,
        srcKey: key,
        fileName: fileNameFromKey(key),
        uploadedBy: operatorId,
        uploadedAt,
        mode: meta.assignments ? 'assignments' : distribute ? 'distribute' : 'self',
        totalRows: rows.length,
        validRows: valid.length,
        jobs: written.length,
        perAgent,
        status: 'processed',
      });
    }

    console.log(
      `csvTrigger: ${written.length}/${jobs.length} jobs de ${key} → ${targets.length} destinatario(s)` +
        (distribute ? ` (reparto campaña ${campaign})` : ''),
    );
  }
};
