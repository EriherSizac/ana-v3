'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, isRedirecting } from '@/lib/api-client';
import { parseWaItems, WA_LOOKUP_CHUNK, type WaRecord, type WaStatus } from '@/lib/wa-status';

export type WaLookupState = 'idle' | 'loading' | 'ready' | 'error';

const MARK_CHUNK = 500;

/**
 * Consulta del registro de WhatsApp (add-whatsapp-status-registry D7) para
 * `phones` ya normalizados, en bloques de 2000. `url = null` desactiva la
 * consulta. Un fallo deja `state = 'error'` y la vista sigue usable.
 */
export function useWaLookup(url: string | null, phones: readonly string[]) {
  const [map, setMap] = useState<Record<string, WaRecord>>({});
  const [state, setState] = useState<WaLookupState>('idle');
  const [nonce, setNonce] = useState(0);
  const joined = phones.join(',');

  useEffect(() => {
    const list = joined ? joined.split(',') : [];
    if (!url || list.length === 0) {
      setState('idle');
      if (!url) setMap({});
      return;
    }
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const out: Record<string, WaRecord> = {};
        for (let i = 0; i < list.length; i += WA_LOOKUP_CHUNK) {
          const r = await apiFetch<{ items?: unknown } | null>(url, { method: 'POST', json: { phones: list.slice(i, i + WA_LOOKUP_CHUNK) } });
          Object.assign(out, parseWaItems(r?.items));
        }
        if (cancelled) return;
        setMap(out);
        setState('ready');
      } catch (e) {
        if (cancelled || isRedirecting(e)) return;
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, joined, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { map, setMap, state, retry };
}

/**
 * Registro de WhatsApp de Mi asignación: consulta + marca manual optimista
 * (`POST /api/agent/wa-status/{campaign}`). Si la marca falla, restaura los
 * registros previos y deja el error en `markError`.
 */
export function useWaStatus(campaign: string | null, phones: readonly string[]) {
  const enc = campaign ? encodeURIComponent(campaign) : null;
  const { map, setMap, state, retry } = useWaLookup(enc ? `/api/agent/wa-status/${enc}/lookup` : null, phones);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  // Registros vigentes para restaurar si la marca falla (el updater de setState puede ejecutarse dos veces).
  const mapRef = useRef(map);
  mapRef.current = map;

  const mark = useCallback(
    async (list: readonly string[], status: WaStatus): Promise<boolean> => {
      if (!enc || list.length === 0) return false;
      const prev: Record<string, WaRecord | undefined> = Object.fromEntries(list.map((p) => [p, mapRef.current[p]]));
      const now = new Date().toISOString();
      setMap((m) => {
        const next = { ...m };
        for (const p of list) {
          next[p] = { ...(m[p] ?? { lastNoWaAt: null, noWaCount: 0 }), status, updatedAt: now, updatedBy: '', source: 'agent_manual' };
        }
        return next;
      });
      setMarking(true);
      setMarkError(null);
      try {
        for (let i = 0; i < list.length; i += MARK_CHUNK) {
          await apiFetch(`/api/agent/wa-status/${enc}`, { method: 'POST', json: { phones: list.slice(i, i + MARK_CHUNK), status } });
        }
        return true;
      } catch (e) {
        if (isRedirecting(e)) return false;
        setMap((m) => {
          const next = { ...m };
          for (const p of list) {
            const old = prev[p];
            if (old) next[p] = old;
            else delete next[p];
          }
          return next;
        });
        setMarkError('No se pudo guardar la marca de WhatsApp; intenta de nuevo.');
        return false;
      } finally {
        setMarking(false);
      }
    },
    [enc, setMap],
  );

  // Confirmación de "Marcar con WhatsApp" (fila o seleccionadas): un solo diálogo para la vista.
  const [pending, setPending] = useState<string[] | null>(null);
  const request = useCallback((list: readonly string[]) => setPending(list.length ? [...list] : null), []);
  const cancel = useCallback(() => setPending(null), []);
  const confirm = useCallback(async () => {
    const list = pending;
    setPending(null);
    if (list) await mark(list, 'has_whatsapp');
  }, [pending, mark]);

  return { map, state, retry, mark, marking, markError, clearMarkError: () => setMarkError(null), pending, request, cancel, confirm };
}

export type WaStatusApi = ReturnType<typeof useWaStatus>;
