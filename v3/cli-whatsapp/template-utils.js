/**
 * Renderizado de plantillas de mensaje del CLI (módulo puro, sin efectos al importarse).
 *
 * Una sola pasada de izquierda a derecha: en cada posición se reconoce primero un
 * marcador `{{...}}` y después uno `{variable}`. Los valores insertados nunca se
 * vuelven a interpretar como marcadores.
 */

const TOKEN_RE = /\{\{([^{}]+)\}\}|\{(\w+)\}/g;

const STANDARD_FIELDS = new Set([
  'phone',
  'name',
  'first_name',
  'last_name',
  'credit',
  'discount',
  'product',
]);

const BALANCE_FIELDS = new Set(['total_balance', 'total_balanc']);

const hasOwn = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

const toText = (value) => (value === undefined || value === null ? '' : String(value));

function lookupNumber(name, fields, raw) {
  for (const source of [fields, raw]) {
    if (hasOwn(source, name)) {
      const val = parseFloat(String(source[name]).replace(/,/g, '.'));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

function evaluateExpression(expression, fields, raw) {
  // Una columna con sufijo `.N` (`pago_minimo.1`, base CRM) se toma completa si
  // existe; si no, como antes: la columna base seguida de `.N`.
  const expr = expression.replace(/[a-zA-Z_][a-zA-Z0-9_]*(?:\.\d+)?/g, (colName) => {
    const val = lookupNumber(colName, fields, raw);
    if (val !== null) return String(val);
    const dot = colName.indexOf('.');
    if (dot < 0) return colName;
    const base = colName.slice(0, dot);
    const baseVal = lookupNumber(base, fields, raw);
    return (baseVal === null ? base : String(baseVal)) + colName.slice(dot);
  });

  try {
    // Evaluar solo expresiones numéricas seguras
    if (/^[0-9+\-*/().\s%]+$/.test(expr)) {
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + expr + ')')();
      if (typeof result === 'number' && isFinite(result)) {
        return Number.isInteger(result) ? String(result) : result.toFixed(2);
      }
    }
  } catch (_) {
    // expresión inválida: continuar con la resolución por clave
  }
  return null;
}

function resolveDouble(match, inner, fields, raw) {
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

function resolveSingle(match, varName, fields, raw) {
  if (varName !== 'message' && hasOwn(fields, varName) && fields[varName] !== undefined) {
    return toText(fields[varName]);
  }
  if (hasOwn(raw, varName) && raw[varName] !== undefined) return toText(raw[varName]);
  const partialKey = Object.keys(raw || {}).find((k) => k.includes(varName));
  if (partialKey) return toText(raw[partialKey]);
  return match;
}

/**
 * Renderiza una plantilla de mensaje.
 * @param {string} template - Plantilla con marcadores `{{...}}` y/o `{variable}`
 * @param {{ fields?: Object, raw?: Object }} sources - `fields`: campos mapeados del contacto;
 *   `raw`: valores por nombre original de columna del CSV
 * @returns {string} Mensaje final
 */
export function renderTemplate(template, { fields = {}, raw = {} } = {}) {
  if (template === undefined || template === null) return '';
  const f = fields || {};
  const r = raw || {};
  const rendered = String(template).replace(TOKEN_RE, (match, dbl, sgl) =>
    dbl !== undefined ? resolveDouble(match, dbl, f, r) : resolveSingle(match, sgl, f, r)
  );
  // Convertir \n literales a saltos de línea reales
  return rendered.replace(/\\n/g, '\n');
}
