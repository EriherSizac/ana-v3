/**
 * Canal realtime del CLI (add-realtime-v3-cli, design D1/D2/D7).
 *
 * Contrato común del canal (add-realtime-gateway D8/D9/D12):
 *  - subprotocolo `ana.v1, <ID token>` y `?client=cli&v=<versión>`;
 *  - `ping` al abrir y cada 5 min (también durante ciclos y pausas); activo
 *    tras el primer `pong`; sin `pong` en 30 s → inactivo, cierre y reconexión;
 *  - backoff exponencial con jitter 1 s → 5 min (15 min tras 403 o 5 fallos);
 *  - reconexión planeada a los 110 min o con token nuevo, abriendo la nueva
 *    conexión antes de cerrar la anterior (make-before-break);
 *  - `session.refresh` → cierre 4001, evento `refresh` y reconexión tras
 *    0–10 s sin crecer el backoff.
 * Vive en el proceso principal (las ventanas no se conectan). Nunca imprime ni
 * guarda el token. Todas las dependencias son inyectables para pruebas.
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
/** Cada cuánto se revisa si el ID token cambió (renovación de la sesión). */
export const TOKEN_CHECK_MS = 60_000;

export const KNOWN_EVENTS = Object.freeze([
  'jobs.changed',
  'assignment.pending',
  'assignment.published',
  'publications.changed',
  'uploads.changed',
  'review.changed',
  'roster.changed',
  'settings.changed',
]);

/** Sobre del catálogo, `{type:'pong'}`, `{type:'session.refresh', reason}` o null. */
export function parseMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'pong') return { type: 'pong' };
  if (msg.v !== 1) return null;
  if (msg.type === 'session.refresh') return { type: 'session.refresh', reason: String(msg.ref?.reason ?? 'unknown') };
  if (!KNOWN_EVENTS.includes(msg.type)) return null;
  return msg;
}

export function connectUrl(base, client, version) {
  const u = new URL(base);
  u.searchParams.set('client', client);
  u.searchParams.set('v', version);
  return u.toString();
}

export function isUsableUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' || (u.protocol === 'ws:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

/** Configuración efectiva: `ANA_REALTIME=off` o sin URL válida → deshabilitado. */
export function realtimeConfigFrom(env = process.env, defaultUrl = '') {
  if (String(env.ANA_REALTIME || '').trim().toLowerCase() === 'off') return { enabled: false, url: null, reason: 'flag' };
  const url = String(env.ANA_REALTIME_URL || '').trim() || String(defaultUrl || '').trim();
  if (!isUsableUrl(url)) return { enabled: false, url: null, reason: 'no_url' };
  return { enabled: true, url };
}

/** ¿El aviso es una asignación publicada para la campaña de la sesión? (design D4) */
export function isAssignmentFor(evt, sessionCampaign) {
  const c = String(sessionCampaign || '').trim().toLowerCase();
  return !!evt && evt.type === 'assignment.published' && !!c && String(evt.campaign || '').trim().toLowerCase() === c;
}

/** ¿`settings.changed` para el CLI? */
export const isCliSettings = (evt) => !!evt && evt.type === 'settings.changed' && evt.ref?.scope === 'cli';

/**
 * Adaptador de `ws` (Node 18, sin WebSocket global) a la forma mínima que usa
 * el cliente. Un rechazo del handshake llega como cierre con `status` (403…).
 */
export function wsSocketFactory(WebSocketImpl) {
  return (url, protocols) => {
    const ws = new WebSocketImpl(url, protocols, { handshakeTimeout: 15_000 });
    const sock = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (d) => ws.send(d),
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          ws.terminate?.();
        }
      },
    };
    let status;
    ws.on('open', () => sock.onopen?.());
    ws.on('message', (data) => sock.onmessage?.({ data: data.toString() }));
    ws.on('error', (e) => {
      const m = /Unexpected server response: (\d{3})/.exec(String(e?.message || ''));
      if (m) status = Number(m[1]);
      sock.onerror?.(e);
    });
    ws.on('close', (code, reason) => sock.onclose?.({ code, reason: String(reason || ''), status }));
    return sock;
  };
}

