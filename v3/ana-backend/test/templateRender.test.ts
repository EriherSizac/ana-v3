import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contactSources, parseAssignmentCsv, serializeCsv } from '../src/lib/assignmentCsv';
import { renderTemplate, renderTemplateDetailed } from '../src/lib/templateRender';

/** add-agent-workspace 1.1: los ports TS deben comportarse como los módulos reales del CLI. */
const cliDir = join(__dirname, '..', '..', 'cli-whatsapp');
const cliTemplate = (await import(/* @vite-ignore */ pathToFileURL(join(cliDir, 'template-utils.js')).href)) as {
  renderTemplate: (t: string, s: { fields?: object; raw?: object }) => string;
};
const cliCsv = (await import(/* @vite-ignore */ pathToFileURL(join(cliDir, 'assignment-csv.js')).href)) as {
  parseAssignmentCsv: (t: string) => Array<Record<string, string>>;
};

const FIXTURE = [
  '﻿contact_phone,first_name,last_name,total_balance,descuento,id_credito,ana_upload_id',
  '5215500000001,Ana,López,1000,0.2,C-1,U1',
  '"5215500000002","Beto, el ""Grande""",Ruiz,250.5,0.1,C-2,U1',
  '5215500000003,Carla,,abc,,C-3,',
  '5215500000004,Incompleta',
  '',
  '5215500000005,"Dana',
  'multi",Paz,10,0,C-5,U2',
].join('\r\n');

const TEMPLATES = [
  'Hola {{first_name}}, debes {{total_balance}}',
  'Hola {first_name} {last_name}, crédito {credit}',
  'Paga {{total_balance*0.8}} o {{total_balance * (1 - descuento)}}',
  'Línea 1\\nLínea 2 {{name}} {{phone}}',
  'Desconocida {{apodo}} y {apodo} y {{x+1}}',
  'Parcial {balance} {credito} {upload}',
  '{{ first_name }} {{last_name}} {message}',
];

describe('parseAssignmentCsv ≡ CLI', () => {
  it('mismas filas válidas y mismos valores por columna', () => {
    const mine = parseAssignmentCsv(FIXTURE);
    const cli = cliCsv.parseAssignmentCsv(FIXTURE);
    const valid = mine.rows.filter((r) => r.valid);
    expect(valid).toHaveLength(cli.length);
    valid.forEach((r, i) => {
      const { fields } = contactSources(mine.header, r.values);
      const c = cli[i]!;
      for (const [k, v] of Object.entries(fields)) expect(String(c[k] ?? ''), k).toBe(v);
    });
    expect(mine.rows.find((r) => r.index === 3)!.valid).toBe(false);
    expect(mine.header[0]).toBe('contact_phone');
  });

  it('conserva el texto original de cada fila (incluidas comillas y saltos dentro de comillas)', () => {
    const mine = parseAssignmentCsv(FIXTURE);
    expect(mine.rows[1]!.raw).toBe('"5215500000002","Beto, el ""Grande""",Ruiz,250.5,0.1,C-2,U1');
    expect(mine.rows[4]!.raw).toBe('5215500000005,"Dana\r\nmulti",Paz,10,0,C-5,U2');
  });

  it('serializeCsv produce un CSV que el CLI lee con los mismos valores', () => {
    const csv = serializeCsv(['phone_number', 'first_name', 'message'], [['5215500000009', 'Eva, "la" grande', 'Hola\\nqué tal']]);
    const [c] = cliCsv.parseAssignmentCsv(csv);
    expect(c!.first_name).toBe('Eva, "la" grande');
    expect(c!.message).toBe('Hola\nqué tal');
  });
});

describe('renderTemplate ≡ CLI', () => {
  const parsed = parseAssignmentCsv(FIXTURE);
  for (const tpl of TEMPLATES) {
    it(tpl, () => {
      for (const r of parsed.rows.filter((x) => x.valid)) {
        const s = contactSources(parsed.header, r.values);
        expect(renderTemplate(tpl, s)).toBe(cliTemplate.renderTemplate(tpl, s));
      }
    });
  }

  it('reporta los marcadores sin resolver', () => {
    const s = contactSources(['phone', 'first_name'], ['5215500000001', 'Ana']);
    expect(renderTemplateDetailed('Hola {{first_name}} {{apodo}} {apodo} {{apodo}}', s).unresolved).toEqual(['{{apodo}}', '{apodo}']);
    expect(renderTemplateDetailed('Hola {{first_name}} {{name}}', s).unresolved).toEqual([]);
  });

  it('expresión y \\n literal', () => {
    const s = contactSources(['phone', 'first_name', 'total_balance'], ['1', 'Ana', '1000']);
    expect(renderTemplate('Hola {{first_name}}, paga {{total_balance*0.5}}\\nGracias', s)).toBe('Hola Ana, paga 500\nGracias');
  });
});
