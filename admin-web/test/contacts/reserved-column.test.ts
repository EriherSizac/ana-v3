// @vitest-environment node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasReservedColumn, unknownVariableError, variablesResolvingToUploadId } from '@/lib/contacts';

const root = join(__dirname, '..', '..', '..');
const { parseAssignmentCsv } = (await import(/* @vite-ignore */ pathToFileURL(join(root, 'v3', 'cli-whatsapp', 'assignment-csv.js')).href)) as {
  parseAssignmentCsv: (t: string) => Array<Record<string, string>>;
};

const UPLOAD = '20261026T1530-ab12cd34';

describe('columna reservada ana_upload_id', () => {
  it('se detecta sin distinguir mayúsculas', () => {
    expect(hasReservedColumn(['phone', 'ANA_UPLOAD_ID'])).toBe(true);
    expect(hasReservedColumn(['phone', 'upload'])).toBe(false);
  });

  it('{upload} → error; {first_name} → válido; {id} con id_credito → válido', () => {
    const header = ['phone_number', 'first_name', 'id_credito'];
    expect(variablesResolvingToUploadId(['Hola {upload}'], header)).toEqual(['upload']);
    expect(unknownVariableError(['upload'])).toBe('Variable desconocida: {upload}');
    expect(variablesResolvingToUploadId(['Hola {first_name}'], header)).toEqual([]);
    expect(variablesResolvingToUploadId(['Crédito {id}'], header)).toEqual([]);
    expect(variablesResolvingToUploadId(['Crédito {id}'], ['phone_number', 'first_name'])).toEqual(['id']);
    // Llaves dobles no usan coincidencia parcial.
    expect(variablesResolvingToUploadId(['{{upload}}'], header)).toEqual([]);
  });

  it('equivalencia con el CLI: lo marcado como error es justo lo que tomaría el uploadId', () => {
    const csv = (message: string, header = 'phone_number,first_name,id_credito') =>
      `${header},message,ana_upload_id\n5215500000001,Ana,C-1,"${message}",${UPLOAD}\n`;
    const render = (message: string, header?: string) => parseAssignmentCsv(csv(message, header))[0]!.message!;
    expect(render('Hola {upload}')).toContain(UPLOAD);
    expect(render('Hola {first_name}')).toBe('Hola Ana');
    expect(render('Crédito {id}')).toBe('Crédito C-1');
    expect(render('Crédito {id}', 'phone_number,first_name,otra')).toContain(UPLOAD);
    for (const [msg, header] of [
      ['Hola {upload}', 'phone_number,first_name,id_credito'],
      ['Hola {first_name}', 'phone_number,first_name,id_credito'],
      ['Crédito {id}', 'phone_number,first_name,id_credito'],
      ['Crédito {id}', 'phone_number,first_name,otra'],
    ] as const) {
      const flagged = variablesResolvingToUploadId([msg], [...header.split(','), 'message']).length > 0;
      expect(flagged, `${msg} / ${header}`).toBe(render(msg, header).includes(UPLOAD));
    }
  });
});
