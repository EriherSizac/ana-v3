/**
 * Port de `renderTemplate` del CLI v3 (`v3/cli-whatsapp/template-utils.js`):
 * una sola pasada de izquierda a derecha; en cada posición se reconoce primero
 * `{{...}}` y después `{variable}`; los valores insertados no se reinterpretan;
 * `\n` literal → salto de línea. Además reporta los marcadores que quedaron sin
 * resolver (add-agent-workspace: se rechazan antes de publicar).
 *
 * Mantener en sync con template-utils.js (prueba de equivalencia en
 * test/templateRender.test.ts).
 */

const TOKEN_RE = /\{\{([^{}]+)\}\}|\{(\w+)\}/g;

const STANDARD_FIELDS = new Set(['phone', 'name', 'first_name', 'last_name', 'credit', 'discount', 'product']);
const BALANCE_FIELDS = new Set(['total_balance', 'total_balanc']);

type Values = Record<string, unknown>;

const hasOwn = (obj: Values | null | undefined, key: string): boolean => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

const toText = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

function lookupNumber(name: string, fields: Values, raw: Values): number | null {
  for (const source of [fields, raw]) {
    if (hasOwn(source, name)) {
      const val = parseFloat(String(source[name]).replace(/,/g, '.'));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

function evaluateExpression(expression: string, fields: Values, raw: Values): string | null {
  const expr = expression.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (colName) => {
    const val = lookupNumber(colName, fields, raw);
    return val === null ? colName : String(val);
  });
  try {
    // Solo expresiones numéricas seguras (mismo filtro que el CLI).
    if (/^[0-9+\-*/().\s%]+$/.test(expr)) {
      const result = Function('"use strict"; return (' + expr + ')')() as unknown;
      if (typeof result === 'number' && isFinite(result)) {
        return Number.isInteger(result) ? String(result) : result.toFixed(2);
      }
    }
  } catch {
    // expresión inválida: continuar con la resolución por clave
  }
  return null;
}

function resolveDouble(match: string, inner: string, fields: Values, raw: Values): string {
  const key = inner.trim();
  if (STANDARD_FIELDS.has(key)) return toText(fields[key]) || '';
  if (BALANCE_FIELDS.has(key)) return toText(fields.total_balance) || toText(fields.total_balanc) || '';
  if (/[+\-*/()^%]/.test(key)) {
    const value = evaluateExpression(key, fields, raw);
    if (value !== null) return value;
  }
  if (hasOwn(fields, key)) return toText(fields[key]);
  if (hasOwn(raw, key)) return toText(raw[key]);
  return match;
}

function resolveSingle(match: string, varName: string, fields: Values, raw: Values): string {
  if (varName !== 'message' && hasOwn(fields, varName) && fields[varName] !== undefined) return toText(fields[varName]);
  if (hasOwn(raw, varName) && raw[varName] !== undefined) return toText(raw[varName]);
  const partialKey = Object.keys(raw || {}).find((k) => k.includes(varName));
  if (partialKey) return toText(raw[partialKey]);
  return match;
}

export interface RenderResult {
  text: string;
  /** Marcadores que quedaron tal cual (sin resolver), en orden de aparición, sin repetir. */
  unresolved: string[];
}

/** Renderiza la plantilla con los campos mapeados (`fields`) y las columnas originales (`raw`). */
export function renderTemplateDetailed(template: string, sources: { fields?: Values; raw?: Values } = {}): RenderResult {
  const f = sources.fields ?? {};
  const r = sources.raw ?? {};
  const unresolved: string[] = [];
  const rendered = String(template ?? '').replace(TOKEN_RE, (match: string, dbl?: string, sgl?: string) => {
    const out = dbl !== undefined ? resolveDouble(match, dbl, f, r) : resolveSingle(match, sgl!, f, r);
    if (out === match && !unresolved.includes(match)) unresolved.push(match);
    return out;
  });
  return { text: rendered.replace(/\\n/g, '\n'), unresolved };
}

/** Igual que `renderTemplate` del CLI. */
export const renderTemplate = (template: string, sources: { fields?: Values; raw?: Values } = {}): string =>
  renderTemplateDetailed(template, sources).text;
