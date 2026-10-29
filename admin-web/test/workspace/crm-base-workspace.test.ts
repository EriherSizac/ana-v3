// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { agentFiles, buildPlan, parseCsvText, sendColumnError, validateRows, validRowsCsv, v4PhoneColumn, type ParsedCsv, type Plan } from '@/lib/contacts';
import { defaultPhoneColumn, loadFile, mergeFiles, renderRow, unknownMarkers } from '@/lib/workspace';
import { buildPublication } from '../../../v3/ana-backend/src/lib/publication';
import { parseAssignmentCsv as backendParse } from '../../../v3/ana-backend/src/lib/assignmentCsv';

// support-crm-base-upload: la base CRM en "Mi asignación" y en v4.
const cliDir = join(__dirname, '..', '..', '..', 'v3', 'cli-whatsapp');
const cliTemplate = (await import(/* @vite-ignore */ pathToFileURL(join(cliDir, 'template-utils.js')).href)) as {
  renderTemplate: (t: string, s: { fields?: object; raw?: object }) => string;
};

const text = readFileSync(join(__dirname, '..', 'fixtures', 'contacts', 'crm-base.example.csv'), 'utf8');
const parsed = parseCsvText(text, 'v3') as ParsedCsv;
const valid = validateRows(parsed, 'v3', 'telefono_1').valid;
const plan = buildPlan({ fleet: 'v3', mode: 'single', enabled: ['ana'], agent: 'ana', rows: valid }) as Plan;
// Archivo pendiente como lo deja la carga de administración (+ ana_upload_id).
const pendingCsv = agentFiles(parsed.header, valid, plan)[0]!.csv;
const merged = mergeFiles([loadFile('k', 'e', pendingCsv)]);

describe('Mi asignación con la base CRM', () => {
  it('preselecciona telefono_1 y conserva las 76 columnas', () => {
    expect(merged.header).toHaveLength(76);
    expect(defaultPhoneColumn(merged.header)).toBe('telefono_1');
  });

  it('{{nombre_cliente}}, {{saldo_vencido_actual}} y {{pago_minimo.1}} resuelven; el valor se inserta tal cual', () => {
    const r = merged.rows[0]!;
    const out = renderRow('Hola {{nombre_cliente}}, vencido {{saldo_vencido_actual}}, mínimo {{pago_minimo.1}} / {{pago_minimo}}', merged.header, r.record, '5500000001');
    expect(out.unresolved).toEqual([]);
    expect(out.text).toBe('Hola MARIA  DEL CARMEN ESPÍRITU, vencido 10187.9, mínimo 400 / 377.3296296');
    expect(unknownMarkers('{{pago_minimo.1}} {{id_credito}} {{credit}}', merged.header, merged.rows)).toEqual([]);
  });

  it('expresiones con columnas .N: la columna completa, igual que el CLI y el backend', () => {
    const r = merged.rows[0]!;
    const tpl = 'Paga {{pago_minimo.1*0.5}} o {{pago_minimo*1}} o {{pago_minimo.2 + 1}}';
    const out = renderRow(tpl, merged.header, r.record, '5500000001');
    expect(out.text).toBe('Paga 200 o 377.33 o 411.50');
    expect(cliTemplate.renderTemplate(tpl, { fields: r.record, raw: r.record })).toBe(out.text);
    const pub = buildPublication([backendParse(pendingCsv)], [[0]], tpl, ['telefono_1']);
    expect(pub.rows[0]![pub.header.indexOf('message')]).toBe(out.text);
  });

  it('una columna .N inexistente conserva el comportamiento anterior (base seguida de .N)', () => {
    expect(cliTemplate.renderTemplate('{{a.5*2}}', { fields: { a: '1' }, raw: { a: '1' } })).toBe('3');
    expect(renderRow('{{saldo_total.5*2}}', ['saldo_total'], { saldo_total: '10' }, '').text).toBe('21');
  });
});

describe('v4 con la base CRM: teléfono de envío', () => {
  const p4 = parseCsvText(text, 'v4') as ParsedCsv;

  it('telefono_1 elegida: fallback por fila a telefono_2/3 y columna telefono_envio', () => {
    const v = validateRows(p4, 'v4', 'telefono_1');
    expect(v.valid.map((r) => r.phone)).toEqual(['5500000001', '5500000003', '55 0000 0004']);
    expect(v.invalid.map((r) => r.reason)).toEqual(['Sin teléfono']);
    const csv = validRowsCsv(p4.header, v.valid, 'telefono_1');
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]!.split(',')).toEqual([...p4.header, 'telefono_envio']);
    expect(lines[2]!.endsWith(',5500000003')).toBe(true);
    expect(v4PhoneColumn('telefono_1')).toBe('telefono_envio');
    expect(v4PhoneColumn('telefono')).toBe('telefono');
  });

  it('otra columna elegida: sin fallback ni columna extra', () => {
    const csv = parseCsvText('telefono,telefono_2\n,5500000001\n5500000002,\n', 'v4') as ParsedCsv;
    const v = validateRows(csv, 'v4', 'telefono');
    expect(v.valid).toHaveLength(1);
    expect(validRowsCsv(csv.header, v.valid, 'telefono').split('\n')[0]).toBe('telefono,telefono_2');
  });

  it('telefono_envio ya presente con fallback → bloqueado', () => {
    expect(sendColumnError(['telefono_1', 'telefono_envio'], 'v4', 'telefono_1')).toBe('La columna telefono_envio está reservada en v4');
    expect(sendColumnError(['telefono_1', 'telefono_envio'], 'v3', 'telefono_1')).toBeNull();
  });
});
