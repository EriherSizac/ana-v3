// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { agentFiles, buildPlan, parseCsvText, validateRows, validRowsCsv, v4Assignments, previewMessage, type ParsedCsv, type Plan } from '@/lib/contacts';
// Implementaciones reales de los consumidores:
import { normalizeContactRow } from '../../../v4/backend/src/lib/contacts';
import { addMessageColumn, messageToSingleLine } from '../../../v3/ana-backend/src/lib/contactsCsv';

/**
 * Equivalencia (tarea 1.2): lo que el plan de ANA Admin promete por fila es lo
 * que obtienen `csvTrigger` de v4 (csv-parse + normalizeContactRow + reparto
 * `targets[i % n]` sobre `Object.entries(assignments)`) y el CLI v3
 * (`parseCSV` de agent-config.js sobre el archivo que escribe v3).
 */
const root = join(__dirname, '..', '..', '..');
const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'contacts', name), 'utf8');

/** Extrae `parseCSV` del código fuente del CLI (no se exporta y el módulo tiene efectos de import). */
function loadCliParseCSV(): (text: string) => Array<Record<string, string>> {
  const src = readFileSync(join(root, 'v3', 'cli-whatsapp', 'agent-config.js'), 'utf8');
  const start = src.indexOf('function parseCSV(csvText) {');
  if (start < 0) throw new Error('parseCSV no encontrado en agent-config.js');
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return new Function(`${src.slice(start, end)}; return parseCSV;`)();
}
const cliParseCSV = loadCliParseCSV();

/** Réplica de expandWeights + round-robin de csvTrigger. */
function triggerTargets(assignments: Record<string, number>, n: number): string[] {
  const targets: string[] = [];
  for (const [op, w] of Object.entries(assignments)) for (let i = 0; i < Math.max(0, Math.floor(w)); i++) targets.push(op);
  return Array.from({ length: n }, (_, i) => targets[i % targets.length]!);
}

const CASES: Array<{ name: string; fixture: string; phone: string; enabled: string[] }> = [
  { name: 'limpio', fixture: 'clean.example.csv', phone: 'contact_phone', enabled: ['carla', 'ana', 'beto'] },
  { name: 'sucio', fixture: 'dirty.example.csv', phone: 'phone_number', enabled: ['ana', 'beto'] },
];

describe('equivalencia con v4 (csv-parse + normalizeContactRow)', () => {
  it.each(CASES)('$name: mismas filas válidas y mismo agente por fila', ({ fixture: f, phone, enabled }) => {
    const p = parseCsvText(fixture(f), 'v4') as ParsedCsv;
    const rows = validateRows(p, 'v4', phone).valid;
    const plan = buildPlan({ fleet: 'v4', mode: 'distribute', enabled, rows }) as Plan;
    const uploaded = validRowsCsv(p.header, rows);
    const triggerRows = (parse(uploaded, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]).map(normalizeContactRow);
    const phoneOf = (r: Record<string, string>) => r[phone] || r.phone || '';
    const valid = triggerRows.filter((r) => phoneOf(r));
    expect(valid.map(phoneOf)).toEqual(rows.map((r) => r.phone));
    expect(triggerTargets(v4Assignments(plan), valid.length)).toEqual(plan.assignment);
  });

  it('limpio: el archivo original parseado por csv-parse da las mismas filas', () => {
    const text = fixture('clean.example.csv');
    const p = parseCsvText(text, 'v4') as ParsedCsv;
    const rows = validateRows(p, 'v4', 'contact_phone').valid;
    const direct = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
    expect(direct.map((r) => r.contact_phone)).toEqual(rows.map((r) => r.phone));
  });

  it('español: telefono + mensaje por fila', () => {
    const p = parseCsvText(fixture('espanol.example.csv'), 'v4') as ParsedCsv;
    const rows = validateRows(p, 'v4', 'telefono').valid;
    const plan = buildPlan({ fleet: 'v4', mode: 'single', enabled: ['ana.lopez'], agent: 'ana.lopez', rows }) as Plan;
    const triggerRows = (parse(validRowsCsv(p.header, rows), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]).map(normalizeContactRow);
    expect(triggerRows.map((r) => r.telefono)).toEqual(rows.map((r) => r.phone));
    expect(triggerTargets(v4Assignments(plan), triggerRows.length)).toEqual(plan.assignment);
    expect(previewMessage('v4', rows[0]!.record, '{mensaje}')).toBe('Hola Ana');
  });
});

describe('equivalencia con el CLI v3 (parseCSV sobre el archivo escrito por v3)', () => {
  it.each(CASES)('$name: cada agente recibe exactamente sus filas con el mensaje interpolado', ({ fixture: f, phone, enabled }) => {
    const p = parseCsvText(fixture(f), 'v3') as ParsedCsv;
    const rows = validateRows(p, 'v3', phone).valid;
    const plan = buildPlan({ fleet: 'v3', mode: 'distribute', enabled, rows }) as Plan;
    const template = 'Hola {first_name}\nSaldo: {total_balance}';
    for (const file of agentFiles(p.header, rows, plan)) {
      const written = addMessageColumn(file.csv, messageToSingleLine(template)).csv;
      const contacts = cliParseCSV(written);
      const mine = rows.filter((_, i) => plan.assignment[i] === file.agent);
      expect(contacts.map((c) => c.phone)).toEqual(mine.map((r) => r.phone));
      // El CLI interpreta `\n` literal como salto al enviar; la vista previa usa el salto real.
      expect(contacts.map((c) => c.message!.replace(/\\n/g, '\n'))).toEqual(mine.map((r) => previewMessage('v3', r.record, template)));
    }
  });
});
