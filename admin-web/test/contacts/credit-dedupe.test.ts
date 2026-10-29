// support-crm-base-upload "Duplicados por crédito" y "Publicación por crédito".
import { describe, expect, it } from 'vitest';
import { normalizeCredit, parseCsvText, validateRows, type Fleet, type ParsedCsv } from '@/lib/contacts';
import { creditKeyOf, phonesFor, type MergedRow } from '@/lib/workspace';

const validate = (csv: string, fleet: Fleet = 'v3', phone = 'phone') => validateRows(parseCsvText(csv, fleet) as ParsedCsv, fleet, phone);

describe.each<Fleet>(['v3', 'v4'])('validación por crédito (%s)', (fleet) => {
  it('mismo crédito con teléfonos distintos → la primera válida, la segunda "Crédito duplicado"', () => {
    const v = validate('id_credito,phone\n123,5500000001\n123,5500000002\n', fleet);
    expect(v.valid.map((r) => r.rowNumber)).toEqual([2]);
    expect(v.invalid).toEqual([{ rowNumber: 3, reason: 'Crédito duplicado' }]);
  });

  it('mismo teléfono con créditos distintos → ambas válidas', () => {
    const v = validate('id_credito,phone\n123,5500000001\n456,5500000001\n', fleet);
    expect(v.valid.map((r) => r.record.id_credito)).toEqual(['123', '456']);
    expect(v.invalid).toEqual([]);
  });

  it('sin columna de crédito → fallback por teléfono', () => {
    const v = validate('phone,name\n5500000001,A\n5500000001,B\n', fleet);
    expect(v.invalid).toEqual([{ rowNumber: 3, reason: 'Teléfono duplicado' }]);
  });

  it('filas sin crédito solo se comparan por teléfono entre ellas', () => {
    const v = validate('id_credito,phone\n123,5500000001\n,5500000001\n,5500000001\n', fleet);
    expect(v.valid.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(v.invalid).toEqual([{ rowNumber: 4, reason: 'Teléfono duplicado' }]);
  });

  it('alias credit/credito/credit_id y normalización (espacios, mayúsculas)', () => {
    expect(validate('credit,phone\nAB 1,5500000001\nab1,5500000002\n', fleet).invalid).toEqual([{ rowNumber: 3, reason: 'Crédito duplicado' }]);
    expect(validate('credito,phone\n7,5500000001\n 7 ,5500000002\n', fleet).invalid).toEqual([{ rowNumber: 3, reason: 'Crédito duplicado' }]);
    expect(validate('credit_id,phone\n7,5500000001\n7,5500000002\n', fleet).invalid).toEqual([{ rowNumber: 3, reason: 'Crédito duplicado' }]);
    // Primer alias no vacío: credit vacío → id_credito.
    expect(validate('credit,id_credito,phone\n,9,5500000001\n9,,5500000002\n', fleet).invalid).toEqual([{ rowNumber: 3, reason: 'Crédito duplicado' }]);
  });

  it('una fila inválida no reserva su crédito', () => {
    const v = validate('id_credito,phone\n123,\n123,5500000001\n', fleet);
    expect(v.invalid).toEqual([{ rowNumber: 2, reason: 'Sin teléfono' }]);
    expect(v.valid.map((r) => r.rowNumber)).toEqual([3]);
  });

  it('base CRM: id_credito repetido con otro telefono_N', () => {
    const v = validateRows(
      parseCsvText('id_credito,nombre_cliente,telefono_1,telefono_2\n1,ANA,5500000001,\n1,ANA,,5500000002\n2,ANA,5500000001,\n', fleet) as ParsedCsv,
      fleet,
      'telefono_1',
    );
    expect(v.valid.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(v.invalid).toEqual([{ rowNumber: 3, reason: 'Crédito duplicado' }]);
  });
});

describe('normalizeCredit', () => {
  it('quita espacios y minúsculas', () => {
    expect(normalizeCredit(' Ab 12\t')).toBe('ab12');
  });
});

describe('publicación por crédito (vista previa de Mi asignación)', () => {
  const row = (id: string, record: Record<string, string>): MergedRow => ({ id, file: 0, index: 0, record, valid: true });

  it('creditKeyOf usa el primer alias no vacío', () => {
    expect(creditKeyOf({ credit: '', id_credito: ' X 1 ' })).toBe('x1');
    expect(creditKeyOf({ phone: '1' })).toBe('');
  });

  it('mismo teléfono con créditos distintos → un teléfono por crédito', () => {
    const phones = phonesFor([row('a', { id_credito: '1', phone: '5500000001' }), row('b', { id_credito: '2', phone: '5500000001' })], ['phone']);
    expect(phones.get('a')).toEqual(['5500000001']);
    expect(phones.get('b')).toEqual(['5500000001']);
  });

  it('mismo crédito y teléfono → una sola vez', () => {
    const phones = phonesFor([row('a', { id_credito: '1', phone: '5500000001' }), row('b', { id_credito: '1', phone: '55 0000 0001' })], ['phone']);
    expect(phones.get('b')).toEqual([]);
  });

  it('sin crédito → no repite teléfono', () => {
    const phones = phonesFor([row('a', { phone: '5500000001' }), row('b', { phone: '5500000001' })], ['phone']);
    expect(phones.get('b')).toEqual([]);
  });
});
