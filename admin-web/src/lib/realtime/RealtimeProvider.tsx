'use client';

// File: Provider del canal realtime en la consola y hook de recarga por sección (add-realtime-admin-web D2–D7).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { currentIdToken } from '@/lib/auth-client';
import { RealtimeClient, type KnownEvent, type RealtimeEnvelope, type SocketFactory, type WsLike } from './client';
import { realtimeClientConfig, type RealtimeClientConfig } from './config';

export type RealtimeStatus = 'active' | 'inactive' | 'disabled';
export type ResyncReason = 'reconnect' | 'refresh' | 'focus';
export type RealtimeSignal = { kind: 'event'; event: RealtimeEnvelope } | { kind: 'resync'; reason: ResyncReason };

interface RealtimeApi {
  status: RealtimeStatus;
  subscribe: (fn: (s: RealtimeSignal) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

/** Cada cuánto se revisa si Amplify renovó el ID token (design D4). */
export const TOKEN_CHECK_MS = 60_000;
/** Pestaña oculta más de este tiempo → se cierra la conexión (design D5). */
export const HIDDEN_CLOSE_MS = 10 * 60 * 1000;
/** Recarga al recuperar el foco con el canal inactivo: máximo una por minuto (design D6). */
export const FOCUS_RESYNC_MIN_GAP_MS = 60_000;
/** Ventana de coalescencia de la recarga por sección (design D3). */
export const REFRESH_COALESCE_MS = 1000;
/** Evento de ventana que dispara el cierre de sesión (LogoutDialog). */
export const LOGOUT_EVENT = 'ana:logout';

export interface RealtimeProviderProps {
  children: ReactNode;
  /** Relee `GET /api/me` sin desmontar la vista (ConsoleGate). */
  refreshAccess?: () => Promise<void>;
  config?: RealtimeClientConfig;
  createSocket?: SocketFactory;
  getToken?: () => Promise<string | null>;
}

const browserSocket: SocketFactory = (url, protocols) => new WebSocket(url, protocols) as unknown as WsLike;

/**
 * Una conexión por pestaña (design D2), directa al gateway (D1). Sin URL o con
 * `NEXT_PUBLIC_REALTIME_ENABLED=false` no abre nada: estado `disabled`.
 */
export function RealtimeProvider({ children, refreshAccess, config, createSocket, getToken }: RealtimeProviderProps) {
  const cfg = useMemo(() => config ?? realtimeClientConfig(), [config]);
  const [status, setStatus] = useState<RealtimeStatus>(cfg.enabled ? 'inactive' : 'disabled');
  const listeners = useRef(new Set<(s: RealtimeSignal) => void>());
  const refreshRef = useRef(refreshAccess);
  refreshRef.current = refreshAccess;

  const emit = useCallback((s: RealtimeSignal) => {
    for (const fn of [...listeners.current]) {
      try {
        fn(s);
      } catch {
        /* una vista no rompe a las demás */
      }
    }
  }, []);

  useEffect(() => {
    let lastFocusResync = 0;
    const focusResync = () => {
      const now = Date.now();
      if (now - lastFocusResync < FOCUS_RESYNC_MIN_GAP_MS) return;
      lastFocusResync = now;
      emit({ kind: 'resync', reason: 'focus' });
    };

    if (!cfg.enabled || !cfg.url) {
      // Canal deshabilitado: solo la recarga al volver a la pestaña (D6).
      const onVisible = () => {
        if (document.visibilityState === 'visible') focusResync();
      };
      window.addEventListener('focus', focusResync);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('focus', focusResync);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }

    let everConfirmed = false;
    let paused = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const client = new RealtimeClient({
      url: cfg.url,
      client: 'admin',
      version: cfg.version,
      getToken: getToken ?? (() => currentIdToken()),
      createSocket: createSocket ?? browserSocket,
      onState: (s) => setStatus(s),
      onConfirmed: () => {
        // Lectura al reconectar (no en la primera conexión: la vista acaba de cargar).
        if (everConfirmed) emit({ kind: 'resync', reason: 'reconnect' });
        everConfirmed = true;
      },
      onEvent: (event) => emit({ kind: 'event', event }),
      onRefresh: () => {
        void Promise.resolve(refreshRef.current?.())
          .catch(() => undefined)
          .finally(() => emit({ kind: 'resync', reason: 'refresh' }));
      },
    });
    client.start();
    const tokenTimer = setInterval(() => void client.renew(), TOKEN_CHECK_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!hideTimer)
          hideTimer = setTimeout(() => {
            hideTimer = null;
            paused = true;
            client.pause();
          }, HIDDEN_CLOSE_MS);
        return;
      }
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      if (paused) {
        // Reconexión al volver: su confirmación dispara la recarga (una vez).
        paused = false;
        everConfirmed = true;
        client.resume();
      } else if (!client.isActive()) focusResync();
    };
    const onFocus = () => {
      if (!paused && !client.isActive()) focusResync();
    };
    const onLogout = () => client.stop();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(LOGOUT_EVENT, onLogout);
      clearInterval(tokenTimer);
      if (hideTimer) clearTimeout(hideTimer);
      client.stop();
    };
  }, [cfg, createSocket, getToken, emit]);

  const subscribe = useCallback((fn: (s: RealtimeSignal) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const api = useMemo<RealtimeApi>(() => ({ status, subscribe }), [status, subscribe]);
  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}

/** Estado del canal (null fuera del provider). */
export function useRealtimeStatus(): RealtimeStatus | null {
  return useContext(RealtimeContext)?.status ?? null;
}

const key = (c: unknown) => (typeof c === 'string' ? c.trim().toLowerCase() : '');

export interface UseRealtimeRefreshOptions {
  /** Eventos que ensucian la sección. */
  types: readonly KnownEvent[];
  /**
   * Campaña que muestra la vista: `undefined` = sin filtro (configuración),
   * `null` = aún no hay campaña elegida (no se recarga nada).
   */
  campaign?: string | null;
  reload: () => unknown;
  /** Trabajo del usuario sin guardar: en lugar de recargar se muestra el aviso. */
  isDirty?: () => boolean;
}

/**
 * Recarga por sección (design D3): coalescencia 1 s, filtro de campaña,
 * recarga al reconectar, tras una actualización forzada y al volver el foco
 * con el canal inactivo; con trabajo sin guardar, aviso "Hay cambios nuevos".
 * Fuera del provider no hace nada.
 */
export function useRealtimeRefresh({ types, campaign, reload, isDirty }: UseRealtimeRefreshOptions) {
  // Solo `subscribe` (estable): un cambio de estado del canal no debe cancelar una recarga pendiente.
  const subscribe = useContext(RealtimeContext)?.subscribe;
  const [stale, setStale] = useState(false);
  const ref = useRef({ types, campaign, reload, isDirty });
  ref.current = { types, campaign, reload, isDirty };

  useEffect(() => {
    if (!subscribe) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      timer = null;
      if (ref.current.isDirty?.()) setStale(true);
      else void ref.current.reload();
    };
    const unsub = subscribe((s) => {
      const c = ref.current.campaign;
      if (c === null) return;
      if (s.kind === 'event') {
        if (!ref.current.types.includes(s.event.type)) return;
        if (c !== undefined && s.event.campaign && key(s.event.campaign) !== key(c)) return;
      }
      if (!timer) timer = setTimeout(fire, REFRESH_COALESCE_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [subscribe]);

  const refresh = useCallback(() => {
    setStale(false);
    void ref.current.reload();
  }, []);

  return { stale, refresh };
}
