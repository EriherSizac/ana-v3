// File: Configuración del canal realtime en el navegador (add-realtime-admin-web). Solo NEXT_PUBLIC_*.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { isUsableUrl } from './client';

export interface RealtimeClientConfig {
  enabled: boolean;
  url: string | null;
  version: string;
}

/**
 * `NEXT_PUBLIC_REALTIME_URL` (URL execute-api `RealtimeWsUrl`, sin dominio
 * propio) y `NEXT_PUBLIC_REALTIME_ENABLED` (`false` apaga el canal). Sin URL
 * válida no hay conexión: la consola se comporta como con el canal inactivo.
 * No vive en `src/server/env.ts` (solo servidor): Next las incrusta en el bundle.
 */
export function realtimeClientConfig(
  env: { url?: string; enabled?: string; version?: string } = {
    url: process.env.NEXT_PUBLIC_REALTIME_URL,
    enabled: process.env.NEXT_PUBLIC_REALTIME_ENABLED,
    version: process.env.NEXT_PUBLIC_APP_VERSION,
  },
): RealtimeClientConfig {
  const url = (env.url ?? '').trim();
  const off = (env.enabled ?? '').trim().toLowerCase() === 'false';
  const version = (env.version ?? '').trim() || 'web';
  if (off || !isUsableUrl(url)) return { enabled: false, url: null, version };
  return { enabled: true, url, version };
}
