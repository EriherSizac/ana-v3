// File: Interpola `{campo}` con datos de la fila. Formatea MXN en balance/amount.
// Created: 2026-06-09
// Updated: 2026-06-10
// Author: Erick Hernández Silva

// Columnas "de dinero": el resultado se formatea como MXN (heurística).
const MONEY_RE = /balance|amount|saldo|monto/i;

// Modificador explícito al final del placeholder: fuerza u omite el formato
// de moneda sin depender del nombre de la columna.
//   {descuento:dinero}  → $1,234.00   (también :money, :$)
//   {saldo:num}         → 1234.5      (también :numero, :plain)
const MODIFIER_RE = /^(.*?)\s*:\s*(dinero|money|\$|num|numero|plain)$/i;
const MONEY_MODS = new Set(['dinero', 'money', '$']);

/**
 * Interpola `{campo}` con datos de la fila.
 * - Formato MXN: automático en balance/amount/saldo/monto, o explícito con
 *   `{campo:dinero}`; se desactiva con `{campo:num}`.
 * - Expresiones matemáticas (paridad con v3-cli): `{total_balance*0.9}`,
 *   `{saldo - descuento}` — los nombres de columna se sustituyen por su valor
 *   numérico y se evalúa la aritmética. Combinables: `{saldo*0.9:dinero}`.
 */
export function interpolate(tpl: string, data: Record<string, any>): string {
  // Acepta `{var}` (v4) y `{{var}}` (plantillas heredadas de v3).
  return tpl.replace(/\{\{([^{}]+)\}\}|\{([^{}]+)\}/g, (match, rawV3: string, rawV4: string) => {
    let key = (rawV3 ?? rawV4).trim();

    // Modificador explícito de formato (null = decidir por heurística).
    let asMoney: boolean | null = null;
    const mod = key.match(MODIFIER_RE);
    if (mod) {
      key = mod[1].trim();
      asMoney = MONEY_MODS.has(mod[2].toLowerCase());
    }

    // Campo simple: comportamiento original (ausente → '').
    if (/^\w+$/.test(key)) {
      const v = data?.[key];
      if (v === undefined || v === null) return '';
      // Columna message/mensaje de v3: trae SU PROPIA plantilla por contacto
      // ({{first_name}}…) → una pasada extra para resolverla. Se quita a sí
      // misma de los datos para no recursar infinito.
      if ((key === 'message' || key === 'mensaje') && /\{/.test(String(v))) {
        const { message: _m, mensaje: _me, ...rest } = data ?? {};
        return interpolate(String(v), rest);
      }
      if (asMoney ?? MONEY_RE.test(key)) return formatMoney(v);
      return String(v);
    }

    // Expresión matemática: contiene operadores aritméticos.
    if (/[+\-*/()%]/.test(key)) {
      const result = evalMathExpr(key, data);
      if (result !== null) {
        if (asMoney ?? MONEY_RE.test(key)) return formatMoney(result);
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
      // Misma regla de separadores que el formato de moneda.
      const n = parseLocaleNumber(data[col]);
      if (n !== null) return String(n);
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

// Grupos de alias de columnas (formato CSV de v3 ↔ nombres en español de v4).
// Mantener en sync con backend/src/lib/contacts.ts (misma lógica, repo separado).
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
 * Normaliza una fila de CSV al formato de contacto de v3: cada grupo de alias
 * se rellena con el primer valor presente, así `{saldo}` funciona sobre un CSV
 * con `total_balance` y viceversa. Construye `name` desde first/last si falta.
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

/**
 * Número de un valor de CSV con separadores en español o inglés (misma regla
 * para moneda y expresiones): si termina en coma + 1 o 2 dígitos, la coma es
 * decimal y los puntos son miles ("1.234,56", "1234,56"); si no, las comas son
 * miles ("1,234.56", "12,345"). null si no hay dígitos o no es un número.
 */
export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(raw)) return null;
  const normalized = /,\d{1,2}$/.test(raw)
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(value: string | number): string {
  const num = parseLocaleNumber(value);
  // Valor sin dígitos (p.ej. {nombre:dinero}) → devolver tal cual, no "$0.00".
  if (num === null) return String(value);
  return num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
