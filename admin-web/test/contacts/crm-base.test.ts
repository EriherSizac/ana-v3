// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentFiles,
  buildPlan,
  decodeBytes,
  detectDelimiter,
  detectPhoneColumn,
  parseCsvText,
  phoneColumnsOf,
  validateRows,
  type ParsedCsv,
  type Plan,
} from '@/lib/contacts';

// support-crm-base-upload: base CRM tal cual la exporta el CRM (datos ficticios).
const bytes = (name: string) => new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'contacts', name)));
const HEADER = new TextDecoder().decode(bytes('crm-base.example.csv')).split('\r\n', 1)[0]!.split(',');

const parse = (text: string, fleet: 'v3' | 'v4' = 'v3') => {
  const p = parseCsvText(text, fleet);
  if ('error' in p) throw new Error(p.error);
  return p as ParsedCsv;
};

describe('lectura de la base CRM', () => {
  it('conserva las 76 columnas, incluidas pago_minimo.1/.2/.3, y une saltos de línea', () => {
    const { text, encoding } = decodeBytes(bytes('crm-base.example.csv'));
    expect(encoding).toBe('UTF-8');
    const p = parse(text);
    expect(p.header).toHaveLength(76);
    expect(p.header).toEqual(HEADER);
    expect(p.header).toEqual(expect.arrayContaining(['pago_minimo', 'pago_minimo.1', 'pago_minimo.2', 'pago_minimo.3']));
    expect(p.delimiter).toBe(',');
    expect(p.renamed).toEqual([]);
    expect(p.rows).toHaveLength(4);
    expect(p.joinedFields).toBe(2);
    const rec = Object.fromEntries(p.header.map((h, i) => [h, p.rows[0]!.values[i]]));
    expect(rec.comentarios_mejor_historico).toBe('*** *** 0000 SE CONTACTA POR WHATSAPP CLIENTE PROMETE PAGO');
    expect(rec.nombre_cliente).toBe('MARIA  DEL CARMEN ESPÍRITU');
    expect(rec['pago_minimo.1']).toBe('400');
    expect(rec.pago_minimo).toBe('377.3296296');
    expect(rec.hora_ultima_interaccion).toBe('55:27.6');
    expect(p.rows.every((r) => r.values.every((v) => !/[\r\n]/.test(v)))).toBe(true);
  });

  it('BOM: mismo resultado que sin BOM', () => {
    const a = parse(decodeBytes(bytes('crm-base.example.csv')).text);
    const b = parse(decodeBytes(bytes('crm-base-bom.example.csv')).text);
    expect(b.header[0]).toBe('id_credito');
    expect(b).toEqual(a);
  });

  it('Windows-1252: bytes inválidos en UTF-8 se leen como cp1252', () => {
    const utf8 = decodeBytes(bytes('crm-base.example.csv')).text;
    const cp1252 = new Uint8Array(Buffer.from(utf8, 'latin1'));
    const d = decodeBytes(cp1252);
    expect(d.encoding).toBe('Windows-1252');
    expect(d.text).toBe(utf8);
    const p = parse(d.text);
    expect(p.rows[1]!.values[p.header.indexOf('nombre_cliente')]).toBe('José Ñúñez');
  });

  it('detecta delimitador coma, punto y coma y tabulador', () => {
    expect(detectDelimiter('a,b;c\n1,2')).toBe(',');
    expect(detectDelimiter('id_credito;nombre_cliente;telefono_1\n1;2;3')).toBe(';');
    expect(detectDelimiter('"a;b"\tc\td\n')).toBe('\t');
    expect(parse('id_credito;nombre_cliente;telefono_1\n1;Ana;5500000001').header).toEqual(['id_credito', 'nombre_cliente', 'telefono_1']);
  });

  it('pegado de Excel (TSV) con celda entre comillas con salto de línea y tabulador', () => {
    const tsv = 'id_credito\tnombre_cliente\ttelefono_1\tcomentario\n1\tAna\t5500000001\t"línea 1\nlínea\t2 ""ok"""\n2\tBeto\t5500000002\t\n';
    const p = parse(tsv);
    expect(p.delimiter).toBe('\t');
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]!.values[3]).toBe('línea 1 línea\t2 "ok"');
  });

  it('encabezados repetidos se renombran con sufijo .N', () => {
    const p = parse('pago_minimo,telefono_1,pago_minimo,pago_minimo.1,pago_minimo\n1,5500000001,2,3,4');
    expect(p.header).toEqual(['pago_minimo', 'telefono_1', 'pago_minimo.2', 'pago_minimo.1', 'pago_minimo.3']);
    expect(p.renamed).toEqual(['pago_minimo.2', 'pago_minimo.3']);
  });
});

describe('teléfonos de la base CRM', () => {
  const p = parse(decodeBytes(bytes('crm-base.example.csv')).text);

  it('telefono_1/2/3 son columnas de teléfono y v3 las acepta', () => {
    expect(phoneColumnsOf(p.header)).toEqual(['telefono_1', 'telefono_2', 'telefono_3']);
    expect(detectPhoneColumn(p.header, 'v3')).toEqual({ column: 'telefono_1' });
    expect(detectPhoneColumn(p.header, 'v4')).toEqual({ column: 'telefono_1' });
  });

  it('v3: válida si alguna columna tiene teléfono; la fila sin teléfonos es inválida', () => {
    const v = validateRows(p, 'v3', 'telefono_1');
    expect(v.valid.map((r) => r.phone)).toEqual(['5500000001', '5500000003', '55 0000 0004']);
    expect(v.invalid).toEqual([{ rowNumber: 4, reason: 'Sin teléfono' }]);
  });

  it('v3: los archivos por agente conservan todas las columnas y no tienen campos multilínea', () => {
    const v = validateRows(p, 'v3', 'telefono_1');
    const plan = buildPlan({ fleet: 'v3', mode: 'distribute', enabled: ['ana', 'beto'], rows: v.valid }) as Plan;
    const files = agentFiles(p.header, v.valid, plan);
    expect(files.map((f) => f.rows)).toEqual([2, 1]);
    for (const f of files) {
      const lines = f.csv.trimEnd().split('\n');
      expect(lines[0]!.split(',')).toEqual(HEADER);
      expect(lines).toHaveLength(f.rows + 1);
      expect(parse(f.csv).header).toEqual(HEADER);
    }
    expect(files[0]!.csv).toContain('*** *** 0000 SE CONTACTA POR WHATSAPP CLIENTE PROMETE PAGO');
  });
});
