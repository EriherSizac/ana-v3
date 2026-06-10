// File: Envoltura de whatsapp-web.js. Vive en el main process de Electron.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { Client, LocalAuth, MessageMedia, type Message } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Sesión en una ruta estable de la app (no en cwd) → clearable y consistente
// entre dev y empaquetado.
const AUTH_DIR = path.join(app.getPath('userData'), 'wwebjs_auth');
import { normalizeDigits, toJid } from './phone';

export type WaState = 'idle' | 'qr' | 'authenticated' | 'connected' | 'disconnected';

export interface WaEvents {
  qr: (dataUrl: string) => void;
  status: (s: 'authenticated' | 'connected' | 'disconnected' | 'auth_failure') => void;
  message: (msg: NormalizedMessage) => void;
  error: (e: string) => void;
}

export interface NormalizedMessage {
  id: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  timestamp: number; // ms
  fromMe: boolean;
  type: string;
  // backup de media en S3 (se rellena en main tras subir)
  mediaKey?: string;
  mimetype?: string;
  filename?: string;
  // transitorio: bytes de media descargados, NO se persisten (main los sube y borra)
  _media?: { dataBase64: string; mimetype: string; filename?: string };
}

/**
 * Envoltura de whatsapp-web.js. Vive en el main process de Electron.
 * Emite eventos tipados; main.ts los reenvía al renderer por IPC y al backend.
 */
export class WaClient extends EventEmitter {
  private client: Client | null = null;
  private starting = false;
  private sawSignal = false; // hubo qr/ready/loading → no está colgado
  private lastState: WaState = 'idle';
  private lastQr: string | null = null;

  isReady() {
    return !!this.client;
  }

  /** Estado actual para que el renderer lo recupere tras refresh. */
  getState(): { status: WaState; qr: string | null } {
    return { status: this.lastState, qr: this.lastQr };
  }

  /** ¿Hay una sesión LocalAuth guardada en disco? (para auto-reconectar) */
  hasSavedSession(): boolean {
    return existsSync(path.join(AUTH_DIR, 'session-ana'));
  }

  async start() {
    if (this.client || this.starting) return;
    this.starting = true;
    this.sawSignal = false;
    console.log('[wa] start: lanzando cliente…');
    try {
      this.client = new Client({
        authStrategy: new LocalAuth({ clientId: 'ana', dataPath: AUTH_DIR }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        },
      });
      this.wire();

      // Watchdog: si en 60s no hubo QR/ready/loading, algo se colgó → avisa.
      const watchdog = setTimeout(() => {
        if (!this.sawSignal) {
          console.error('[wa] watchdog: sin señal en 60s (posible Chromium/red).');
          this.emit('error', 'No respondió WhatsApp Web (tarda o falló el navegador). Reintenta.');
        }
      }, 60_000);

      await this.client.initialize();
      clearTimeout(watchdog);
      console.log('[wa] initialize() resolvió.');
    } catch (e: any) {
      console.error('[wa] initialize() falló:', e);
      this.client = null;
      this.emit('error', e?.message ?? String(e));
    } finally {
      this.starting = false;
    }
  }

  async stop() {
    if (!this.client) return;
    try {
      await this.client.destroy();
    } finally {
      this.client = null;
    }
  }

  /** Libera el cliente y BORRA la sesión en disco (sesión muerta / logout). */
  async clearSession() {
    await this.reset();
    try {
      await fs.rm(AUTH_DIR, { recursive: true, force: true });
      console.log('[wa] sesión borrada:', AUTH_DIR);
    } catch (e) {
      console.error('[wa] no se pudo borrar sesión:', e);
    }
  }

  /** Libera el cliente sin propagar errores; deja listo para volver a start(). */
  private async reset() {
    const c = this.client;
    this.client = null;
    this.starting = false;
    try {
      await c?.destroy();
    } catch {
      // ignora: el cliente pudo morir solo
    }
  }

