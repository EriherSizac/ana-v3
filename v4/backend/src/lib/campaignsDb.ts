// File: Nombres de campañas desde PostgreSQL. [] si falla.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { db } from './db';

// Caché en memoria del contenedor Lambda (sobrevive invocaciones calientes):
// las campañas cambian poco y cada agente consulta seguido → sin esto cada
// load de la UI pega a la DB. TTL 10 min; si la DB falla, se sirve lo último.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: string[] | null = null;
let cachedAt = 0;

/** Nombres de campañas desde PostgreSQL (con caché de 10 min). [] si falla. */
export async function listCampaignsDb(): Promise<string[]> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  try {
    const { rows } = await db().query('SELECT name FROM campaigns');
    // Dedupe + orden en JS (el SQL queda tal cual el contrato acordado).
    cached = [...new Set(rows.map((r) => String(r.name)).filter(Boolean))].sort();
    cachedAt = Date.now();
    return cached;
  } catch (e) {
    console.error('[campaignsDb] query falló', e);
    return cached ?? []; // stale mejor que vacío si la DB se cayó
  }
}
