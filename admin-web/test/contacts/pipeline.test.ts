// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  agentFiles,
  buildPlan,
  convertExcelValue,
  detectPhoneColumn,
  excelSerialToDate,
  excelFractionToTime,
  parseCsvText,
  planHash,
  validateRows,
  type ParsedCsv,
} from '@/lib/contacts';
import { ContactsSession, handleRequest, type Progress, type WorkerResponse } from '@/lib/contacts/pipeline';
import { createContactsProcessor, type WorkerLike } from '@/lib/contacts/processor';
import { parseAssignmentCsv } from '@/lib/workspace/csv';
import { splitMaster } from '../../../v3/ana-backend/src/lib/contactsSource';
import { convertExcelValue as backendConvert } from '../../../v3/ana-backend/src/lib/excelDates';

// support-crm-base-upload: "Procesamiento en segundo plano", "Carga v3 grande por S3" y "Fechas de Excel".

const rowsCsv = (n: number, header = 'id_credito,telefono_1,nombre_cliente,fecha_corte') =>
  header + '\n' + Array.from({ length: n }, (_, i) => `${i + 1},${5215500000000 + i},Cliente ${i},45961`).join('\n') + '\n';

describe('ContactsSession (lógica del Worker con progreso)', () => {
  it('lectura → validación → reparto con progreso monótono por fase hasta el total', async () => {
    const s = new ContactsSession();
    const seen: Progress[] = [];
    const read = s.read({ fleet: 'v3', text: rowsCsv(5_000) }, (p) => seen.push(p));
    expect(read).toMatchObject({ rows: 5_000, phoneColumns: ['telefono_1'], convertedDates: 5_000 });
    const check = s.check(null, (p) => seen.push(p));
    expect(check).toMatchObject({ validCount: 5_000, invalidCount: 0, phoneColumn: 'telefono_1' });
    const plan = await s.plan({ mode: 'distribute', enabled: ['b', 'a'] }, (p) => seen.push(p));
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.plan.counts).toEqual({ a: 2_500, b: 2_500 });
    expect(plan.samples.a).toHaveLength(5);
    expect(plan.samples.a![0]).toEqual({ rowNumber: 2, phone: '5215500000000', name: 'Cliente 0', credit: '1' });
    for (const phase of ['lectura', 'validación', 'reparto'] as const) {
      const ps = seen.filter((p) => p.phase === phase);
      expect(ps.length).toBeGreaterThan(0);
      expect(ps.at(-1)!.done).toBe(ps.at(-1)!.total);
      for (let i = 1; i < ps.length; i++) expect(ps[i]!.done).toBeGreaterThanOrEqual(ps[i - 1]!.done);
    }
    expect(seen.filter((p) => p.phase === 'lectura').some((p) => p.done === 2_000 && p.total === 5_000)).toBe(true);
  });

  it('mismo hash y plan que las funciones del navegador/BFF', async () => {
    const csv = rowsCsv(30);
    const s = new ContactsSession();
    s.read({ fleet: 'v3', text: csv });
    s.check(null);
    const res = await s.plan({ mode: 'distribute', enabled: ['x', 'y', 'z'] });
    if ('error' in res) throw new Error(res.error);
    const parsed = parseCsvText(csv, 'v3') as ParsedCsv;
    const valid = validateRows(parsed, 'v3', 'telefono_1').valid;
    const plan = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['x', 'y', 'z'], rows: valid });
    if ('error' in plan) throw new Error(plan.error);
    expect(res.hash).toBe(await planHash(plan, valid));
    expect(res.payload).toEqual({ kind: 'inline', csv });
  });

  it('v3 de más de 4 MB → CSV maestro por S3 equivalente a la carga en línea (mismos archivos y hash en la Lambda)', async () => {
    const header = 'id_credito,telefono_1,telefono_2,nombre_cliente,comentario,fecha_corte,saldo';
    const lines = Array.from({ length: 60_000 }, (_, i) =>
      i % 997 === 0 ? `${i},,,Sin telefono,x,45961,1` : `${i},${i % 3 ? 5215500000000 + i : ''},${5215600000000 + i},"Nombre ${i}","coma, y ""comillas""",45961.5,45961`,
    );
    const csv = header + '\r\n' + lines.join('\r\n');
    expect(new TextEncoder().encode(csv).length).toBeGreaterThan(4 * 1024 * 1024);
    const s = new ContactsSession();
    s.read({ fleet: 'v3', text: csv });
    const check = s.check(null);
    if ('error' in check) throw new Error(check.error);
    expect(check.invalidCount).toBe(Math.ceil(60_000 / 997));
    const enabled = ['ana', 'beto', 'carla'];
    const res = await s.plan({ mode: 'distribute', enabled });
    if ('error' in res) throw new Error(res.error);
    expect(res.payload.kind).toBe('s3');
    if (res.payload.kind !== 's3') return;
    const master = await res.payload.blob.text();
    expect(res.payload.bytes).toBe(res.payload.blob.size);
    // Lo que haría la carga en línea con el mismo archivo.
    const parsed = parseCsvText(csv, 'v3') as ParsedCsv;
    const phone = detectPhoneColumn(parsed.header, 'v3') as { column: string };
    const valid = validateRows(parsed, 'v3', phone.column).valid;
    const plan = buildPlan({ fleet: 'v3', mode: 'distribute', enabled, rows: valid });
    if ('error' in plan) throw new Error(plan.error);
    const inline = agentFiles(parsed.header, valid, plan).map(({ agent, csv: c }) => ({ agent, csv: c }));
    // Lo que hace la Lambda con el CSV maestro.
    const split = splitMaster(master, res.plan.agents, 'distribute');
    if ('error' in split) throw new Error(split.error);
    expect(split.files).toEqual(inline);
    expect(split.hash).toBe(res.hash);
    expect(split.counts).toEqual(res.plan.counts);
    expect(master).toContain(',31/10/2025,45961\n');
  });

  it('errores de tamaño con el sujeto correcto', () => {
    const s = new ContactsSession();
    expect(s.read({ fleet: 'v4', text: 'a'.repeat(11 * 1024 * 1024), what: 'El texto pegado' })).toEqual({ error: 'El texto pegado supera 10 MB para v4' });
    expect(s.read({ fleet: 'v3', text: '   ', what: 'El texto pegado' })).toEqual({ error: 'El texto pegado está vacío' });
  });

  it('handleRequest responde progreso y resultado con el id del mensaje', async () => {
    const out: WorkerResponse[] = [];
    await handleRequest(new ContactsSession(), { id: 7, type: 'read', input: { fleet: 'v3', text: rowsCsv(3) } }, (r) => out.push(r));
    expect(out.every((r) => r.id === 7)).toBe(true);
    expect(out.at(-1)).toMatchObject({ type: 'result', result: { rows: 3 } });
    expect(out.some((r) => r.type === 'progress')).toBe(true);
  });
});

