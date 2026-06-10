// File: Nombres de campañas desde PostgreSQL. [] si falla.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { db } from './db';

/** Nombres de campañas desde PostgreSQL. [] si falla. */
export async function listCampaignsDb(): Promise<string[]> {
  try {
    const { rows } = await db().query('SELECT name FROM campaigns');
    // Dedupe + orden en JS (el SQL queda tal cual el contrato acordado).
    return [...new Set(rows.map((r) => String(r.name)).filter(Boolean))].sort();
  } catch (e) {
    console.error('[campaignsDb] query falló', e);
    return [];
  }
}
