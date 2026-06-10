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

/**
 * ¿Existe la campaña? Valida contra la lista de la DB (cacheada). Si la DB no
 * devuelve nada (caída o sin configurar), NO bloquea: un outage no debe
 * convertir todos los envíos en error.
 */
export async function campaignExists(name: string): Promise<boolean> {
  const all = await listCampaignsDb();
  if (all.length === 0) return true;
  return all.includes(name);
}

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
