// File: Cliente fino del backend. Persiste mensajes en DynamoDB vía API Gateway.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import type { NormalizedMessage } from './whatsapp/client';

/** Cliente fino del backend. Persiste mensajes en DynamoDB vía API Gateway. */
export class Backend {
  constructor(
    private apiBase: string,
    private getToken: () => string | null,
  ) {}

  private headers() {
    const token = this.getToken();
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  async putMessage(msg: NormalizedMessage): Promise<void> {
    if (!this.getToken()) return; // sin sesión aún, no persistir
    try {
      await fetch(`${this.apiBase}/messages`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(msg),
      });
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
    if (!this.getToken()) return null;
    try {
      const res = await fetch(`${this.apiBase}/media/presign`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ filename, mimetype }),
      });
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
    if (!this.getToken()) return;
    try {
      await fetch(`${this.apiBase}/interactions/report`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(r),
      });
    } catch (e) {
      console.error('[backend] reportInteraction falló:', e);
    }
  }

  /** Registra este agente como activo en su campaña (para reparto del líder). */
  async heartbeat(campaign: string): Promise<void> {
    if (!this.getToken() || !campaign) return;
    try {
      await fetch(`${this.apiBase}/agents/heartbeat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ campaign }),
      });
    } catch (e) {
      console.error('[backend] heartbeat falló:', e);
    }
  }
}
