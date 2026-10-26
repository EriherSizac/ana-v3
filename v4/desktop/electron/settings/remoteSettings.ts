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

export const SETTINGS_REFRESH_MS = 5 * 60 * 1000;

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
}

/**
 * Lee `GET /settings` tras iniciar sesión y cada 5 minutos. Conserva el último
 * valor leído; mientras nunca se haya leído, usa los por defecto. Un error de
 * lectura no cambia nada (se reintenta en el siguiente ciclo).
 */
export class RemoteSettings {
  private current: DesktopSettings = { ...DEFAULT_SETTINGS };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: RemoteSettingsDeps) {}

  get(): DesktopSettings {
    return this.current;
  }

  /** Lee ahora; true si obtuvo valores. */
  async refresh(): Promise<boolean> {
    if (!this.deps.hasSession()) return false;
    try {
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

  /** Lectura inmediata y luego cada SETTINGS_REFRESH_MS (idempotente). */
  start(): void {
    void this.refresh();
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), SETTINGS_REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
