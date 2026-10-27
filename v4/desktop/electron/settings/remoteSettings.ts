// File: Configuración remota del desktop en el main (v4-add-desktop-remote-settings D4).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { AuthFetch } from '../auth/tokenBroker';

export interface DesktopSettings {
  sendMinGapSeconds: number;
  sendMaxPerWindow: number;
  sendWindowMinutes: number;
  openChatInteraction: boolean;
}

/** Valores por defecto: el ritmo histórico y el registro de apertura apagado. */
export const DEFAULT_SETTINGS: Readonly<DesktopSettings> = {
  sendMinGapSeconds: 120,
  sendMaxPerWindow: 7,
  sendWindowMinutes: 20,
  openChatInteraction: false,
};

/** Lectura periódica sin canal realtime (comportamiento previo). */
export const SETTINGS_REFRESH_MS = 5 * 60 * 1000;
/** Lectura periódica con el canal realtime activo (add-realtime-v4-desktop). */
export const SETTINGS_BACKUP_REFRESH_MS = 15 * 60 * 1000;
/** Ventana de coalescencia de `refreshNow()`. */
export const REFRESH_NOW_COALESCE_MS = 1000;

/** Límites (espejo del catálogo del backend) para no confiar en un valor raro. */
const LIMITS: Record<'sendMinGapSeconds' | 'sendMaxPerWindow' | 'sendWindowMinutes', [number, number]> = {
  sendMinGapSeconds: [60, 600],
  sendMaxPerWindow: [1, 20],
  sendWindowMinutes: [5, 60],
};

/** Valores leídos sobre los por defecto; lo inválido se ignora llave por llave. */
export function sanitizeSettings(values: unknown): DesktopSettings {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const out: DesktopSettings = { ...DEFAULT_SETTINGS };
  for (const [k, [min, max]] of Object.entries(LIMITS) as [keyof typeof LIMITS, [number, number]][]) {
    const n = v[k];
    if (typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max) out[k] = n;
  }
  if (typeof v.openChatInteraction === 'boolean') out.openChatInteraction = v.openChatInteraction;
  return out;
}

/** Ritmo en milisegundos para el poller. */
export const paceOf = (s: DesktopSettings) => ({
  minGapMs: s.sendMinGapSeconds * 1000,
  windowMs: s.sendWindowMinutes * 60 * 1000,
  maxPerWindow: s.sendMaxPerWindow,
});

export interface RemoteSettingsDeps {
  apiBase: string;
  hasSession: () => boolean;
  authFetch: AuthFetch;
  onChange?: (s: DesktopSettings) => void;
  /** Intervalo vigente (5 min sin canal, 15 min con canal activo); se lee en cada ciclo. */
  intervalMs?: () => number;
}

/**
 * Lee `GET /settings` tras iniciar sesión y cada 5 minutos. Conserva el último
 * valor leído; mientras nunca se haya leído, usa los por defecto. Un error de
 * lectura no cambia nada (se reintenta en el siguiente ciclo).
 */
export class RemoteSettings {
  private current: DesktopSettings = { ...DEFAULT_SETTINGS };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private lastRefreshAt = 0;
  private coalesce: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: RemoteSettingsDeps) {}

  get(): DesktopSettings {
    return this.current;
  }

  /** Lee ahora; true si obtuvo valores. */
  async refresh(): Promise<boolean> {
    if (!this.deps.hasSession()) return false;
    try {
      this.lastRefreshAt = Date.now();
      const res = await this.deps.authFetch(`${this.deps.apiBase}/settings`);
      if (!res.ok) return false;
      const body = (await res.json()) as { values?: unknown };
      const next = sanitizeSettings(body.values);
      const changed = JSON.stringify(next) !== JSON.stringify(this.current);
      this.current = next;
      if (changed) this.deps.onChange?.(next);
      return true;
    } catch {
      return false;
    }
  }

  private interval(): number {
    return this.deps.intervalMs?.() ?? SETTINGS_REFRESH_MS;
  }

  /** Agenda la siguiente lectura periódica según el intervalo vigente. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, this.lastRefreshAt + this.interval() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh().finally(() => {
        if (this.started) this.schedule();
      });
    }, wait);
  }

  /** Lectura inmediata y luego cada intervalo vigente (idempotente). */
  start(): void {
    void this.refresh();
    if (this.started) return;
    this.started = true;
    this.lastRefreshAt = Date.now();
    this.schedule();
  }

  /** Lectura en máximo 1 s (agrupa las llamadas de ese segundo) y reinicia el ciclo. */
  refreshNow(): void {
    if (this.coalesce) return;
    this.coalesce = setTimeout(() => {
      this.coalesce = null;
      void this.refresh().finally(() => {
        if (this.started) this.schedule();
      });
    }, REFRESH_NOW_COALESCE_MS);
  }

  /** El intervalo cambió (canal activo/inactivo): reagenda desde la última lectura. */
  intervalChanged(): void {
    if (this.started) this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.coalesce) clearTimeout(this.coalesce);
    this.timer = null;
    this.coalesce = null;
    this.started = false;
  }
}
