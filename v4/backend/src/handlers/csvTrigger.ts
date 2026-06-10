// File: Dispara al subir un CSV a csv-uploads/. Parsea filas y encola un SendJob por
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { S3Event } from 'aws-lambda';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { parse } from 'csv-parse/sync';
import { s3 } from '../lib/s3';
import { ddb } from '../lib/dynamo';
import { JOBS_TABLE, JOB_TTL_DAYS, type SendJob } from '../lib/jobs';
import { getEligibleAgents } from '../lib/dashboard';
import { normalizeContactRow } from '../lib/contacts';

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS = 50_000;

/**
 * `{"op1":2,"op2":1}` → ['op1','op1','op2']: lista expandida para que el
 * round-robin por índice respete los pesos relativos del reparto explícito.
 */
function expandWeights(json: string): string[] {
  try {
    const weights = JSON.parse(json) as Record<string, number>;
    const out: string[] = [];
    for (const [op, w] of Object.entries(weights)) {
      const n = Math.max(0, Math.floor(Number(w)));
      for (let i = 0; i < n; i++) out.push(op);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Dispara al subir un CSV a csv-uploads/. Parsea filas y encola un SendJob por
 * fila en SQS. El agente local los recoge vía /jobs/poll.
 *
 * Config de campaña (template, countryCode, phoneColumn) va en metadata del
 * objeto S3 (x-amz-meta-*), seteada por la UI al pedir el presigned URL.
 */
export const handler = async (event: S3Event): Promise<void> => {
  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));

    // Guarda de tamaño antes de leer/parsear (evita CSV gigante malicioso).
    if ((rec.s3.object.size ?? 0) > MAX_CSV_BYTES) {
      console.warn(`csvTrigger: ${key} excede ${MAX_CSV_BYTES} bytes, ignorado`);
      continue;
    }

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const meta = obj.Metadata ?? {};
    const csv = await obj.Body!.transformToString('utf-8');

    // operatorId viene de la metadata FIRMADA en el presign → confiable.
    const operatorId = meta.operatorid;
    if (!operatorId) {
      console.warn(`csvTrigger: ${key} sin operatorId en metadata, ignorado`);
      continue;
    }
    const template = meta.template ?? '{mensaje}';
    const countryCode = meta.countrycode ?? '52';
    const phoneColumn = meta.phonecolumn ?? 'telefono';
    const campaignId = meta.campaignid ?? key;
    const distribute = meta.distribute === '1';
    const campaign = meta.campaign ?? '';

    // Filas normalizadas con los alias de v3: un CSV con phone_number /
    // total_balance / message funciona con plantillas {telefono}/{saldo}/{mensaje}.
    const rows: Record<string, string>[] = (
      parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[]
    ).map(normalizeContactRow);
    if (rows.length > MAX_ROWS) {
      console.warn(`csvTrigger: ${key} con ${rows.length} filas excede ${MAX_ROWS}, ignorado`);
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
      // Agentes activos elegibles desde la API del dashboard (api-agentes.md).
      const agents = await getEligibleAgents(campaign);
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
      // sparse: el GSI campaign-index no acepta '' como key.
      ...(campaign ? { campaign } : {}),
      phone: phoneOf(row),
      template,
      row,
      countryCode,
      srcKey: key,
      status: 'pending',
      leaseUntil: 0,
      attempts: 0,
      ttl,
    }));

    // DynamoDB BatchWrite = máx 25 por request
    for (let i = 0; i < jobs.length; i += 25) {
      const chunk = jobs.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [JOBS_TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })),
          },
        }),
      );
    }

    console.log(
      `csvTrigger: ${jobs.length} jobs de ${key} → ${targets.length} destinatario(s)` +
        (distribute ? ` (reparto campaña ${campaign})` : ''),
    );
  }
};
