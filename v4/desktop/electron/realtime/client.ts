// File: Cliente del canal realtime de ANA (add-realtime-v4-desktop D2): conexión, latido, backoff y refresco forzado.
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * Contrato común del canal (add-realtime-gateway D8/D9/D12):
 *  - subprotocolo `ana.v1, <ID token>` y `?client=<tipo>&v=<versión>`;
 *  - `ping` al abrir y cada 5 min; activo tras el primer `pong`; sin `pong`
 *    en 30 s → inactivo, cierre y reconexión;
 *  - backoff exponencial con jitter 1 s → 5 min (15 min tras 403 o 5 fallos);
 *  - reconexión planeada a los 110 min o con token nuevo, abriendo la nueva
 *    conexión antes de cerrar la anterior (make-before-break);
 *  - `session.refresh` → cierre 4001, `onRefresh(reason)` y reconexión tras
 *    0–10 s sin crecer el backoff.
 * Nunca escribe el token en logs.
 */

export const SUBPROTOCOL = 'ana.v1';
export const PING_INTERVAL_MS = 5 * 60 * 1000;
export const PONG_TIMEOUT_MS = 30_000;
export const MAX_CONNECTION_MS = 110 * 60 * 1000;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
export const BACKOFF_MAX_REJECTED_MS = 15 * 60 * 1000;
export const REJECTIONS_FOR_LONG_BACKOFF = 5;
export const REFRESH_RECONNECT_MAX_MS = 10_000;
export const REFRESH_CLOSE_CODE = 4001;

/** Tipos del catálogo v1 que entiende el cliente (otros se ignoran). */
export const KNOWN_EVENTS = [
  'jobs.changed',
  'assignment.pending',
  'assignment.published',
  'publications.changed',
  'uploads.changed',
  'review.changed',
  'roster.changed',
  'settings.changed',
] as const;
export type KnownEvent = (typeof KNOWN_EVENTS)[number];

export interface RealtimeEnvelope {
  v: 1;
  type: KnownEvent;
  id: string;
  at: number;
  campaign?: string;
  ref?: Record<string, string>;
}

/** Mínimo de WebSocket que usa el cliente (navegador, undici o adaptador de `ws`). */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string; status?: number }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export type SocketFactory = (url: string, protocols: string[]) => WsLike;

export interface TimerApi {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

export type RealtimeState = 'active' | 'inactive';

export interface RealtimeClientOptions {
  url: string;
  client: 'desktop' | 'cli' | 'admin';
  version: string;
  /** ID token vigente (renovado si hace falta) o null sin sesión. */
  getToken: () => Promise<string | null>;
  createSocket: SocketFactory;
  timers?: TimerApi;
  random?: () => number;
  logger?: Pick<Console, 'log' | 'warn'>;
  onState?: (s: RealtimeState) => void;
  /** Cada vez que una conexión queda confirmada (primer `pong`). */
  onConfirmed?: () => void;
  onEvent?: (e: RealtimeEnvelope) => void;
  onRefresh?: (reason: string) => void;
}

interface Conn {
  ws: WsLike;
  token: string;
  confirmed: boolean;
  dead: boolean;
  pingTimer: unknown;
  pongTimer: unknown;
  maxTimer: unknown;
}

/** Sobre válido del catálogo, o null (JSON inválido, `v` distinto o tipo desconocido). */
export function parseEnvelope(raw: unknown): RealtimeEnvelope | { type: 'pong' } | { type: 'session.refresh'; reason: string } | null {
  let msg: { type?: unknown; v?: unknown; ref?: { reason?: unknown } } | null;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'pong') return { type: 'pong' };
  if (msg.v !== 1) return null;
  if (msg.type === 'session.refresh') return { type: 'session.refresh', reason: String(msg.ref?.reason ?? 'unknown') };
  if (typeof msg.type !== 'string' || !(KNOWN_EVENTS as readonly string[]).includes(msg.type)) return null;
  return msg as unknown as RealtimeEnvelope;
}

/** URL de conexión con `client` y `v` (sin token). */
export function connectUrl(base: string, client: string, version: string): string {
  const u = new URL(base);
  u.searchParams.set('client', client);
  u.searchParams.set('v', version);
  return u.toString();
}

/** ¿URL `wss://` (o `ws://` local) utilizable? */
export function isUsableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' || (u.protocol === 'ws:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