/**
 * @param {{ url: string, version: string, getToken: () => Promise<string|null>,
 *   createSocket: (url: string, protocols: string[]) => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, random?: () => number,
 *   logger?: Console, client?: string }} opts
 */
export function createRealtime(opts) {
  const timers = opts.timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };
  const random = opts.random || Math.random;
  const logger = opts.logger || console;
  const client = opts.client || 'cli';
  const listeners = { assignment: new Set(), settings: new Set(), active: new Set(), inactive: new Set(), refresh: new Set(), event: new Set() };

  let current = null;
  let next = null;
  let running = false;
  let active = false;
  let failures = 0;
  let rejected = false;
  let refreshing = false;
  let reconnectTimer = null;
  let tokenTimer = null;
  let connecting = false;
  let sessionCampaign = null;

  const emit = (name, ...args) => {
    for (const fn of listeners[name]) {
      try {
        fn(...args);
      } catch (e) {
        logger.error?.('[realtime] listener falló:', e?.message || e);
      }
    }
  };
  const unref = (h) => {
    h?.unref?.();
    return h;
  };
  const setT = (fn, ms) => unref(timers.setTimeout(fn, ms));

  async function safeToken() {
    try {
      return await opts.getToken();
    } catch {
      return null;
    }
  }

  function setActive(v) {
    if (active === v) return;
    active = v;
    emit(v ? 'active' : 'inactive');
  }

  function clearReconnect() {
    if (reconnectTimer) timers.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function schedule(ms) {
    clearReconnect();
    if (!running) return;
    reconnectTimer = setT(() => {
      reconnectTimer = null;
      void connect();
    }, ms);
  }

  function backoffMsFor(n) {
    const cap = rejected || n >= REJECTIONS_FOR_LONG_BACKOFF ? BACKOFF_MAX_REJECTED_MS : BACKOFF_MAX_MS;
    const base = Math.min(cap, BACKOFF_BASE_MS * 2 ** Math.max(0, n - 1));
    return Math.round(base / 2 + (random() * base) / 2);
  }

  async function connect() {
    if (!running || current || connecting) return;
    connecting = true;
    try {
      const token = await safeToken();
      if (!running || current) return;
      if (!token) {
        failures += 1;
        schedule(backoffMsFor(failures));
        return;
      }
      current = open(token);
    } finally {
      connecting = false;
    }
  }

  function open(token) {
    const conn = { ws: null, token, confirmed: false, dead: false, pingTimer: null, pongTimer: null, maxTimer: null };
    try {
      conn.ws = opts.createSocket(connectUrl(opts.url, client, opts.version), [SUBPROTOCOL, token]);
    } catch (e) {
      logger.warn?.('[realtime] no se pudo abrir la conexión:', e?.name || 'error');
      conn.dead = true;
      setT(() => closed(conn, {}), 0);
      return conn;
    }
    conn.ws.onopen = () => ping(conn);
    conn.ws.onmessage = (ev) => message(conn, ev?.data);
    conn.ws.onerror = () => {};
    conn.ws.onclose = (ev) => closed(conn, ev || {});
    return conn;
  }

  function ping(conn) {
    if (conn.dead) return;
    try {
      conn.ws.send(JSON.stringify({ action: 'ping' }));
    } catch {
      return kill(conn, 4000, 'send failed');
    }
    if (conn.pongTimer) timers.clearTimeout(conn.pongTimer);
    conn.pongTimer = setT(() => {
      logger.warn?.('[realtime] sin pong en 30 s; se reconecta');
      kill(conn, 4000, 'pong timeout');
    }, PONG_TIMEOUT_MS);
  }

  function message(conn, data) {
    if (conn.dead) return;
    const msg = parseMessage(data);
    if (!msg) return; // JSON inválido o tipo desconocido: se ignora sin cerrar
    if (msg.type === 'pong') {
      if (conn.pongTimer) timers.clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
      if (!conn.confirmed) confirm(conn);
      return;
    }
    if (msg.type === 'session.refresh') return refresh(msg.reason);
    emit('event', msg);
    if (isAssignmentFor(msg, sessionCampaign)) emit('assignment', msg);
    else if (isCliSettings(msg)) emit('settings', msg);
  }

  function confirm(conn) {
    conn.confirmed = true;
    failures = 0;
    rejected = false;
    if (conn === next) {
      const old = current;
      current = conn;
      next = null;
      dispose(old, 1000, 'replaced');
    }
    const schedulePing = () => {
      conn.pingTimer = setT(() => {
        if (conn.dead) return;
        ping(conn);
        schedulePing();
      }, PING_INTERVAL_MS);
    };
    schedulePing();
    conn.maxTimer = setT(() => void renew(true), MAX_CONNECTION_MS);
    const was = active;
    setActive(true);
    logger.log?.(`[realtime] conectado (${client} ${opts.version})`);
    // Cada conexión confirmada cuenta como reconexión (lectura de estado).
    if (was) emit('active');
  }

  function refresh(reason) {
    logger.log?.(`[realtime] actualización forzada (${reason})`);
    refreshing = true;
    emit('refresh', reason);
    const n = next;
    next = null;
    dispose(n, REFRESH_CLOSE_CODE, 'refresh');
    if (current) kill(current, REFRESH_CLOSE_CODE, 'refresh');
  }

  function kill(conn, code, reason) {
    if (conn.dead) return;
    try {
      conn.ws.close(code, reason);
    } catch {
      /* ya cerrado */
    }
    closed(conn, { code, reason });
  }

  function clearConnTimers(conn) {
    for (const t of [conn.pingTimer, conn.pongTimer, conn.maxTimer]) if (t) timers.clearTimeout(t);
    conn.pingTimer = conn.pongTimer = conn.maxTimer = null;
  }

  function dispose(conn, code, reason) {
    if (!conn || conn.dead) return;
    conn.dead = true;
    clearConnTimers(conn);
    try {
      conn.ws.close(code, reason);
    } catch {
      /* ya cerrado */
    }
  }

  function closed(conn, ev) {
    if (conn.dead && conn !== current && conn !== next) return;
    conn.dead = true;
    clearConnTimers(conn);
    if (conn === next) {
      next = null;
      if (!conn.confirmed) failures += 1;
      if (current && running && !refreshing) {
        const cur = current;
        setT(() => {
          if (current === cur) void renew(true);
        }, backoffMsFor(failures));
      }
      return;
    }
    if (conn !== current) return;
    current = null;
    if (next) {
      current = next;
      next = null;
      if (!current.confirmed) setActive(false);
      return;
    }
    setActive(false);
    if (!running) return;
    if (refreshing) {
      refreshing = false;
      schedule(Math.round(random() * REFRESH_RECONNECT_MAX_MS));
      return;
    }
    if (ev.status === 403) rejected = true;
    if (!conn.confirmed) failures += 1;
    else failures = 1;
    schedule(backoffMsFor(failures));
  }

  async function renew(force = false) {
    if (!running || next) return;
    const cur = current;
    if (!cur || !cur.confirmed) return;
    const token = await safeToken();
    if (!token || (!force && token === cur.token)) return;
    if (!running || next || current !== cur) return;
    next = open(token);
  }

  function scheduleTokenCheck() {
    tokenTimer = setT(async () => {
      tokenTimer = null;
      if (!running) return;
      await renew(false);
      scheduleTokenCheck();
    }, TOKEN_CHECK_MS);
  }

  return {
    isActive: () => active,
    /** Campaña de la sesión (filtro de avisos de asignación). */
    setCampaign(c) {
      sessionCampaign = c ? String(c).trim().toLowerCase() : null;
    },
    on(name, fn) {
      listeners[name]?.add(fn);
      return () => listeners[name]?.delete(fn);
    },
    start() {
      if (running) return;
      running = true;
      void connect();
      scheduleTokenCheck();
    },
    stop() {
      running = false;
      clearReconnect();
      if (tokenTimer) timers.clearTimeout(tokenTimer);
      tokenTimer = null;
      dispose(next, 1000, 'stop');
      dispose(current, 1000, 'stop');
      next = null;
      current = null;
      setActive(false);
    },
    renew,
    backoffMs: () => backoffMsFor(failures),
    backoffMsFor,
  };
}
