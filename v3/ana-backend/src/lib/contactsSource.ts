import { createHash } from 'node:crypto';
import { parseCsvLine } from './assignmentCsv';
import { escapeCSVField, isPhoneColumnName, PHONE_COLUMNS, singleLineRows } from './contactsCsv';
import { convertExcelRow, excelDateColumns } from './excelDates';

/**
 * Carga grande de ANA Admin (support-crm-base-upload, "Carga v3 grande por S3"):
 * el navegador sube a `uploads-incoming/{campaign}/{uploadId}.csv` el CSV
 * maestro (encabezado + filas válidas en el orden del plan, ya normalizadas) y
 * la Lambda lo reparte en archivos por agente con el mismo resultado que
 * `agentFiles` de ANA Admin (fila i → agente i mod n).
 */

export const INCOMING_PREFIX = 'uploads-incoming';
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_SOURCE_ROWS = 200_000;

export const incomingKey = (campaign: string, uploadId: string): string => `${INCOMING_PREFIX}/${campaign}/${uploadId}.csv`;

const digitsOf = (s: string): string => s.replace(/\D/g, '');

/**
 * Columnas de teléfono en el orden de ANA Admin (`detectPhoneColumn` +
 * `phoneCandidates` de v3): el último alias del CLI (o la primera columna de
 * teléfono) y después las demás columnas de teléfono del encabezado.
 */
export function phoneOrder(header: readonly string[]): number[] {
  const aliases = header.filter((h) => (PHONE_COLUMNS as readonly string[]).includes(h));
  const main = aliases.length ? aliases[aliases.length - 1]! : header.find(isPhoneColumnName);
  if (!main) return [];
  const cols = [main, ...header.filter((h) => h !== main && isPhoneColumnName(h))];
  return cols.map((c) => header.indexOf(c)).filter((i) => i >= 0);
}

export interface SplitResult {
  files: Array<{ agent: string; csv: string }>;
  counts: Record<string, number>;
  /** sha-256 hex con la misma fórmula que `planHash` de ANA Admin. */
  hash: string;
  rows: number;
}

/**
 * Reparte el CSV maestro entre `agents` (round-robin) y calcula el hash del
 * plan. Devuelve `{error}` si no tiene filas, supera el límite o una fila no
 * tiene teléfono válido.
 */
export function splitMaster(csv: string, agents: readonly string[], mode: 'distribute' | 'single'): SplitResult | { error: string } {
  if (agents.length === 0) return { error: 'plan.agents vacío' };
  const [headerLine, ...lines] = singleLineRows(csv).filter((l) => l !== '');
  if (!headerLine) return { error: 'El archivo está vacío' };
  const rows = lines;
  if (rows.length === 0) return { error: 'El archivo no tiene filas de contactos' };
  if (rows.length > MAX_SOURCE_ROWS) return { error: `El archivo supera ${MAX_SOURCE_ROWS.toLocaleString('es-MX')} filas para v3` };
  const header = parseCsvLine(headerLine).map((h) => h.trim());
  const phones = phoneOrder(header);
  if (!phones.length) return { error: 'falta columna de teléfono' };
  const hashLines = [`v3|${mode}|${agents.join(',')}`];
  const byAgent = new Map<string, string[]>(agents.map((a) => [a, []]));
  for (let i = 0; i < rows.length; i++) {
    const values = parseCsvLine(rows[i]!);
    const present = phones.map((c) => values[c] ?? '').filter((v) => v);
    const phone = present.find((v) => digitsOf(v).length >= 10) ?? '';
    if (!phone) return { error: `Fila ${i + 2}: sin teléfono válido` };
    const agent = agents[i % agents.length]!;
    hashLines.push(`${i}\t${agent}\t${digitsOf(phone)}`);
    byAgent.get(agent)!.push(rows[i]!);
  }
  const files: SplitResult['files'] = [];
  const counts: Record<string, number> = {};
  for (const agent of agents) {
    const mine = byAgent.get(agent)!;
    counts[agent] = mine.length;
    if (mine.length) files.push({ agent, csv: [headerLine, ...mine].join('\n') + '\n' });
  }
  const hash = createHash('sha256').update(hashLines.join('\n'), 'utf8').digest('hex');
  return { files, counts, hash, rows: rows.length };
}

/**
 * Filas lógicas con los números de serie de Excel de columnas de fecha/hora
 * convertidos (`dd/mm/yyyy`, `HH:MM:SS`); solo se re-serializan las filas que
 * cambian. Primera fila = encabezado.
 */
export function convertDateRows(rows: string[]): string[] {
  if (rows.length < 2) return rows;
  const header = parseCsvLine(rows[0]!).map((h) => h.trim());
  const cols = excelDateColumns(header);
  if (!cols.length) return rows;
  return rows.map((line, i) => {
    if (i === 0 || !line) return line;
    const values = parseCsvLine(line);
    return convertExcelRow(header, values, cols) ? values.map(escapeCSVField).join(',') : line;
  });
}
