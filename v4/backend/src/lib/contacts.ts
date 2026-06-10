// File: Normaliza filas de CSV al formato de contacto de v3 (alias de columnas).
// Created: 2026-06-10
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Grupos de alias de columnas (formato CSV de v3 ↔ nombres en español de v4).
// Mantener en sync con desktop/electron/whatsapp/template.ts (misma lógica).
const ALIAS_GROUPS: string[][] = [
  ['phone', 'phone_number', 'contact_phone', 'contact_pho', 'telefono'],
  ['name', 'nombre', 'contact_name'],
  ['first_name', 'nombre_pila'],
  ['last_name', 'apellido'],
  ['credit', 'credito', 'credit_id', 'id_credito'],
  ['discount', 'descuento'],
  ['total_balance', 'total_balanc', 'balance', 'saldo'],
  ['product', 'producto'],
  ['message', 'mensaje'],
];

/**
 * Cada grupo de alias se rellena con el primer valor presente: un CSV de v3
 * (`phone_number`, `total_balance`, `message`…) funciona con plantillas en
 * español (`{telefono}`, `{saldo}`, `{mensaje}`) y viceversa.
 */
export function normalizeContactRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...row };
  for (const group of ALIAS_GROUPS) {
    const value = group.map((k) => out[k]).find((v) => v !== undefined && v !== '');
    if (value === undefined) continue;
    for (const k of group) if (!out[k]) out[k] = value;
  }
  if (!out.name && (out.first_name || out.last_name))
    out.name = `${out.first_name ?? ''} ${out.last_name ?? ''}`.trim();
  if (out.name && !out.nombre) out.nombre = out.name;
  return out;
}