export class RealtimeClient {
  private current: Conn | null = null;
  private next: Conn | null = null;
  private running = false;
  private paused = false;
  private active = false;
  private failures = 0;
  private rejected = false;
  private refreshing = false;
  private reconnectTimer: unknown = null;
  private connecting = false;
  private readonly timers: TimerApi;
  private readonly random: () => number;
  private readonly logger: Pick<Console, 'log' | 'warn'>;

  constructor(private readonly opts: RealtimeClientOptions) {
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.random = opts.random ?? Math.random;
    this.logger = opts.logger ?? console;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Abre la conexión (idempotente). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    void this.connect();
  }

  /** Cierra todo y no reconecta (logout, salida). */
  stop(): void {
    this.running = false;
    this.clearReconnect();
    this.dispose(this.next, 1000, 'stop');
    this.dispose(this.current, 1000, 'stop');
    this.next = null;
    this.current = null;
    this.setActive(false);
  }

  /** Cierra sin dejar de estar iniciado (pestaña oculta); `resume()` reconecta. */
  pause(): void {
    if (!this.running) return;
    this.paused = true;
    this.clearReconnect();
    this.dispose(this.next, 1000, 'paused');
    this.dispose(this.current, 1000, 'paused');
    this.next = null;
    this.current = null;
    this.setActive(false);
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.failures = 0;
    void this.connect();
  }

  /**
   * Reconexión planeada (token nuevo o 110 min): abre otra conexión y cierra la
   * actual tras su `pong`. Sin `force`, solo si el token cambió.
   */
  async renew(force = false): Promise<void> {
    if (!this.running || this.paused || this.next) return;
    const cur = this.current;
    if (!cur || !cur.confirmed) return;
    const token = await this.safeToken();
    if (!token || (!force && token === cur.token)) return;
    if (!this.running || this.next || this.current !== cur) return;
    this.next = this.open(token);
  }

  // ---------- internos ----------

  private async safeToken(): Promise<string | null> {
    try {
      return await this.opts.getToken();
    } catch {
      return null;
    }
  }

  private setActive(v: boolean) {
    if (this.active === v) return;
    this.active = v;
    this.opts.onState?.(v ? 'active' : 'inactive');
  }

  private clearReconnect() {
    if (this.reconnectTimer) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private schedule(ms: number) {
    this.clearReconnect();
    if (!this.running || this.paused) return;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, ms);
  }

  /** Espera de backoff para el fallo número `failures` (≥ 1), con jitter. */
  backoffMs(): number {
    return this.backoffMsFor(this.failures);
  }