describe('createContactsProcessor', () => {
  it('sin Worker usa el hilo principal con progreso', async () => {
    const p = createContactsProcessor(() => null);
    const seen: Progress[] = [];
    const read = await p.read({ fleet: 'v3', text: rowsCsv(10) }, (x) => seen.push(x));
    expect(read).toMatchObject({ rows: 10 });
    expect(await p.check(null)).toMatchObject({ validCount: 10 });
    expect(seen.length).toBeGreaterThan(0);
  });

  it('con Worker: reenvía progreso, resuelve el resultado y cancelar termina el Worker', async () => {
    const posted: any[] = [];
    let terminated = 0;
    const fake: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (m) => posted.push(m),
      terminate: () => {
        terminated++;
      },
    };
    const p = createContactsProcessor(() => fake);
    const seen: Progress[] = [];
    const pending = p.read({ fleet: 'v3', text: 'x' }, (x) => seen.push(x));
    const id = posted[0].id;
    fake.onmessage!({ data: { id, type: 'progress', progress: { phase: 'lectura', done: 1, total: 2 } } } as MessageEvent);
    fake.onmessage!({ data: { id, type: 'result', result: { rows: 1 } } } as MessageEvent);
    expect(await pending).toEqual({ rows: 1 });
    expect(seen).toEqual([{ phase: 'lectura', done: 1, total: 2 }]);
    const next = p.check(null);
    p.cancel();
    await expect(next).rejects.toMatchObject({ name: 'CancelledError' });
    expect(terminated).toBe(1);
  });
});

describe('Fechas de Excel', () => {
  it('serie 1900 con el 29/02/1900 ficticio, 45961 y decimales con hora', () => {
    expect(excelSerialToDate(60)).toBe('29/02/1900');
    expect(excelSerialToDate(61)).toBe('01/03/1900');
    expect(excelSerialToDate(45959)).toBe('29/10/2025');
    expect(excelSerialToDate(45961)).toBe('31/10/2025');
    expect(convertExcelValue('fecha_ultimo_pago_historico', '45961.999')).toBe('31/10/2025');
    expect(convertExcelValue('hora_ultima_gestion', '0.5208333333')).toBe('12:30:00');
    expect(excelFractionToTime(0.999999)).toBe('00:00:00');
  });

  it('no toca columnas que no son de fecha ni valores ya formateados', () => {
    expect(convertExcelValue('saldo_total', '45961')).toBe('45961');
    expect(convertExcelValue('pago_minimo.1', '45961')).toBe('45961');
    expect(convertExcelValue('fecha_apertura', '29/10/2025')).toBe('29/10/2025');
    expect(convertExcelValue('fecha_apertura', '100')).toBe('100');
  });

  it('mismo resultado que el backend v3', () => {
    for (const [h, v] of [
      ['fecha_corte', '45961'],
      ['fecha_corte', '45961.25'],
      ['hora_x', '0.25'],
      ['saldo', '45961'],
      ['fecha_corte', 'abc'],
    ] as const) {
      expect(convertExcelValue(h, v)).toBe(backendConvert(h, v));
    }
  });

  it('pegado/archivo: parseCsvText convierte y cuenta; "Mi asignación" muestra fechas de cargas anteriores', () => {
    const parsed = parseCsvText('telefono_1\tfecha_corte\tsaldo\n5215500000001\t45961\t45961\n', 'v3') as ParsedCsv;
    expect(parsed.rows[0]!.values).toEqual(['5215500000001', '31/10/2025', '45961']);
    expect(parsed.convertedDates).toBe(1);
    const a = parseAssignmentCsv('phone_number,fecha_corte,saldo\n5215500000001,45961,45961\n');
    expect(a.rows[0]!.values).toEqual(['5215500000001', '31/10/2025', '45961']);
  });
});
