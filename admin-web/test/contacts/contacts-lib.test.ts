// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentFiles,
  agentOrder,
  assignmentsTooLong,
  buildPlan,
  checkFileSize,
  detectPhoneColumn,
  parseCsvText,
  planHash,
  previewMessage,
  validateRows,
  validRowsCsv,
  v4Assignments,
  type ParsedCsv,
  type Plan,
} from '@/lib/contacts';

export const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'contacts', name), 'utf8');

const parsed = (name: string, fleet: 'v3' | 'v4' = 'v3') => {
  const p = parseCsvText(fixture(name), fleet);
  if ('error' in p) throw new Error(p.error);
  return p as ParsedCsv;
};

describe('lectura y límites', () => {
  it('quita BOM, recorta y salta filas vacías', () => {
    const p = parsed('dirty.example.csv');
    expect(p.header).toEqual(['phone_number', 'first_name', 'total_balance', 'nota']);
    expect(p.rows).toHaveLength(7);
    expect(p.rows[6]!.values).toEqual(['5215500000104', 'Carla', '300', 'ok']);
  });

  it('límites por flota', () => {
    expect(checkFileSize(6 * 1024 * 1024, 'v3')).toBe('El archivo supera 4 MB para v3');
    expect(checkFileSize(6 * 1024 * 1024, 'v4')).toBeNull();
    expect(checkFileSize(11 * 1024 * 1024, 'v4')).toBe('El archivo supera 10 MB para v4');
    expect(checkFileSize(0, 'v4')).toBe('El archivo está vacío');
    const big = 'phone\n' + Array.from({ length: 20_001 }, (_, i) => String(5215500000000 + i)).join('\n');
    expect(parseCsvText(big, 'v3')).toEqual({ error: 'El archivo supera 20,000 filas para v3' });
    expect('error' in parseCsvText(big, 'v4')).toBe(false);
  });

  it('vacío o sin filas', () => {
    expect(parseCsvText('', 'v3')).toEqual({ error: 'El archivo está vacío' });
    expect(parseCsvText('﻿  \n\n', 'v3')).toEqual({ error: 'El archivo está vacío' });
    expect(parseCsvText('phone,name\n', 'v3')).toEqual({ error: 'El archivo no tiene filas de contactos' });
  });
});

describe('columna de teléfono', () => {
  it('v3 acepta alias, telefono y telefono_N (support-crm-base-upload)', () => {
    expect(detectPhoneColumn(['telefono', 'nombre'], 'v3')).toEqual({ column: 'telefono' });
    expect(detectPhoneColumn(['nombre', 'saldo'], 'v3')).toEqual({
      error: 'v3 requiere una columna de teléfono (phone_number, contact_phone, contact_pho, phone, telefono o telefono_N)',
    });
    expect(detectPhoneColumn(['contact_pho', 'x'], 'v3')).toEqual({ column: 'contact_pho' });
    expect(detectPhoneColumn(['telefono_1', 'phone'], 'v3')).toEqual({ column: 'phone' });
  });
  it('v4 acepta telefono o la elegida', () => {
    expect(detectPhoneColumn(['telefono', 'nombre'], 'v4')).toEqual({ column: 'telefono' });
    expect(detectPhoneColumn(['celular', 'nombre'], 'v4')).toEqual({ error: 'Elige la columna de teléfono' });
    expect(detectPhoneColumn(['celular', 'nombre'], 'v4', 'celular')).toEqual({ column: 'celular' });
  });
});

describe('validación de filas', () => {
  it('causas: sin teléfono, corto, duplicado, incompleto', () => {
    const v = validateRows(parsed('dirty.example.csv'), 'v3', 'phone_number');
    expect(v.total).toBe(7);
    expect(v.valid.map((r) => r.phone)).toEqual(['5215500000101', '5215500000102', '5215500000104']);
    expect(v.invalid.map((r) => r.reason)).toEqual([
      'Sin teléfono',
      'Teléfono con menos de 10 dígitos',
      'Teléfono duplicado',
      'Columnas incompletas',
    ]);
    expect(v.valid[0]!.record.nota).toBe('Calle 1, Col. Centro');
    expect(v.valid[1]!.record.nota).toBe('Dijo "hola"');
  });

  it('500 filas con 3 sin teléfono y 2 repetidos → 495 válidas', () => {
    // fila 0: teléfono base; 1-3: sin teléfono; 4-5: repiten el teléfono base; resto: únicos.
    const rows = Array.from({ length: 500 }, (_, i) => {
      if (i === 0) return '5215500000010,Primero';
      if (i <= 3) return `,Sin${i}`;
      if (i <= 5) return `5215500000010,Rep${i}`;
      return `${5215500001000 + i},N${i}`;
    });
    const p = parseCsvText(`phone,name\n${rows.join('\n')}`, 'v3') as ParsedCsv;
    const v = validateRows(p, 'v3', 'phone');
    expect(v.total).toBe(500);
    expect(v.valid).toHaveLength(495);
    expect(v.invalid.map((x) => x.reason)).toEqual(['Sin teléfono', 'Sin teléfono', 'Sin teléfono', 'Teléfono duplicado', 'Teléfono duplicado']);
  });

  it('salto de línea dentro de un campo ya no invalida la fila; se une en una línea', () => {
    expect(validateRows(parsed('newline.example.csv'), 'v3', 'phone').invalid).toEqual([]);
    expect(validateRows(parsed('newline.example.csv', 'v4'), 'v4', 'phone').invalid).toEqual([]);
    expect(parsed('newline.example.csv').rows.every((r) => r.values.every((v) => !/[\r\n]/.test(v)))).toBe(true);
  });

  it('v4 rechaza filas con columnas de más', () => {
    const p = parseCsvText('phone,name\n5215500000001,Ana,extra\n5215500000002,Beto', 'v4') as ParsedCsv;
    expect(validateRows(p, 'v4', 'phone').invalid).toEqual([{ rowNumber: 2, reason: 'Más columnas que el encabezado' }]);
  });
});

