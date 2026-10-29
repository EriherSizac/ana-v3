import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadContacts, validateFiles } from '../src/handlers/adminContacts';
import { parseAssignmentCsv } from '../src/lib/assignmentCsv';
import { creditKeyOf, duplicateCredit } from '../src/lib/contactsCsv';
import { buildPublication } from '../src/lib/publication';
import { installCondS3, type CondS3 } from './helpers/condS3';
import { ADMIN, adminEvent, derivedList, mockV4Me, parse } from './helpers/admin';

// support-crm-base-upload: "Créditos duplicados en la carga v3" y "Publicación por crédito".
const s3mock = mockClient(S3Client);
let s3: CondS3;

beforeEach(() => {
  s3mock.reset();
  process.env.BUCKET_NAME = 'ana-backend-storage-test';
  s3 = installCondS3(s3mock);
  s3.set('campaign-agents/prueba.json', derivedList('prueba', ['ana.lopez', 'beto.ruiz']));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('crédito de la fila', () => {
  it('primer alias no vacío, sin espacios ni mayúsculas', () => {
    expect(creditKeyOf({ credit: '', id_credito: ' Ab 12 ' })).toBe('ab12');
    expect(creditKeyOf({ credito: 'X1', id_credito: 'Y2' })).toBe('x1');
    expect(creditKeyOf({ phone: '5500000001' })).toBe('');
  });
});

describe('duplicateCredit', () => {
  it('mismo crédito en el mismo archivo o entre archivos', () => {
    expect(duplicateCredit(['id_credito,phone\n123,5500000001\n123,5500000002\n'])).toBe('123');
    expect(duplicateCredit(['id_credito,phone\n123,5500000001\n', 'credit,phone\n 123 ,5500000009\n'])).toBe('123');
    expect(duplicateCredit(['id_credito,phone\nAB1,5500000001\nab1,5500000002\n'])).toBe('ab1');
  });
  it('mismo teléfono con créditos distintos, filas sin crédito o sin columna → sin duplicado', () => {
    expect(duplicateCredit(['id_credito,phone\n123,5500000001\n456,5500000001\n'])).toBeNull();
    expect(duplicateCredit(['id_credito,phone\n,5500000001\n,5500000001\n'])).toBeNull();
    expect(duplicateCredit(['phone\n5500000001\n5500000001\n'])).toBeNull();
  });
  it('respeta comillas y saltos de línea dentro de campos', () => {
    expect(duplicateCredit(['nota,id_credito,phone\n"a,\nb",7,5500000001\n"c",7,5500000002\n'])).toBe('7');
  });
});

describe('POST /admin/campaigns/{campaign}/contacts con créditos repetidos', () => {
  const body = (files: Array<{ agent: string; csv: string }>) => ({ uploadId: '20261029T100000-abcdef12', fileName: 'base.csv', mode: 'distribute', files });

  it('validateFiles devuelve "Crédito duplicado: <crédito>"', () => {
    expect(validateFiles({ files: [{ agent: 'ana.lopez', csv: 'id_credito,phone\n1,5500000001\n1,5500000002\n' }] })).toBe('Crédito duplicado: 1');
  });

  it('dos archivos con el mismo crédito → 400 sin escribir archivos', async () => {
    mockV4Me(ADMIN);
    const before = s3.store.size;
    const res = await uploadContacts(
      adminEvent({
        path: { campaign: 'prueba' },
        body: body([
          { agent: 'ana.lopez', csv: 'id_credito,phone\n123,5500000001\n' },
          { agent: 'beto.ruiz', csv: 'id_credito,phone\n123,5500000002\n' },
        ]),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toBe('Crédito duplicado: 123');
    expect(s3.store.size).toBe(before);
  });

  it('mismo teléfono con créditos distintos → 200 con las dos filas', async () => {
    mockV4Me(ADMIN);
    const res = await uploadContacts(
      adminEvent({ path: { campaign: 'prueba' }, body: { ...body([{ agent: 'ana.lopez', csv: 'id_credito,phone\n123,5500000001\n456,5500000001\n' }]), mode: 'single' } }),
    );
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.totalRows).toBe(2);
  });
});

describe('publicación por crédito', () => {
  it('mismo teléfono con créditos distintos → una fila por crédito', () => {
    const p = parseAssignmentCsv('id_credito,phone\n123,5500000001\n456,5500000001\n');
    const built = buildPublication([p], [[0, 1]], 'Hola {{credit}}', ['phone']);
    expect(built.rows.map((r) => [r[0], r[1]])).toEqual([
      ['5500000001', '123'],
      ['5500000001', '456'],
    ]);
  });

  it('mismo crédito y teléfono en dos archivos → una sola fila', () => {
    const a = parseAssignmentCsv('id_credito,phone\n123,5500000001\n');
    const b = parseAssignmentCsv('id_credito,phone\n 123 ,55 0000 0001\n');
    expect(buildPublication([a, b], [[0], [0]], 'Hola', ['phone']).rows).toHaveLength(1);
  });

  it('sin crédito → el teléfono no se repite (comportamiento anterior)', () => {
    const p = parseAssignmentCsv('phone,name\n5500000001,Ana\n5500000001,Ana bis\n');
    expect(buildPublication([p], [[0, 1]], 'Hola', ['phone']).rows).toHaveLength(1);
  });

  it('mismo crédito con dos columnas de teléfono iguales → una sola fila', () => {
    const p = parseAssignmentCsv('id_credito,telefono_1,telefono_2\n1,5500000001,5500000001\n');
    expect(buildPublication([p], [[0]], 'Hola', ['telefono_1', 'telefono_2']).rows).toHaveLength(1);
  });
});
