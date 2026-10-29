import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeRows, uploadContacts, validateFiles } from '../src/handlers/adminContacts';
import { parseAssignmentCsv } from '../src/lib/assignmentCsv';
import { headerColumns, isPhoneColumnName, singleLineRows } from '../src/lib/contactsCsv';
import { buildPublication } from '../src/lib/publication';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, adminEvent, derivedList, mockV4Me, parse } from './helpers/admin';

// support-crm-base-upload: la base CRM (datos ficticios del fixture de ANA Admin).
const FIXTURE = readFileSync(join(__dirname, '..', '..', '..', 'admin-web', 'test', 'fixtures', 'contacts', 'crm-base-bom.example.csv'), 'utf8');
const HEADER = FIXTURE.replace(/^﻿/, '').split('\r\n', 1)[0]!.split(',');
const cliCsv = (await import(/* @vite-ignore */ pathToFileURL(join(__dirname, '..', '..', 'cli-whatsapp', 'assignment-csv.js')).href)) as {
  parseAssignmentCsv: (t: string) => Array<Record<string, string>>;
};

const s3mock = mockClient(S3Client);
let s3: CondS3;

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez']));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('columnas y filas de la base CRM', () => {
  it('telefono_N y telefono son columnas de teléfono; celular no', () => {
    expect(['telefono_1', 'telefono_12', 'phone_2', 'telefono', 'phone_number'].every(isPhoneColumnName)).toBe(true);
    expect(isPhoneColumnName('celular')).toBe(false);
    expect(headerColumns(FIXTURE)).toEqual(HEADER);
    expect(validateFiles({ files: [{ agent: 'ana.lopez', csv: FIXTURE }] })).toBeNull();
    expect(validateFiles({ files: [{ agent: 'ana.lopez', csv: 'nombre,saldo\nAna,1' }] })).toBe('ana.lopez: falta columna de teléfono');
  });

  it('filas lógicas: saltos de línea dentro de comillas → espacio; filas sin salto quedan igual', () => {
    const rows = singleLineRows(FIXTURE);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => !/[\r\n]/.test(r))).toBe(true);
    expect(rows[1]).toContain('*** *** 0000 SE CONTACTA POR WHATSAPP CLIENTE PROMETE PAGO');
    expect(rows[2]).toBe(FIXTURE.replace(/^﻿/, '').split('\r\n')[2]);
    expect(normalizeRows('phone\n\n1\n').csv).toBe('phone\n1\n');
  });
});

describe('POST /admin/campaigns/{campaign}/contacts con la base CRM', () => {
  it('escribe el archivo sin campos multilínea, con todas las columnas, y el CLI lo parsea', async () => {
    mockV4Me(ADMIN);
    const res = await uploadContacts(
      adminEvent({ path: { campaign: 'prueba' }, body: { uploadId: '20261029T100000-abcdef12', fileName: 'base.csv', mode: 'single', files: [{ agent: 'ana.lopez', csv: FIXTURE }] } }),
    );
    expect(res.statusCode).toBe(200);
    const m = parse(res).data;
    expect(m.totalRows).toBe(4);
    const body = s3.store.get(m.perAgent[0].key)!.body;
    const lines = body.trimEnd().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]!.split(',')).toEqual([...HEADER, 'ana_upload_id']);
    const parsed = parseAssignmentCsv(body);
    expect(parsed.rows.every((r) => r.valid)).toBe(true);
    const cli = cliCsv.parseAssignmentCsv(body);
    expect(cli).toHaveLength(4);
    expect(cli[0]!.credit).toBe('900000001');
    expect(cli[0]!.telefono_1).toBe('5500000001');
    expect(cli[0]!['pago_minimo.1']).toBe('400');
    expect(cli[0]!.comentarios_mejor_historico).toBe('*** *** 0000 SE CONTACTA POR WHATSAPP CLIENTE PROMETE PAGO');
    expect(cli[3]!.ana_upload_id).toBe('20261029T100000-abcdef12');
  });
});

describe('publicación de la base CRM', () => {
  it('telefono_1 y telefono_2, sin campos multilínea, y el CLI lo parsea con crédito', () => {
    // Pendiente "antiguo" con un salto de línea dentro de comillas.
    const pending = parseAssignmentCsv('id_credito,nombre_cliente,telefono_1,telefono_2,comentario\n1,ANA  LOPEZ,5500000001,5500000002,"uno\ndos"\n2,Beto,,5500000003,ok\n');
    const built = buildPublication([pending], [[0, 1]], 'Hola {{nombre_cliente}}, crédito {{credit}}', ['telefono_1', 'telefono_2']);
    expect(built.rows.map((r) => r[0])).toEqual(['5500000001', '5500000002', '5500000003']);
    expect(built.header).toEqual(['phone_number', 'id_credito', 'nombre_cliente', 'telefono_1', 'telefono_2', 'comentario', 'message', 'ana_upload_id']);
    expect(built.rows[0]![5]).toBe('uno dos');
    expect(built.rows.flat().every((v) => !/[\r\n]/.test(v))).toBe(true);
    const csv = [built.header, ...built.rows].map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
    const cli = cliCsv.parseAssignmentCsv(csv);
    expect(cli).toHaveLength(3);
    expect(cli[0]!.message).toBe('Hola ANA  LOPEZ, crédito 1');
    expect(cli[2]!.credit).toBe('2');
  });
});

describe('variables con sufijo .N (pago_minimo.1)', () => {
  it('el backend renderiza igual que el CLI', async () => {
    const { renderTemplate } = await import('../src/lib/templateRender');
    const cliTemplate = (await import(/* @vite-ignore */ pathToFileURL(join(__dirname, '..', '..', 'cli-whatsapp', 'template-utils.js')).href)) as {
      renderTemplate: (t: string, s: { fields?: object; raw?: object }) => string;
    };
    const row = { pago_minimo: '377.3296296', 'pago_minimo.1': '400', saldo: '10' };
    for (const tpl of ['{{pago_minimo.1}}', '{{pago_minimo.1*0.5}}', '{{pago_minimo*1}}', '{{saldo.5*2}}', '{{pago_minimo.1 + saldo}}']) {
      expect(renderTemplate(tpl, { fields: row, raw: row })).toBe(cliTemplate.renderTemplate(tpl, { fields: row, raw: row }));
    }
    expect(renderTemplate('{{pago_minimo.1*0.5}}', { fields: row, raw: row })).toBe('200');
  });
});
