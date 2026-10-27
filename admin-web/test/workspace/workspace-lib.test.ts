// @vitest-environment node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contactSources,
  defaultPhoneColumn,
  firstMessage,
  loadFile,
  maskPhone,
  mergeFiles,
  parseAssignmentCsv,
  phonesFor,
  publishSources,
  renderRow,
  renderTemplate,
  unknownMarkers,
  unknownMarkersError,
} from '@/lib/workspace';
// Lo que de verdad publica v3:
import { buildPublication } from '../../../v3/ana-backend/src/lib/publication';
import { parseAssignmentCsv as backendParse } from '../../../v3/ana-backend/src/lib/assignmentCsv';

/** add-agent-workspace 2.2: vista previa ≡ CLI v3 ≡ publicación del backend. */
const cliDir = join(__dirname, '..', '..', '..', 'v3', 'cli-whatsapp');
const cliTemplate = (await import(/* @vite-ignore */ pathToFileURL(join(cliDir, 'template-utils.js')).href)) as {
  renderTemplate: (t: string, s: object) => string;
};
const cliCsv = (await import(/* @vite-ignore */ pathToFileURL(join(cliDir, 'assignment-csv.js')).href)) as {
  parseAssignmentCsv: (t: string) => Array<Record<string, string>>;
};

const F1 = 'phone_number,first_name,total_balance,ana_upload_id\n5215500000001,Ana,1000,U1\n"5215500000002","Beto, el ""Grande""",250.5,U1\n5215500000003,Incompleta\n';
const F2 = '﻿telefono_1,telefono_2,first_name,message\r\n5215500000010,5215500000011,Dana,Hola {first_name}\r\n5215500000001,,Ana bis,x\r\n';

const TEMPLATES = ['Hola {{first_name}}, paga {{total_balance*0.8}}', 'Hola {first_name}\\nSaldo {total_balance}', '{{name}} {{phone}} {credit}', 'Raro {{apodo}} {upload}'];

describe('parser y render ≡ CLI', () => {
  it('mismas filas válidas y valores que el CLI', () => {
    for (const text of [F1, F2]) {
      const mine = parseAssignmentCsv(text);
      const cli = cliCsv.parseAssignmentCsv(text);
      const valid = mine.rows.filter((r) => r.valid);
      expect(valid).toHaveLength(cli.length);
      valid.forEach((r, i) => {
        const { fields } = contactSources(mine.header, r.values);
        for (const [k, v] of Object.entries(fields)) if (k !== 'message') expect(String(cli[i]![k] ?? ''), k).toBe(v);
      });
    }
  });

  it.each(TEMPLATES)('renderTemplate %s', (tpl) => {
    const p = parseAssignmentCsv(F1);
    for (const r of p.rows.filter((x) => x.valid)) {
      const s = contactSources(p.header, r.values);
      expect(renderTemplate(tpl, s)).toBe(cliTemplate.renderTemplate(tpl, s));
    }
  });
});

describe('vista previa ≡ publicación del backend', () => {
  const files = [loadFile('k1', 'e1', F1), loadFile('k2', 'e2', F2)];
  const merged = mergeFiles(files);

  it('combina encabezados en orden y rellena columnas faltantes', () => {
    expect(merged.header).toEqual(['phone_number', 'first_name', 'total_balance', 'ana_upload_id', 'telefono_1', 'telefono_2', 'message']);
    expect(merged.rows.map((r) => r.id)).toEqual(['0:0', '0:1', '0:2', '1:0', '1:1']);
    expect(merged.rows[3]!.record).toMatchObject({ phone_number: '', telefono_1: '5215500000010', first_name: 'Dana' });
    expect(merged.rows[2]!.valid).toBe(false);
  });

  it.each(['Hola {{first_name}}', 'Hola {first_name}\nSaldo {{total_balance}}', '{{name}} {{phone}} {{first_name}} {message}'])('mensaje por teléfono igual al del archivo publicado (%s)', (tpl) => {
    const phoneColumns = ['phone_number', 'telefono_1', 'telefono_2'];
    const selected = merged.rows.filter((r) => r.valid);
    const phones = phonesFor(selected, phoneColumns);
    const preview = selected.flatMap((r) => phones.get(r.id)!.map((p) => [p, renderRow(tpl, merged.header, r.record, p).text.replace(/\r\n|\r|\n/g, '\\n')]));
    const backend = buildPublication(
      [backendParse(F1), backendParse(F2)],
      publishSources(files, selected).map((s) => s.rows),
      tpl,
      phoneColumns,
    );
    const msgIdx = backend.header.indexOf('message');
    expect(backend.rows.map((r) => [r[0], r[msgIdx]])).toEqual(preview);
  });

  it('una expresión sin valor en alguna fila bloquea en la vista previa y en el backend', () => {
    const tpl = 'Paga {{total_balance*0.8}}';
    const selected = merged.rows.filter((r) => r.valid);
    expect(unknownMarkers(tpl, merged.header, selected)).toEqual(['{{total_balance*0.8}}']);
    expect(() => buildPublication([backendParse(F1), backendParse(F2)], publishSources(files, selected).map((s) => s.rows), tpl, ['phone_number', 'telefono_1'])).toThrow(
      expect.objectContaining({ status: 400, message: 'Variable desconocida: {{total_balance*0.8}}' }),
    );
  });

  it('teléfonos: ≥ 10 dígitos y sin repetir entre archivos', () => {
    const phones = phonesFor(merged.rows.filter((r) => r.valid), ['phone_number', 'telefono_1', 'telefono_2']);
    expect(phones.get('0:0')).toEqual(['5215500000001']);
    expect(phones.get('1:0')).toEqual(['5215500000010', '5215500000011']);
    expect(phones.get('1:1')).toEqual([]);
  });

  it('marcadores desconocidos (incluido {upload} contra ana_upload_id)', () => {
    expect(unknownMarkers('Raro {{apodo}} {upload} {{first_name}}', merged.header, merged.rows)).toEqual(['{{apodo}}', '{upload}']);
    expect(unknownMarkersError(['{{apodo}}'])).toBe('Variable desconocida: {{apodo}}');
    expect(unknownMarkers('Hola {{first_name}}', merged.header, [])).toEqual([]);
  });

  it('publishSources agrupa índices por archivo', () => {
    expect(publishSources(files, [merged.rows[1]!, merged.rows[0]!, merged.rows[4]!])).toEqual([
      { key: 'k1', etag: 'e1', rows: [0, 1] },
      { key: 'k2', etag: 'e2', rows: [1] },
    ]);
  });

  it('columna por defecto, máscara y primer mensaje', () => {
    expect(defaultPhoneColumn(['contact_phone', 'x', 'phone_number'])).toBe('phone_number');
    expect(defaultPhoneColumn(['telefono_1', 'telefono_2'])).toBe('telefono_1');
    expect(defaultPhoneColumn(['nombre'])).toBeNull();
    expect(maskPhone('5215512345678')).toBe('**5678');
    expect(firstMessage(merged.rows)).toBe('Hola {first_name}');
  });
});
