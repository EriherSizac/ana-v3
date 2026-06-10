// File: Interpola `{campo}` con datos de la fila. Formatea MXN en balance/amount.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Columnas "de dinero": el resultado se formatea como MXN.
const MONEY_RE = /balance|amount|saldo|monto/i;

/**
 * Interpola `{campo}` con datos de la fila. Formatea MXN en balance/amount.
 * Soporta expresiones matemáticas entre llaves (paridad con v3-cli):
 * `{total_balance*0.9}`, `{saldo - descuento}`, `{monto/12}` — los nombres de
 * columna se sustituyen por su valor numérico y se evalúa la aritmética.
 * Si la expresión referencia una columna de dinero, el resultado sale en MXN.
 */
export function interpolate(tpl: string, data: Record<string, any>): string {
  return tpl.replace(/\{([^{}]+)\}/g, (match, raw: string) => {
    const key = raw.trim();

    // Campo simple: comportamiento original (ausente → '').
    if (/^\w+$/.test(key)) {
      const v = data?.[key];
      if (v === undefined || v === null) return '';
      if (MONEY_RE.test(key)) return formatMoney(v);
      return String(v);
    }

    // Expresión matemática: contiene operadores aritméticos.
    if (/[+\-*/()%]/.test(key)) {
      const result = evalMathExpr(key, data);
      if (result !== null) {
        if (MONEY_RE.test(key)) return formatMoney(result);
        return Number.isInteger(result) ? String(result) : result.toFixed(2);
      }
    }

    // Ni campo ni expresión evaluable: dejar el placeholder visible (señal
    // de plantilla mal escrita, mejor que desaparecer en silencio).
    return match;
  });
}

/**
 * Evalúa una expresión aritmética sobre columnas de la fila. null si no se
 * puede (columna no numérica, símbolo desconocido, división rara, etc.).
 * Seguridad: tras sustituir columnas, solo se evalúa si la expresión queda
 * reducida a dígitos y operadores — ningún identificador llega al eval.
 */
function evalMathExpr(expr: string, data: Record<string, any>): number | null {
  const substituted = expr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (col) => {
    if (data && Object.prototype.hasOwnProperty.call(data, col)) {
      // Acepta "1,234.56" y "1234,56" (coma decimal de los CSV en español).
      const rawVal = String(data[col]).replace(/[^\d.,-]/g, '');
      const normalized = /,\d{1,2}$/.test(rawVal)
        ? rawVal.replace(/\./g, '').replace(',', '.')
        : rawVal.replace(/,/g, '');
      const n = Number(normalized);
      if (Number.isFinite(n)) return String(n);
    }
    return col; // columna desconocida → la expresión no pasará el whitelist
  });

  if (!/^[0-9+\-*/().\s%]+$/.test(substituted)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${substituted});`)();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function formatMoney(value: string | number): string {
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