  /** Espera para `failures` fallos seguidos: 1 s × 2^(n-1), tope 5 min (15 min tras 403 o 5 fallos). */
  backoffMsFor(failures: number): number {
    const cap = this.rejected || failures >= REJECTIONS_FOR_LONG_BACKOFF ? BACKOFF_MAX_REJECTED_MS : BACKOFF_MAX_MS;
    const base = Math.min(cap, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
    return Math.round(base / 2 + (this.random() * base) / 2);
  }

  private async connect(): Promise<void> {
    if (!this.running || this.paused || this.current || this.connecting) return;
    this.connecting = true;
    try {
      const token = await this.safeToken();
      if (!this.running || this.paused || this.current) return;
      if (!token) {
        this.failures += 1;
        this.schedule(this.backoffMs());
        return;
      }
      this.current = this.open(token);
    } finally {
      this.connecting = false;
    }
  }

  private open(token: string): Conn {
    const url = connectUrl(this.opts.url, this.opts.client, this.opts.version);
    let ws: WsLike;
    const conn: Conn = { ws: null as unknown as WsLike, token, confirmed: false, dead: false, pingTimer: null, pongTimer: null, maxTimer: null };
    try {
      ws = this.opts.createSocket(url, [SUBPROTOCOL, token]);
    } catch (e) {
      this.logger.warn('[realtime] no se pudo abrir la conexión:', (e as Error)?.name ?? 'error');
      conn.dead = true;
      this.timers.setTimeout(() => this.closed(conn, {}), 0);
      return conn;
    }
    conn.ws = ws;
    ws.onopen = () => this.ping(conn);
    ws.onmessage = (ev) => this.message(conn, ev.data);
    ws.onerror = () => {
      /* el cierre llega por onclose */
    };
    ws.onclose = (ev) => this.closed(conn, ev ?? {});
    return conn;
  }

  private ping(conn: Conn) {
    if (conn.dead) return;
    try {
      conn.ws.send(JSON.stringify({ action: 'ping' }));
    } catch {
      return this.kill(conn, 4000, 'send failed');
    }
    if (conn.pongTimer) this.timers.clearTimeout(conn.pongTimer);
    conn.pongTimer = this.timers.setTimeout(() => {
      this.logger.warn('[realtime] sin pong en 30 s; se reconecta');
      this.kill(conn, 4000, 'pong timeout');
    }, PONG_TIMEOUT_MS);
  }

  private message(conn: Conn, data: unknown) {
    if (conn.dead) return;
    const msg = parseEnvelope(data);
    if (!msg) return; // JSON inválido o tipo desconocido: se ignora sin cerrar
    if (msg.type === 'pong') {
      if (conn.pongTimer) this.timers.clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
      if (!conn.confirmed) this.confirm(conn);
      return;
    }
    if (msg.type === 'session.refresh') return this.refresh(msg.reason);
    this.opts.onEvent?.(msg);
  }

  private confirm(conn: Conn) {
    conn.confirmed = true;
    this.failures = 0;
    this.rejected = false;
    if (conn === this.next) {
      // Make-before-break: la nueva ya está confirmada → cierra la anterior.
      const old = this.current;
      this.current = conn;
      this.next = null;
      this.dispose(old, 1000, 'replaced');
    }
    const schedulePing = () => {
      conn.pingTimer = this.timers.setTimeout(() => {
        if (conn.dead) return;
        this.ping(conn);
        schedulePing();
      }, PING_INTERVAL_MS);
    };
    schedulePing();
    conn.maxTimer = this.timers.setTimeout(() => void this.renew(true), MAX_CONNECTION_MS);
    this.setActive(true);
    this.logger.log(`[realtime] conectado (${this.opts.client} ${this.opts.version})`);
    this.opts.onConfirmed?.();
  }

  private refresh(reason: string) {
    this.logger.log(`[realtime] actualización forzada (${reason})`);
    this.refreshing = true;
    try {
      this.opts.onRefresh?.(reason);
    } catch {
      /* el cableado no debe romper el cliente */
    }
    const next = this.next;
    this.next = null;
    this.dispose(next, REFRESH_CLOSE_CODE, 'refresh');
    if (this.current) this.kill(this.current, REFRESH_CLOSE_CODE, 'refresh');
  }

  /** Cierra y procesa el cierre de inmediato (sin esperar al evento). */
  private kill(conn: Conn, code: number, reason: string) {
    if (conn.dead) return;
    try {
      conn.ws.close(code, reason);
    } catch {
      /* ya cerrado */
    }
    this.closed(conn, { code, reason });
  }

  /** Libera una conexión sin efectos sobre el estado (reemplazo, stop, pausa). */
  private dispose(conn: Conn | null, code: number, reason: string) {
    if (!conn || conn.dead) return;
    conn.dead = true;
    this.clearConnTimers(conn);
    try {
      conn.ws.close(code, reason);
    } catch {
      /* ya cerrado */
    }
  }

  private clearConnTimers(conn: Conn) {
    for (const t of [conn.pingTimer, conn.pongTimer, conn.maxTimer]) if (t) this.timers.clearTimeout(t);
    conn.pingTimer = conn.pongTimer = conn.maxTimer = null;
  }

  private closed(conn: Conn, ev: { code?: number; reason?: string; status?: number }) {
    if (conn.dead && conn !== this.current && conn !== this.next) return;
    conn.dead = true;
    this.clearConnTimers(conn);
    if (conn === this.next) {
      // La conexión planeada falló: se conserva la actual y se reintenta luego.
      this.next = null;
      if (!conn.confirmed) this.failures += 1;
      if (this.current && this.running && !this.refreshing) {
        const cur = this.current;
        this.timers.setTimeout(() => {
          if (this.current === cur) void this.renew(true);
        }, this.backoffMs());
      }
      return;
    }
    if (conn !== this.current) return;
    this.current = null;
    // Si hay una planeada en curso, que tome el lugar al confirmarse.
    if (this.next) {
      this.current = this.next;
      this.next = null;
      if (!this.current.confirmed) this.setActive(false);
      return;
    }
    this.setActive(false);
    if (!this.running || this.paused) return;
    if (this.refreshing) {
      this.refreshing = false;
      this.schedule(Math.round(this.random() * REFRESH_RECONNECT_MAX_MS));
      return;
    }
    if (ev.status === 403) this.rejected = true;
    if (!conn.confirmed) this.failures += 1;
    else this.failures = 1; // caída de una conexión sana: reintento corto
    this.schedule(this.backoffMs());
  }
}
