// File: Historial de cargas CSV procesadas por csvTrigger (add-contact-upload-console D7).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './dynamo';

export const UPLOADS_TABLE = process.env.UPLOADS_TABLE!;
export const UPLOAD_TTL_DAYS = 180;
export const HISTORY_LIMIT = 50;

export type UploadMode = 'self' | 'distribute' | 'assignments';
export type UploadStatus = 'processed' | 'rejected';
export type RejectReason = 'too_large' | 'too_many_rows' | 'missing_operator';

/** Registro de una carga (PK campaign, SK srcKey → idempotente por objeto). */
export interface UploadRecord {
  campaign: string;
  srcKey: string;
  fileName: string;
  uploadedBy: string | null;
  uploadedAt: string; // ISO, fecha del objeto S3
  mode: UploadMode | null;
  totalRows: number | null;
  validRows: number | null;
  jobs: number;
  perAgent: Record<string, number>;
  status: UploadStatus;
  reason?: RejectReason;
}

/**
 * Nombre original del archivo a partir del srcKey del presign
 * (`csv-uploads/<user>/<epochMs>_<filename>`).
 */
export function fileNameFromKey(srcKey: string): string {
  const base = srcKey.split('/').pop() ?? srcKey;
  return base.replace(/^\d+_/, '');
}

/** Guarda (o reemplaza) el registro de una carga. TTL 180 días. */
export async function recordUpload(rec: UploadRecord): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + UPLOAD_TTL_DAYS * 86400;
  await ddb.send(new PutCommand({ TableName: UPLOADS_TABLE, Item: { ...rec, ttl } }));
}

/** Quita atributos internos del ítem de DynamoDB. */
function toRecord(item: Record<string, any>): UploadRecord {
  const { ttl: _ttl, ...rest } = item;
  return rest as UploadRecord;
}

/**
 * Las 50 cargas más recientes de la campaña (uploadedAt desc), o solo la de
 * `srcKey` (vacío si aún no se procesó).
 */
export async function listUploads(campaign: string, opts: { srcKey?: string } = {}): Promise<UploadRecord[]> {
  const items: Record<string, any>[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: UPLOADS_TABLE,
        KeyConditionExpression: opts.srcKey ? 'campaign = :c AND srcKey = :k' : 'campaign = :c',
        ExpressionAttributeValues: opts.srcKey ? { ':c': campaign, ':k': opts.srcKey } : { ':c': campaign },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((out.Items ?? []) as Record<string, any>[]));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items
    .map(toRecord)
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
    .slice(0, HISTORY_LIMIT);
}
