// File: Reparto realtime (add-realtime-gateway D5/D7/D12): eventos v4, puente S3 de v3 y actualizaciones forzadas.
// Created: 2026-10-26
// Updated: 2026-10-29
// Author: Erick Hernández Silva

import { randomUUID } from 'node:crypto';
import {
  DETAIL_EVENT,
  DETAIL_FORCE,
  EVENT_SOURCE,
  REFRESH_EVENT,
  buildEnvelope,
  eventTopics,
  forceTopics,
  metric,
  realtimeEnabled,
  validateEmit,
  validateForce,
  type ForceRequest,
  type RealtimeEmit,
} from '../lib/realtime';
import { queryTopics } from '../lib/realtimeStore';
import { deliver, forceClose } from '../lib/realtimePush';
import { DEFAULT_DESKTOP_UPDATES_BUCKET, changeOf, translateDesktopRelease, translateS3 } from '../lib/realtimeBridge';

/** Un aviso con más de 60 s ya no vale nada (design D5). */
export const MAX_EVENT_AGE_MS = 60_000;

interface BusEvent {
  id?: string;
  source?: string;
  'detail-type'?: string;
  time?: string;
  detail?: any;
}

const eventTime = (e: BusEvent, now: number) => {
  const t = e.time ? Date.parse(e.time) : NaN;
  return Number.isFinite(t) ? t : now;
};

/** Entrega un evento del catálogo a sus temas. */
export async function dispatchEvent(evt: RealtimeEmit, id: string, at: number): Promise<number> {
  const err = validateEmit(evt);
  if (err) {
    console.error(JSON.stringify({ evt: 'realtime_event_invalid', type: evt?.type ?? null, error: err }));
    return 0;
  }
  const members = await queryTopics(eventTopics(evt));
  const envelope = buildEnvelope(evt.type, { id, at, campaign: evt.campaign, ref: evt.ref });
  const stats = await deliver(members, envelope);
  metric('EventsEmitted', 1, { type: evt.type });
  console.log(
    JSON.stringify({ evt: 'realtime_dispatch', type: evt.type, campaign: envelope.campaign ?? null, targets: members.length, ...stats }),
  );
  return members.length;
}

/** Ejecuta una actualización forzada: `session.refresh` + cierre (design D12). */
export async function dispatchForce(f: ForceRequest, id: string, at: number): Promise<number> {
  const err = validateForce(f);
  if (err) {
    console.error(JSON.stringify({ evt: 'realtime_force_invalid', error: err }));
    return 0;
  }
  const members = await queryTopics(forceTopics(f.target));
  const envelope = buildEnvelope(REFRESH_EVENT, { id, at, ref: { reason: f.reason } });
  const closed = await forceClose(members, envelope);
  console.log(
    JSON.stringify({
      evt: 'realtime_force',
      reason: f.reason,
      target: f.target.kind,
      by: f.by ?? null,
      targets: members.length,
      closed,
    }),
  );
  return closed;
}

/** Evento S3 reenviado desde us-east-1 (design D7). */
async function bridge(e: BusEvent, at: number): Promise<void> {
  const bucket = e.detail?.bucket?.name;
  const change = changeOf(e['detail-type']);
  const key = e.detail?.object?.key;
  if (!change || typeof key !== 'string') return;
  // Bucket de updates del desktop (regla AnaDesktopReleaseRule, add-in-session-updates D8).
  const desktopBucket = process.env.DESKTOP_UPDATES_BUCKET || DEFAULT_DESKTOP_UPDATES_BUCKET;
  if (bucket === desktopBucket) {
    const d = translateDesktopRelease(key, change);
    if (d?.emit) await dispatchEvent(d.emit, e.id ?? randomUUID(), at);
    return;
  }
  const v3Bucket = process.env.V3_BUCKET;
  if (v3Bucket && bucket !== v3Bucket) return;
  const r = translateS3(key, change);
  if (!r) return;
  if (r.skipped) {
    // Solo la forma de la llave (sin el contenido); los segmentos ya son ids.
    console.log(JSON.stringify({ evt: 'realtime_bridge_skipped', change }));
    metric('BridgeSkipped');
    return;
  }
  const id = e.id ?? randomUUID();
  if (r.emit) await dispatchEvent(r.emit, id, at);
  if (r.force) await dispatchForce(r.force, `${id}-refresh`, at);
}

/**
 * Regla `source: ana.v4` (eventos y actualizaciones forzadas de los handlers)
 * y regla `source: aws.s3` (puente de v3). Con `realtimeEnabled=false` descarta.
 */
export const handler = async (event: BusEvent): Promise<void> => {
  if (!realtimeEnabled()) {
    metric('EventsDropped', 1, { reason: 'disabled' });
    return;
  }
  const now = Date.now();
  const at = eventTime(event, now);
  if (now - at > MAX_EVENT_AGE_MS) {
    metric('EventsDropped', 1, { reason: 'stale' });
    return;
  }
  if (event.source === EVENT_SOURCE) {
    const id = event.id ?? randomUUID();
    if (event['detail-type'] === DETAIL_EVENT) await dispatchEvent(event.detail as RealtimeEmit, id, at);
    else if (event['detail-type'] === DETAIL_FORCE) await dispatchForce(event.detail as ForceRequest, id, at);
    return;
  }
  if (event.source === 'aws.s3') await bridge(event, at);
};
