// File: Nombres de campañas desde PostgreSQL (distinct, ordenados). [] si falla.
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

import { db } from './db';

// Tabla/columna de campañas, configurables por env (default campaigns.name).
// Se validan como identificadores SQL (no se pueden inyectar desde env).
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function ident(v: string | undefined, fallback: string): string {
  return v && IDENT.test(v) ? v : fallback;
}
const TABLE = ident(process.env.CAMPAIGNS_TABLE, 'campaigns');
const COLUMN = ident(process.env.CAMPAIGNS_COLUMN, 'name');

/** Nombres de campañas desde PostgreSQL (distinct, ordenados). [] si falla. */
export async function listCampaignsDb(): Promise<string[]> {
  try {
    const { rows } = await db().query(
      `SELECT DISTINCT ${COLUMN} AS name FROM ${TABLE} WHERE ${COLUMN} IS NOT NULL ORDER BY ${COLUMN}`,
    );
    return rows.map((r) => String(r.name)).filter(Boolean);
  } catch (e) {
    console.error('[campaignsDb] query falló', e);
    return [];
  }
}
