// Fechas de Excel (support-crm-base-upload, "Fechas de Excel"): al copiar o
// exportar desde Excel una celda de fecha puede llegar como número de serie
// (45961 = 31/10/2025). Módulo puro; mantener en sync con
// admin-web/src/lib/contacts/excelDates.ts (mismas pruebas de conversión).

/** Columna de fecha por nombre: contiene `fecha` o tiene la palabra `date` (`_date`, `date_`). */
export const isDateColumnName = (h: string): boolean => {
  const n = h.trim().toLowerCase();
  return n.includes('fecha') || /(^|_)date(_|$)/.test(n);
};

/** Columna de hora por nombre: `hora` o `hora_*`. */
export const isTimeColumnName = (h: string): boolean => /^hora(_|$)/.test(h.trim().toLowerCase());

/** Rango de números de serie que se consideran fecha (≈ 1954-10-03 a 2119-01-10). */
export const SERIAL_MIN = 20_000;
export const SERIAL_MAX = 80_000;

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/**
 * Número de serie de Excel (sistema 1900) → `dd/mm/yyyy`; la fracción (hora)
 * se ignora. Reproduce el error de Excel que cuenta el 29/02/1900: el serie 60
 * es ese día ficticio y desde el 61 la fecha es 1899-12-30 + serie.
 */
export function excelSerialToDate(serial: number): string {
  const days = Math.floor(serial);
  if (days === 60) return '29/02/1900';
  const offset = days < 60 ? days - 1 : days - 2;
  const d = new Date(Date.UTC(1900, 0, 1) + offset * 86_400_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCFullYear(), 4)}`;
}

/** Fracción de día (0 ≤ x < 1) → `HH:MM:SS` (redondeo al segundo). */
export function excelFractionToTime(fraction: number): string {
  const total = Math.round(fraction * 86_400) % 86_400;
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

const SERIAL_RE = /^\d+(\.\d+)?$/;
const FRACTION_RE = /^(0?\.\d+|0)$/;

/**
 * Convierte un valor de la columna `header` si es número de serie de Excel;
 * cualquier otro valor (fechas ya formateadas, texto, columnas que no son de
 * fecha u hora) se devuelve tal cual.
 */
export function convertExcelValue(header: string, value: string): string {
  const v = value.trim();
  if (!v) return value;
  if (isDateColumnName(header)) {
    if (!SERIAL_RE.test(v)) return value;
    const n = Number(v);
    return n >= SERIAL_MIN && n <= SERIAL_MAX ? excelSerialToDate(n) : value;
  }
  if (isTimeColumnName(header)) {
    if (!FRACTION_RE.test(v)) return value;
    const n = Number(v);
    return n >= 0 && n < 1 ? excelFractionToTime(n) : value;
  }
  return value;
}

/** Índices de las columnas de fecha u hora del encabezado. */
export const excelDateColumns = (header: readonly string[]): number[] =>
  header.flatMap((h, i) => (isDateColumnName(h) || isTimeColumnName(h) ? [i] : []));

/**
 * Convierte en sitio los valores de las columnas de fecha/hora de una fila.
 * Devuelve cuántos valores cambió.
 */
export function convertExcelRow(header: readonly string[], values: string[], cols: readonly number[] = excelDateColumns(header)): number {
  let changed = 0;
  for (const i of cols) {
    const before = values[i];
    if (before === undefined) continue;
    const after = convertExcelValue(header[i]!, before);
    if (after !== before) {
      values[i] = after;
      changed++;
    }
  }
  return changed;
}

/** Fecha `dd/mm/yyyy` (o `d/m/yyyy`) → milisegundos UTC; `null` si no es fecha válida. Para filtros por rango. */
export function parseDisplayDate(value: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCDate() === d && back.getUTCMonth() === mo - 1 ? t : null;
}