  private wire() {
    const c = this.client!;
    c.on('loading_screen', (percent) => {
      this.sawSignal = true;
      console.log('[wa] loading_screen', percent);
    });
    c.on('change_state', (s) => console.log('[wa] change_state', s));
    c.on('qr', async (qr) => {
      this.sawSignal = true;
      this.lastState = 'qr';
      console.log('[wa] qr recibido');
      try {
        const dataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
        this.lastQr = dataUrl;
        this.emit('qr', dataUrl);
      } catch (e: any) {
        this.emit('error', String(e));
      }
    });
    c.on('authenticated', () => {
      this.sawSignal = true;
      this.lastState = 'authenticated';
      this.emit('status', 'authenticated');
    });
    c.on('auth_failure', () => {
      this.lastState = 'disconnected';
      this.lastQr = null;
      this.emit('status', 'auth_failure');
      this.emit(
        'error',
        'WhatsApp rechazó la sesión (posible cierre remoto o bloqueo del número). ' +
          'Usa "Limpiar sesión y reconectar" para reescanear el QR; tus ' +
          'conversaciones respaldadas se recargan solas.',
      );
      void this.reset(); // sesión inválida → liberar para reintentar con QR
    });
    c.on('ready', () => {
      this.sawSignal = true;
      this.lastState = 'connected';
      this.lastQr = null;
      this.emit('status', 'connected');
    });
    c.on('disconnected', (reason) => {
      this.lastState = 'disconnected';
      this.lastQr = null;
      this.emit('status', 'disconnected');
      // LOGOUT = sesión cerrada desde el teléfono o número bloqueado; el resto
      // suele ser red/navegación. En ambos casos guiar al re-escaneo.
      const blocked = String(reason).toUpperCase().includes('LOGOUT');
      this.emit(
        'error',
        blocked
          ? 'WhatsApp cerró la sesión (cierre desde el teléfono o bloqueo del número). ' +
              'Limpia la sesión y reescanea el QR; tus conversaciones respaldadas se recargan solas.'
          : `WhatsApp se desconectó (${String(reason)}). Reintenta conectar; si persiste, limpia la sesión y reescanea.`,
      );
      // Libera el cliente para poder reconectar (cerró sesión / cayó la red).
      void this.reset();
    });
    c.on('message', async (m) => {
      const norm = this.normalize(m);
      if (m.hasMedia) {
        try {
          const media = await m.downloadMedia();
          if (media) {
            norm._media = {
              dataBase64: media.data,
              mimetype: media.mimetype,
              filename: media.filename ?? undefined,
            };
            norm.mimetype = media.mimetype;
          }
        } catch (e) {
          this.emit('error', `downloadMedia: ${String(e)}`);
        }
      }
      this.emit('message', norm);
    });
  }

  private normalize(m: Message): NormalizedMessage {
    return {
      id: m.id._serialized,
      chatId: m.from,
      from: m.from,
      to: m.to,
      body: m.body ?? '',
      timestamp: m.timestamp * 1000,
      fromMe: m.fromMe,
      type: m.type,
    };
  }

  /** Resuelve el JID real (WhatsApp decide el `1` de MX). null si no tiene WA. */
  async resolveJid(rawPhone: string, countryCode: string): Promise<string | null> {
    if (!this.client) throw new Error('WhatsApp no conectado');
    const digits = normalizeDigits(rawPhone, countryCode);
    if (!digits) return null;
    const numberId = await this.client.getNumberId(digits);
    return numberId ? numberId._serialized : null;
  }

  /** Muestra/oculta "escribiendo…" en un chat (typing en vivo del chat manual). */
  async setTyping(jid: string, on: boolean): Promise<void> {
    if (!this.client) {
      console.warn('[wa] setTyping: sin cliente');
      return;
    }
    try {
      const chat = await this.client.getChatById(jid);
      if (on) await chat.sendStateTyping();
      else await chat.clearState();
      console.log('[wa] setTyping', on ? 'ON' : 'off', jid);
    } catch (e) {
      console.error('[wa] setTyping falló', jid, e);
    }
  }

  async sendText(jid: string, body: string, simulateTyping = true): Promise<NormalizedMessage> {
    if (!this.client) throw new Error('WhatsApp no conectado');
    // Envío automático (campañas): simula escritura proporcional al largo (2–9s).
    // En respuestas manuales el typing ya se mostró en vivo → simulateTyping=false.
    if (simulateTyping) {
      const typeMs = Math.min(9000, Math.max(2000, body.length * 70));
      try {
        const chat = await this.client.getChatById(jid);
        await chat.sendStateTyping();
        await new Promise((r) => setTimeout(r, typeMs));
        await chat.clearState();
      } catch {
        await new Promise((r) => setTimeout(r, typeMs));
      }
    }
    const sent = await this.client.sendMessage(jid, body);
    return {
      id: sent.id._serialized,
      chatId: jid,
      from: 'me',
      to: jid,
      body,
      timestamp: Date.now(),
      fromMe: true,
      type: 'chat',
    };
  }

  /** Envía media (imagen/archivo) desde bytes base64. Devuelve el mensaje. */
  async sendMediaData(
    jid: string,
    m: { dataBase64: string; mimetype: string; filename: string; caption?: string },
  ): Promise<NormalizedMessage> {
    if (!this.client) throw new Error('WhatsApp no conectado');
    const media = new MessageMedia(m.mimetype, m.dataBase64, m.filename);
    const sent = await this.client.sendMessage(jid, media, { caption: m.caption });
    return {
      id: sent.id._serialized,
      chatId: jid,
      from: 'me',
      to: jid,
      body: m.caption ?? '',
      timestamp: Date.now(),
      fromMe: true,
      type: m.mimetype.startsWith('image/') ? 'image' : 'document',
      mimetype: m.mimetype,
      filename: m.filename,
    };
  }
}

export { toJid };
