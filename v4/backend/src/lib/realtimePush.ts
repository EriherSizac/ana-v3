// File: Envío a conexiones WebSocket (PostToConnection/DeleteConnection) con limpieza de 410.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { metric, type Envelope } from './realtime';
import { removeConnection, type TopicMember } from './realtimeStore';

/** Concurrencia de envíos dentro de una invocación (design D5; ~300 conexiones en 1–2 s). */
export const POST_CONCURRENCY = 25;
/** Gracia tras el vencimiento del token antes de dejar de entregar y cerrar (design D8). */
export const TOKEN_GRACE_MS = 5 * 60 * 1000;

const clients = new Map<string, ApiGatewayManagementApiClient>();

/** Endpoint de la API de administración: el del evento o `REALTIME_MGMT_ENDPOINT`. */
export function managementClient(endpoint = process.env.REALTIME_MGMT_ENDPOINT ?? ''): ApiGatewayManagementApiClient {
  let c = clients.get(endpoint);
  if (!c) {
    c = new ApiGatewayManagementApiClient({ endpoint });
    clients.set(endpoint, c);
  }
  return c;
}

/** Solo pruebas. */
export function resetManagementClientsForTests(): void {
  clients.clear();
}

const isGone = (e: unknown) => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'GoneException' || err?.$metadata?.httpStatusCode === 410;
};

/** Envía un mensaje a una conexión. 'gone' si ya no existe (410). */
export async function postTo(
  connectionId: string,
  data: unknown,
  api: ApiGatewayManagementApiClient = managementClient(),
): Promise<'ok' | 'gone' | 'failed'> {
  try {
    await api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(data)) }));
    return 'ok';
  } catch (e) {
    if (isGone(e)) return 'gone';
    console.error(JSON.stringify({ evt: 'realtime_post_failed', connectionId, error: (e as Error)?.name ?? 'error' }));
    return 'failed';
  }
}

/** Cierra una conexión (idempotente: 410 cuenta como cerrada). */
export async function closeConnection(connectionId: string, api: ApiGatewayManagementApiClient = managementClient()): Promise<boolean> {
  try {
    await api.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
    return true;
  } catch (e) {
    if (isGone(e)) return true;
    console.error(JSON.stringify({ evt: 'realtime_close_failed', connectionId, error: (e as Error)?.name ?? 'error' }));
    return false;
  }
}

/** Pool simple de concurrencia acotada. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const safeRemove = async (id: string) => {
  try {
    await removeConnection(id);
  } catch (e) {
    console.error(JSON.stringify({ evt: 'realtime_remove_failed', connectionId: id, error: (e as Error)?.name ?? 'error' }));
  }
};

export interface DeliveryStats {
  ok: number;
  gone: number;
  failed: number;
  expired: number;
}

/**
 * Entrega un sobre a las conexiones (a lo más una vez, sin orden): 410 borra el
 * registro; token vencido hace > 5 min no recibe y se cierra (design D8).
 */
export async function deliver(
  members: TopicMember[],
  envelope: Envelope,
  opts: { api?: ApiGatewayManagementApiClient; now?: number } = {},
): Promise<DeliveryStats> {
  const api = opts.api ?? managementClient();
  const now = opts.now ?? Date.now();
  const stats: DeliveryStats = { ok: 0, gone: 0, failed: 0, expired: 0 };
  await pool(members, POST_CONCURRENCY, async (m) => {
    if (typeof m.tokenExp === 'number' && m.tokenExp > 0 && now - m.tokenExp > TOKEN_GRACE_MS) {
      stats.expired += 1;
      await closeConnection(m.connectionId, api);
      await safeRemove(m.connectionId);
      return;
    }
    const r = await postTo(m.connectionId, envelope, api);
    if (r === 'gone') {
      stats.gone += 1;
      await safeRemove(m.connectionId);
    } else if (r === 'ok') stats.ok += 1;
    else stats.failed += 1;
  });
  if (stats.ok) metric('PostOk', stats.ok);
  if (stats.gone) metric('PostGone', stats.gone);
  if (stats.failed) metric('PostFailed', stats.failed);
  if (stats.expired) metric('TokenExpiredClosed', stats.expired);
  return stats;
}

/**
 * Actualización forzada (design D12): `session.refresh` y cierre de cada
 * conexión. El `$disconnect` posterior limpia el registro.
 */
export async function forceClose(
  members: TopicMember[],
  envelope: Envelope,
  opts: { api?: ApiGatewayManagementApiClient } = {},
): Promise<number> {
  const api = opts.api ?? managementClient();
  let closed = 0;
  await pool(members, POST_CONCURRENCY, async (m) => {
    const r = await postTo(m.connectionId, envelope, api);
    if (r === 'gone') {
      await safeRemove(m.connectionId);
      return;
    }
    if (await closeConnection(m.connectionId, api)) closed += 1;
  });
  if (closed) metric('ForcedClosed', closed, { reason: envelope.ref?.reason ?? 'unknown' });
  return closed;
}