describe('plan de reparto', () => {
  const rowsOf = (n: number) => validateRows(parseCsvText(`phone\n${Array.from({ length: n }, (_, i) => 5215500000100 + i).join('\n')}`, 'v3') as ParsedCsv, 'v3', 'phone').valid;

  it('10 filas entre ana, beto, carla → 4/3/3', () => {
    const plan = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['carla', 'ana', 'beto'], rows: rowsOf(10) }) as Plan;
    expect(plan.agents).toEqual(['ana', 'beto', 'carla']);
    expect(plan.counts).toEqual({ ana: 4, beto: 3, carla: 3 });
    expect(plan.assignment.slice(0, 4)).toEqual(['ana', 'beto', 'carla', 'ana']);
  });

  it('orden por código de punto, no localeCompare', () => {
    expect(agentOrder(['beto', 'Zoe', 'ana'], 'v3')).toEqual(['Zoe', 'ana', 'beto']);
  });

  it('v4: llaves con forma de entero primero (orden de Object.keys)', () => {
    expect(agentOrder(['beto', '123', 'ana', '7'], 'v4')).toEqual(['7', '123', 'ana', 'beto']);
  });

  it('asignar a un agente', () => {
    const plan = buildPlan({ fleet: 'v4', mode: 'single', enabled: ['ana.lopez', 'luis'], agent: 'ana.lopez', rows: rowsOf(5) }) as Plan;
    expect(plan.counts).toEqual({ 'ana.lopez': 5 });
    expect(v4Assignments(plan)).toEqual({ 'ana.lopez': 1 });
  });

  it('sin habilitados → error', () => {
    expect(buildPlan({ fleet: 'v3', mode: 'distribute', enabled: [], rows: rowsOf(2) })).toEqual({ error: 'No hay agentes habilitados en esta campaña para v3' });
  });

  it('assignments > 1500 caracteres', () => {
    const many = Array.from({ length: 120 }, (_, i) => `agente.numero.${i}`);
    expect(assignmentsTooLong(buildPlan({ fleet: 'v4', mode: 'distribute', enabled: many, rows: rowsOf(3) }) as Plan)).toBe(true);
  });

  it('hash determinista y sensible al roster', async () => {
    const rows = rowsOf(6);
    const a = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['ana', 'beto'], rows }) as Plan;
    const b = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['beto', 'ana'], rows }) as Plan;
    const c = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['ana', 'beto', 'carla'], rows }) as Plan;
    expect(await planHash(a, rows)).toBe(await planHash(b, rows));
    expect(await planHash(a, rows)).not.toBe(await planHash(c, rows));
    expect(await planHash(a, rows)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('archivos por agente con encabezado original y solo sus filas', () => {
    const p = parsed('clean.example.csv');
    const rows = validateRows(p, 'v3', 'contact_phone').valid;
    const plan = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['ana', 'beto'], rows }) as Plan;
    const files = agentFiles(p.header, rows, plan);
    expect(files.map((f) => [f.agent, f.rows])).toEqual([
      ['ana', 5],
      ['beto', 5],
    ]);
    expect(files[0]!.csv.split('\n')[0]).toBe('contact_phone,first_name,last_name,total_balance,id_credito');
    expect(validRowsCsv(p.header, rows).trimEnd().split('\n')).toHaveLength(11);
  });

  it('vista previa del mensaje', () => {
    const rec = { contact_phone: '1', first_name: 'Ana', id_credito: 'C-1', total_balance: '10' };
    expect(previewMessage('v3', rec, 'Hola {first_name}, crédito {credit} saldo {total_balance} {nada}')).toBe('Hola Ana, crédito C-1 saldo 10 {nada}');
    expect(previewMessage('v4', { telefono: '1', nombre: 'Ana', mensaje: 'Hola {nombre}' }, '{mensaje}')).toBe('Hola Ana');
  });
});
