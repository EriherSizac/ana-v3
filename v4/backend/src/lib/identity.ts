// File: Identificador canónico de operador, codificación de llaves S3 y campañas (v4-canonical-identity-keys).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/**
 * Identificador canónico de un operador (design D1): sin espacios laterales y
 * en minúsculas. Los usernames del pool ya están en minúsculas, así que para el
 * claim es idempotente; cambia valores de otras fuentes (Dashboard, assignments).
 */
export function canonicalOperatorId(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

const SAFE = /^[a-z0-9._-]$/;
const HEX = '0123456789abcdef';

/**
 * Codificación inyectiva de un operador como segmento de llave S3 (design D2):
 * cada byte UTF-8 en `[a-z0-9._-]` se conserva; cualquier otro (incluido `~`)
 * se escribe `~` + 2 hex en minúsculas. `.` y `..` se codifican completos.
 */
export function encodeKeySegment(id: string): string {
  const bytes = new TextEncoder().encode(id);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += b < 0x80 && SAFE.test(ch) ? ch : `~${HEX[b >> 4]}${HEX[b & 15]}`;
  }
  if (out === '.' || out === '..') out = out.replace(/\./g, '~2e');
  return out;
}

/**
 * Inverso de `encodeKeySegment`. null si el segmento no es una codificación
 * válida (escape mal formado, carácter fuera del alfabeto, UTF-8 inválido o
 * una forma no canónica como `~61` en lugar de `a`).
 */
export function decodeKeySegment(seg: string): string | null {
  if (typeof seg !== 'string' || seg === '' || seg === '.' || seg === '..') return null;
  const bytes: number[] = [];
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]!;
    if (ch === '~') {
      const hex = seg.slice(i + 1, i + 3);
      if (!/^[0-9a-f]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else if (SAFE.test(ch)) bytes.push(ch.charCodeAt(0));
    else return null;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
  // Una sola codificación por operador: rechaza formas alternativas.
  return encodeKeySegment(decoded) === seg ? decoded : null;
}

/** Segmento heredado (`safeUser` previo a este cambio), solo para la transición. */
export const legacySafeSegment = (username: string): string => username.replace(/[^\w.\-]/g, '_');

/** Forma de comparación de una campaña: sin espacios laterales ni mayúsculas. */
export const campaignKey = (c: unknown): string => (typeof c === 'string' ? c.trim().toLowerCase() : '');

/** ¿Misma campaña? (sin distinguir mayúsculas ni espacios laterales; vacío nunca coincide). */
export function sameCampaign(a: unknown, b: unknown): boolean {
  const ka = campaignKey(a);
  return ka !== '' && ka === campaignKey(b);
}

/** ¿`campaign` está en `list` (o `list` trae `*`)? */
export function campaignIn(list: readonly string[], campaign: unknown): boolean {
  return list.some((c) => c === '*' || sameCampaign(c, campaign));
}

/** Grafía del catálogo que coincide con `input` (o `input` sin espacios laterales). */
export function matchCatalogCampaign(input: string, catalog: readonly string[]): string {
  const k = campaignKey(input);
  return catalog.find((c) => campaignKey(c) === k) ?? input.trim();
}

/**
 * Grafía del catálogo de PostgreSQL para una campaña recibida (design D4). Si
 * el catálogo no está disponible o no hay coincidencia, el valor sin espacios.
 */
export async function resolveCatalogCampaign(input: string): Promise<string> {
  if (!input) return '';
  return matchCatalogCampaign(input, await catalogCampaigns());
}

/** Catálogo de campañas ([] si no está disponible). */
export async function catalogCampaigns(): Promise<string[]> {
  try {
    // Import diferido: los handlers que solo usan la identidad no cargan pg.
    const { listCampaignsDb } = await import('./campaignsDb');
    return await listCampaignsDb();
  } catch {
    return [];
  }
}

/**
 * Campañas de los roles (design D4): sin espacios laterales, sin duplicados
 * aunque difieran en mayúsculas y con la grafía del catálogo si coincide.
 */
export function normalizeUserCampaigns(raw: readonly unknown[], catalog: readonly string[]): string[] {
  const out = new Map<string, string>();
  for (const r of raw) {
    if (typeof r !== 'string' || !r.trim()) continue;
    const k = campaignKey(r);
    if (!out.has(k)) out.set(k, r.trim() === '*' ? '*' : matchCatalogCampaign(r, catalog));
  }
  return [...out.values()];
}
