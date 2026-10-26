// File: Comparación de API keys en tiempo constante (con soporte de rotación).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

/**
 * ¿El header coincide con alguna de las keys configuradas?
 * - Compara digests SHA-256 (mismo largo siempre) con `timingSafeEqual`.
 * - Evalúa TODAS las keys sin cortocircuito (no filtra cuál coincidió por tiempo).
 * - Keys vacías se ignoran; sin keys configuradas o sin header → false (fail-closed).
 */
export function matchesApiKey(header: string | undefined | null, keys: (string | undefined | null)[]): boolean {
  const configured = keys.filter((k): k is string => typeof k === 'string' && k.length > 0);
  if (configured.length === 0 || !header) return false;
  const got = digest(header);
  let match = false;
  for (const k of configured) {
    // timingSafeEqual va primero en cada vuelta: nunca se salta una key.
    match = timingSafeEqual(got, digest(k)) || match;
  }
  return match;
}
