// File: Interpola `{campo}` con datos de la fila. Formatea MXN en balance/amount.
// Created: 2026-06-09
// Updated: 2026-06-09
// Author: Erick Hernández Silva

/** Interpola `{campo}` con datos de la fila. Formatea MXN en balance/amount. */
export function interpolate(tpl: string, data: Record<string, any>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = data?.[k];
    if (v === undefined || v === null) return '';
    if (/balance|amount|saldo|monto/i.test(k)) return formatMoney(v);
    return String(v);
  });
}

export function formatMoney(value: string | number): string {
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
