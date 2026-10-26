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
export class Backend {
  constructor(
    private apiBase: string,
    private hasSession: () => boolean,
    private authFetch: AuthFetch,
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
   * registra en el CRM (interacción + teléfono sin WhatsApp). Fire-and-forget:
   * un fallo del CRM no frena el ritmo de envío (igual que en v3).
   */
  async reportInteraction(r: {
    jobId: string;
    campaign?: string;
    phone: string;
    status: 'sent' | 'no_whatsapp' | 'error';
    row: Record<string, string>;
  }): Promise<void> {
    if (!this.hasSession()) return;
    try {
      await this.authFetch(`${this.apiBase}/interactions/report`, this.json('POST', r));
    } catch (e) {
      console.error('[backend] reportInteraction falló:', e);
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
