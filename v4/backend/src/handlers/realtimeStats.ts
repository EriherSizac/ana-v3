// File: Programada cada 5 min: ActiveConnections por tipo y cierre de todo con el interruptor apagado.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { CLIENT_TYPES, metric, realtimeEnabled, topicClient } from '../lib/realtime';
import { countTopic, queryTopic, removeConnection } from '../lib/realtimeStore';
import { closeConnection, pool, POST_CONCURRENCY } from '../lib/realtimePush';

/**
 * `ActiveConnections{client}` = `Query Select=COUNT` sobre `k#<client>`
 * (design D11). Con `REALTIME_ENABLED=false` cierra todas las conexiones
 * abiertas (design D10): los clientes vuelven solos a su polling rápido.
 */
export const handler = async (): Promise<{ active: Record<string, number>; closed: number }> => {
  const active: Record<string, number> = {};
  let closed = 0;
  for (const client of CLIENT_TYPES) {
    if (!realtimeEnabled()) {
      const members = await queryTopic(topicClient(client));
      await pool(members, POST_CONCURRENCY, async (m) => {
        await closeConnection(m.connectionId);
        try {
          await removeConnection(m.connectionId);
        } catch {
          // el TTL lo limpia
        }
        closed += 1;
      });
      active[client] = 0;
    } else {
      active[client] = await countTopic(topicClient(client));
    }
    metric('ActiveConnections', active[client], { client });
  }
  if (closed) console.log(JSON.stringify({ evt: 'realtime_disabled_close', closed }));
  return { active, closed };
};
