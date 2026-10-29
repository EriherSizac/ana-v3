import { serializeCsv, usesSendColumn, V4_SEND_COLUMN, type Fleet, type ValidRow } from './csv';

// Plan de reparto determinista (design D2) compartido por navegador y BFF.

export type Mode = 'distribute' | 'single';

export interface Plan {
  fleet: Fleet;
  mode: Mode;
  /** Orden efectivo de agentes (v4: orden de Object.keys de `assignments`). */
  agents: string[];
  /** Agente de cada fila válida (mismo índice que `rows`). */
  assignment: string[];
  counts: Record<string, number>;
}

/** Comparación por código de punto (no localeCompare). */
export const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Orden de los agentes habilitados. v4 reparte en el orden de
 * `Object.entries(assignments)`, donde JavaScript pone primero las llaves con
 * forma de entero; por eso se toma `Object.keys` del objeto construido con los
 * habilitados ordenados.
 */
export function agentOrder(enabled: readonly string[], fleet: Fleet): string[] {
  const sorted = [...new Set(enabled)].sort(byCodePoint);
  if (fleet === 'v3') return sorted;
  return Object.keys(Object.fromEntries(sorted.map((a) => [a, 1])));
}

export function buildPlan(input: {
  fleet: Fleet;
  mode: Mode;
  enabled: readonly string[];
  agent?: string | null;
  rows: readonly ValidRow[];
}): Plan | { error: string } {
  let agents: string[];
  if (input.mode === 'single') {
    if (!input.agent) return { error: 'Elige un agente' };
    if (!input.enabled.includes(input.agent)) return { error: 'El agente no está habilitado' };
    agents = [input.agent];
  } else {
    agents = agentOrder(input.enabled, input.fleet);
  }
  if (agents.length === 0) return { error: `No hay agentes habilitados en esta campaña para ${input.fleet}` };
  const assignment = input.rows.map((_, i) => agents[i % agents.length]!);
  const counts: Record<string, number> = Object.fromEntries(agents.map((a) => [a, 0]));
  for (const a of assignment) counts[a] = (counts[a] ?? 0) + 1;
  return { fleet: input.fleet, mode: input.mode, agents, assignment, counts };
}

/** `assignments` de v4: peso 1 por agente en el orden del plan. */
export function v4Assignments(plan: Plan): Record<string, number> {
  return Object.fromEntries(plan.agents.map((a) => [a, 1]));
}

export const V4_ASSIGNMENTS_MAX_CHARS = 1500;

export function assignmentsTooLong(plan: Plan): boolean {
  return JSON.stringify(v4Assignments(plan)).length > V4_ASSIGNMENTS_MAX_CHARS;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash del plan: orden de agentes + (fila, agente, teléfono) de cada asignación. */
export async function planHash(plan: Plan, rows: readonly ValidRow[]): Promise<string> {
  const lines = [`${plan.fleet}|${plan.mode}|${plan.agents.join(',')}`];
  rows.forEach((r, i) => lines.push(`${i}\t${plan.assignment[i]}\t${r.digits}`));
  return sha256Hex(lines.join('\n'));
}

/** v3: un archivo por agente (encabezado original + sus filas válidas). Omite agentes sin filas. */
export function agentFiles(header: readonly string[], rows: readonly ValidRow[], plan: Plan): Array<{ agent: string; csv: string; rows: number }> {
  return plan.agents
    .map((agent) => {
      const mine = rows.filter((_, i) => plan.assignment[i] === agent).map((r) => r.values);
      return { agent, csv: serializeCsv(header, mine), rows: mine.length };
    })
    .filter((f) => f.rows > 0);
}

/** v4: CSV con solo las filas válidas, en orden (fila i del trigger = fila i del plan). */
export function validRowsCsv(header: readonly string[], rows: readonly ValidRow[], phoneColumn?: string): string {
  // Con `telefono_N` elegida: última columna `telefono_envio` con el teléfono resuelto por fila.
  if (usesSendColumn(phoneColumn)) {
    return serializeCsv(
      [...header, V4_SEND_COLUMN],
      rows.map((r) => [...r.values.slice(0, header.length), r.phone]),
    );
  }
  return serializeCsv(
    header,
    rows.map((r) => r.values),
  );
}

/** `phoneColumn` del presign de v4: `telefono_envio` si aplica el fallback por fila. */
export const v4PhoneColumn = (phoneColumn: string): string => (usesSendColumn(phoneColumn) ? V4_SEND_COLUMN : phoneColumn);

// ── Vista previa del mensaje ──────────────────────────────────────────────

/** Alias de v4 (`v4/backend/src/lib/contacts.ts`, mantener en sync). */
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

export function normalizeV4Row(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...row };
  for (const group of ALIAS_GROUPS) {
    const value = group.map((k) => out[k]).find((v) => v !== undefined && v !== '');
    if (value === undefined) continue;
    for (const k of group) if (!out[k]) out[k] = value;
  }
  if (!out.name && (out.first_name || out.last_name)) out.name = `${out.first_name ?? ''} ${out.last_name ?? ''}`.trim();
  if (out.name && !out.nombre) out.nombre = out.name;
  return out;
}

/** Mapeo de columnas del CLI v3 (`agent-config.js`, parseCSV). */
const CLI_FIELD_MAPPING: Record<string, string> = {
  phone_number: 'phone',
  contact_phone: 'phone',
  contact_pho: 'phone',
  phone: 'phone',
  contact_name: 'name',
  first_name: 'first_name',
  last_name: 'last_name',
  name: 'name',
  message: 'message',
  credit: 'credit',
  credito: 'credit',
  credit_id: 'credit',
  id_credito: 'credit',
  discount: 'discount',
  total_balance: 'total_balance',
  product: 'product',
};

/** Interpolación `{var}` igual que el CLI v3 (campo mapeado, original o coincidencia parcial). */
export function interpolateV3(message: string, record: Record<string, string>): string {
  const contact: Record<string, string> = {};
  for (const [h, v] of Object.entries(record)) contact[CLI_FIELD_MAPPING[h] ?? h] = v;
  return message.replace(/\{(\w+)\}/g, (match, varName: string) => {
    if (contact[varName] !== undefined && varName !== 'message') return contact[varName]!;
    if (record[varName] !== undefined) return record[varName]!;
    const partialKey = Object.keys(record).find((k) => k.includes(varName));
    if (partialKey) return record[partialKey]!;
    return match;
  });
}

/** Vista previa aproximada de v4 (campos simples; formato de dinero y expresiones se aplican al enviar). */
export function interpolateV4(template: string, record: Record<string, string>): string {
  const data = normalizeV4Row(record);
  const render = (tpl: string, d: Record<string, string>, depth = 0): string =>
    tpl.replace(/\{\{([^{}]+)\}\}|\{([^{}]+)\}/g, (match, a: string | undefined, b: string | undefined) => {
      const key = (a ?? b ?? '').trim().replace(/\s*:.*$/, '');
      if (!/^\w+$/.test(key)) return match;
      const v = d[key];
      if (v === undefined) return '';
      if ((key === 'message' || key === 'mensaje') && /\{/.test(v) && depth < 1) {
        const { message: _m, mensaje: _me, ...rest } = d;
        return render(v, rest, depth + 1);
      }
      return v;
    });
  return render(template, data);
}

/** Mensaje final que verá el contacto (vista previa). */
export function previewMessage(fleet: Fleet, record: Record<string, string>, template: string): string {
  if (fleet === 'v3') {
    const own = record.message;
    return interpolateV3(own !== undefined && own !== '' ? own : template, record);
  }
  return interpolateV4(template || '{mensaje}', record);
}
