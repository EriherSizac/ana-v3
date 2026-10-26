// File: Validación pura del emisor y argumentos de cada llamada IPC (window.ana).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * Defensa en profundidad: aunque algo llegue a ejecutarse en el renderer, el
 * main solo atiende llamadas del frame principal de la app con argumentos de
 * tipo y tamaño esperados. Inválido → `{ok:false, error:"solicitud inválida"}`
 * sin ejecutar la acción (y log sin datos personales).
 */

export const INVALID = { ok: false, error: 'solicitud inválida' } as const;

export const MAX_TEXT = 4096;
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
export const MAX_JOB_IDS = 5000;
// jobId = `<usuario>/<epochMs>_<archivo>#<i>` (identificador de carga del
// servidor): el límite de una sort key de DynamoDB es 1024 bytes.
export const MAX_ID_LEN = 1024;
export const MAX_CAMPAIGN = 100;
export const MAX_FILENAME = 120;

// ---- Emisor ----

export interface SenderContext {
  /** true en build instalado (renderer por file://…/dist/index.html). */
  packaged: boolean;
  /** Origen del servidor de Vite en desarrollo. */
  devOrigin: string;
}

/** ¿La URL pertenece a la app? (index empaquetado o servidor de dev). */
export function isAppUrl(url: string, ctx: SenderContext): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (ctx.packaged) {
    return u.protocol === 'file:' && /\/dist\/index\.html$/.test(decodeURIComponent(u.pathname));
  }
  return u.origin === ctx.devOrigin;
}

/** Forma mínima del evento de ipcMain que usa el guard. */
export interface IpcEventLike {
  senderFrame?: { url: string } | null;
}

// ---- Validadores (devuelven el valor saneado o undefined si es inválido) ----

export const isJid = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{8,15}@c\.us$/.test(v);

export const vText = (v: unknown, max = MAX_TEXT, min = 1): string | undefined =>
  typeof v === 'string' && v.length >= min && v.length <= max ? v : undefined;

export const vBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** Token: null o JWT (tres segmentos base64url). */
export function vToken(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > 16_384) return undefined;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(v) ? v : undefined;
}

export function vCampaign(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === 'string' && v.length >= 1 && v.length <= MAX_CAMPAIGN ? v : undefined;
}

export function vIdList(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_JOB_IDS) return undefined;
  for (const x of v) if (typeof x !== 'string' || x.length === 0 || x.length > MAX_ID_LEN) return undefined;
  return v as string[];
}

/** Plantillas por archivo: objeto plano, claves ≤ 500, textos ≤ 4096. */
export function vTemplates(v: unknown): Record<string, string> | undefined {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_JOB_IDS) return undefined;
  const out: Record<string, string> = {};
  for (const [k, t] of entries) {
    if (k.length === 0 || k.length > 500 || typeof t !== 'string' || t.length > MAX_TEXT) return undefined;
    out[k] = t;
  }
  return out;
}

/** Nombre de archivo saneado: solo [\w.\- ], máx 120; vacío → "archivo". */
export function sanitizeFilename(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const clean = v.replace(/[^\w.\- ]/g, '_').slice(0, MAX_FILENAME).trim();
  return clean || 'archivo';
}

const ALLOWED_MIME = /^(image|audio|video)\/[\w.+-]+$|^application\/pdf$/i;

/** Bytes que ocupa un base64 decodificado (sin decodificarlo). */
export function base64DecodedSize(b64: string): number {
  const len = b64.length;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

export interface MediaArg {
  dataBase64: string;
  mimetype: string;
  filename: string;
  caption?: string;
}

export function vMedia(v: unknown): MediaArg | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  if (typeof m.dataBase64 !== 'string' || m.dataBase64.length === 0) return undefined;
  if (base64DecodedSize(m.dataBase64) > MAX_MEDIA_BYTES) return undefined;
  if (m.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.dataBase64)) return undefined;
  if (typeof m.mimetype !== 'string' || !ALLOWED_MIME.test(m.mimetype)) return undefined;
  const filename = sanitizeFilename(m.filename);
  if (!filename) return undefined;
  let caption: string | undefined;
  if (m.caption !== undefined) {
    caption = vText(m.caption, MAX_TEXT, 0);
    if (caption === undefined) return undefined;
  }
  return { dataBase64: m.dataBase64, mimetype: m.mimetype, filename, caption };
}

// ---- Guard ----

/**
 * Valida y normaliza los argumentos crudos de un canal. Devuelve la lista de
 * argumentos para el handler o undefined si es inválida.
 */
export type ArgsValidator<A extends unknown[]> = (args: unknown[]) => A | undefined;

export const noArgs: ArgsValidator<[]> = () => [];

/**
 * Envuelve un handler de `ipcMain.handle`: rechaza si el emisor no es el frame
 * principal de la app o si los argumentos no pasan la validación.
 */
export function createGuard(isTrustedSender: (event: IpcEventLike) => boolean, log = console.warn) {
  return function guard<A extends unknown[], R>(
    channel: string,
    validate: ArgsValidator<A>,
    handler: (...args: A) => R,
  ) {
    return (event: IpcEventLike, ...raw: unknown[]): R | typeof INVALID => {
      if (!isTrustedSender(event)) {
        log(`[ipc] ${channel}: emisor no confiable, rechazado`);
        return INVALID;
      }
      const args = validate(raw);
      if (!args) {
        log(`[ipc] ${channel}: argumentos inválidos, rechazado`);
        return INVALID;
      }
      return handler(...args);
    };
  };
}

// ---- Teclado (build instalado) ----

export interface KeyInputLike {
  key?: string;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * ¿Descartar esta pulsación en el build instalado? F12 siempre; los atajos de
 * DevTools/código fuente solo SIN Alt: AltGr en Windows llega como Ctrl+Alt y
 * debe escribir (`@`, `\`, `|`…).
 */
export function shouldBlockKey(input: KeyInputLike): boolean {
  const k = (input.key || '').toLowerCase();
  if (k === 'f12') return true;
  if (input.alt) return false;
  const mod = !!(input.control || input.meta);
  if (mod && input.shift && (k === 'i' || k === 'j' || k === 'c')) return true;
  if (mod && k === 'u') return true;
  return false;
}
