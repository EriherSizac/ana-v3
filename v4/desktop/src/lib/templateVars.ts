// File: Variables de una plantilla que no existen en las columnas (con alias).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

import { normalizeContactRow } from '../../electron/whatsapp/template';

// Modificadores válidos al final de un placeholder ({campo:dinero} etc.).
const MOD_RE = /\s*:\s*(dinero|money|\$|num|numero|plain)$/i;

/**
 * Variables del template que NO existen en el CSV (considerando los alias
 * v3↔v4 que el motor normaliza). Vacío = todo embona (o no hay columnas).
 * La usan "Campañas" (subida) y "Mi asignación" (validación por archivo).
 */
export function getUnknownTemplateVars(tpl: string, columns: string[]): string[] {
  if (columns.length === 0) return [];
  // Set de nombres conocidos = columnas + todos sus alias expandidos.
  const dummy: Record<string, string> = {};
  for (const c of columns) dummy[c] = '1';
  const known = new Set(Object.keys(normalizeContactRow(dummy)));

  const unknown = new Set<string>();
  for (const m of tpl.matchAll(/\{\{([^{}]+)\}\}|\{([^{}]+)\}/g)) {
    const expr = (m[1] ?? m[2]).trim().replace(MOD_RE, '');
    // Identificadores dentro del placeholder (campo simple o expresión).
    for (const id of expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)) {
      if (!known.has(id[0])) unknown.add(id[0]);
    }
  }
  return [...unknown];
}
