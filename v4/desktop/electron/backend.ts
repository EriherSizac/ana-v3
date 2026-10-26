// File: Cliente fino del backend. Persiste mensajes en DynamoDB vía API Gateway.
// Created: 2026-06-09
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import type { NormalizedMessage } from './whatsapp/client';
import type { AuthFetch } from './auth/tokenBroker';

/**
 * Cliente fino del backend. Persiste mensajes en DynamoDB vía API Gateway.
 * Todas las llamadas usan `authFetch`: token fresco del broker y un reintento
 * ante 401 (ver auth/tokenBroker.ts).
 */
/** Esperas entre reintentos del reporte al CRM (máximo 3 reintentos). */
export const REPORT_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];

export class Backend {
  constructor(
    private apiBase: string,
    private hasSession: () => boolean,
    private authFetch: AuthFetch,
    // Inyectable en pruebas; los reintentos corren fuera del ritmo de envío.
    private schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
  ) {}

  private json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  async putMessage(msg: NormalizedMessage): Promise<void> {
    if (!this.hasSession()) return; // sin sesión aún, no persistir
    try {
      const res = await this.authFetch(`${this.apiBase}/messages`, this.json('PUT', msg));
      if (!res.ok) console.error('[backend] putMessage respondió', res.status);
    } catch (e) {
      console.error('[backend] putMessage falló:', e);
    }
  }

  /** Sube media entrante a S3 (presign + PUT). Devuelve la key o null. */
  async uploadMedia(
    filename: string,
    mimetype: string,
    bytes: Uint8Array,
  ): Promise<{ key: string } | null> {
    if (!this.hasSession()) return null;
    try {
      const res = await this.authFetch(
        `${this.apiBase}/media/presign`,
        this.json('POST', { filename, mimetype }),
      );
      if (!res.ok) return null;
      const { url, key } = (await res.json()) as { url: string; key: string };
      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': mimetype },
        body: bytes,
      });
      return put.ok ? { key } : null;
    } catch (e) {
      console.error('[backend] uploadMedia falló:', e);
      return null;
    }
  }

  /**
   * Reporta al backend el resultado de un envío de campaña; el Lambda lo
   * registra en el CRM (interacción + teléfono sin WhatsApp). No bloquea el
   * ritmo de envío: el primer intento se hace ya y, si el CRM falló
   * (`retryable: true`), hubo 5xx o falló la red, se reintenta en segundo plano
   * hasta 3 veces (30 s, 2 min, 10 min). Solo en memoria: si la app se cierra,
   * los reintentos pendientes se pierden. Resuelve tras el PRIMER intento.
   */
  async reportInteraction(r: {
    jobId: string;
    campaign?: string;
    phone: string;
    status: 'sent' | 'no_whatsapp' | 'error';
    row: Record<string, string>;
  }): Promise<void> {
    if (!this.hasSession()) return;
    const attempt = async (n: number): Promise<void> => {
      const retry = await this.reportOnce(r);
      if (!retry) return;
      const wait = REPORT_RETRY_DELAYS_MS[n];
      if (wait === undefined) {
        console.error('[backend] reportInteraction agotó reintentos', r.jobId);
        return;
      }
      this.schedule(() => void attempt(n + 1), wait);
    };
    await attempt(0);
  }

  /** Un intento de reporte. true = reintentable (retryable, 5xx o red). */
  private async reportOnce(r: unknown): Promise<boolean> {
    try {
      const res = await this.authFetch(`${this.apiBase}/interactions/report`, this.json('POST', r));
      if (res.status >= 500) return true;
      if (!res.ok) return false; // 4xx: no se arregla reintentando
      const body = (await res.json().catch(() => ({}))) as { retryable?: boolean };
      return body.retryable === true;
    } catch (e) {
      console.error('[backend] reportInteraction falló:', e);
      return true; // red caída o sin sesión momentánea
    }
  }

  /**
   * Guarda los datos del contacto (campaña + fila del CSV) en la conversación,
   * para registrar interacciones al CRM al abrir el chat.
   */
  async putConversationMeta(
    chatId: string,
    campaign: string | undefined,
    contact: Record<string, string>,
  ): Promise<void> {
    if (!this.hasSession() || !campaign) return;
    try {
      await this.authFetch(
        `${this.apiBase}/conversations/meta`,
        this.json('PUT', { chatId, campaign, contact }),
      );
    } catch (e) {
      console.error('[backend] putConversationMeta falló:', e);
    }
  }

  /** Registra este agente como activo en su campaña (para reparto del líder). */
  async heartbeat(campaign: string): Promise<void> {
    if (!this.hasSession() || !campaign) return;
    try {
      await this.authFetch(`${this.apiBase}/agents/heartbeat`, this.json('POST', { campaign }));
    } catch (e) {
      console.error('[backend] heartbeat falló:', e);
    }
  }
}
