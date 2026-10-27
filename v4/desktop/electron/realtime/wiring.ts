// File: Cableado del canal realtime con el poller y la configuración remota (add-realtime-v4-desktop D2/D6/D7).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { POLL_BACKUP_INTERVAL_MS, POLL_INTERVAL_MS } from '../jobs/poller';
import { SETTINGS_BACKUP_REFRESH_MS, SETTINGS_REFRESH_MS } from '../settings/remoteSettings';
import { isUsableUrl, type RealtimeEnvelope, type RealtimeState } from './client';

export interface RealtimeConfig {
  enabled: boolean;
  url: string | null;
  /** Por qué no se conecta (`flag` = ANA_REALTIME=off, `no_url` = sin URL válida). */
  reason?: 'flag' | 'no_url';
}

/**
 * URL del canal: `ANA_REALTIME_URL` del entorno o `realtimeUrl` embebida al
 * compilar (`build-config.json`). Sin URL válida o con `ANA_REALTIME=off`, no
 * hay conexión y el polling queda como hoy.
 */
export function realtimeConfig(
  env: Record<string, string | undefined>,
  build: { realtimeUrl?: unknown } = {},
): RealtimeConfig {
  if ((env.ANA_REALTIME ?? '').trim().toLowerCase() === 'off') return { enabled: false, url: null, reason: 'flag' };
  const url = (env.ANA_REALTIME_URL ?? '').trim() || (typeof build.realtimeUrl === 'string' ? build.realtimeUrl.trim() : '');
  if (!isUsableUrl(url)) return { enabled: false, url: null, reason: 'no_url' };
  return { enabled: true, url };
}

export interface WiringDeps {
  pollNow: () => void;
  pollIntervalChanged: () => void;
  settingsRefreshNow: () => void;
  settingsIntervalChanged: () => void;
  /** Relee `GET /me` del main (permiso de respuesta manual). */
  refreshAccess: () => void | Promise<void>;
  /** Avisa al renderer que vuelva a leer `GET /me` (IPC `access:refresh`). */
  notifyRenderer: (reason: string) => void;
  log?: (msg: string) => void;
}

/**
 * Handlers del `RealtimeClient` y funciones de intervalo para el poller y la
 * configuración: activo → 2 min / 15 min; inactivo → 5 s / 5 min.
 */
export function createRealtimeWiring(deps: WiringDeps) {
  let active = false;
  return {
    isActive: () => active,
    pollIntervalMs: () => (active ? POLL_BACKUP_INTERVAL_MS : POLL_INTERVAL_MS),
    settingsIntervalMs: () => (active ? SETTINGS_BACKUP_REFRESH_MS : SETTINGS_REFRESH_MS),
    onState(s: RealtimeState) {
      const next = s === 'active';
      if (next === active) return;
      active = next;
      deps.log?.(`[realtime] canal ${active ? 'activo: respaldo de jobs 2 min' : 'inactivo: polling de jobs 5 s'}`);
      deps.pollIntervalChanged();
      deps.settingsIntervalChanged();
    },
    /** Lectura al reconectar: jobs y configuración. */
    onConfirmed() {
      deps.pollNow();
      deps.settingsRefreshNow();
    },
    onEvent(e: RealtimeEnvelope) {
      if (e.type === 'jobs.changed') deps.pollNow();
      else if (e.type === 'settings.changed' && e.ref?.scope === 'desktop') deps.settingsRefreshNow();
    },
    /** Actualización forzada: acceso del main y del renderer, jobs y configuración. */
    onRefresh(reason: string) {
      void Promise.resolve(deps.refreshAccess()).catch(() => undefined);
      deps.notifyRenderer(reason);
      deps.pollNow();
      deps.settingsRefreshNow();
    },
  };
}
