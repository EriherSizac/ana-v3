// File: Enmascarado visual de teléfonos (`***` + últimos 4 dígitos).
// Created: 2026-10-26
// Updated: 2026-10-26
// Author: Erick Hernández Silva

/** Enmascara número para mostrar (regla: masking solo visual). */
export function maskPhone(jid: string): string {
  const digits = String(jid ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}
