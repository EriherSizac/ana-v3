import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssignmentCsv } from '../assignment-csv.js';

/**
 * link-review-contacts-to-uploads 1.3: la columna `ana_upload_id` (última
 * columna que agrega la carga de ANA Admin) no altera el mensaje interpolado
 * ni los campos de resultados.csv, y se conserva en la fila original
 * (`__raw`), que es lo que se reporta en `review`.
 */

// Columnas fijas de resultados.csv (csv-utils.js, saveResults).
const RESULT_FIELDS = ['phone', 'name', 'first_name', 'last_name', 'credit', 'discount', 'total_balanc', 'product'];

const BASE =
  'phone_number,first_name,total_balance,id_credito,message\n' +
  '5215500000001,Ana,100,C-1,"Hola {first_name}, crédito {id}, saldo {total_balance}"\n' +
  '5215500000002,Beto,200,C-2,Hola {first_name} {credit}\n';

const withUploadId = (csv, id) =>
  csv
    .trimEnd()
    .split('\n')
    .map((l, i) => (i === 0 ? `${l},ana_upload_id` : `${l},${id}`))
    .join('\n') + '\n';

test('mismo mensaje interpolado y mismos campos de resultados.csv con y sin ana_upload_id', () => {
  const without = parseAssignmentCsv(BASE);
  const withCol = parseAssignmentCsv(withUploadId(BASE, '20261026T1530-ab12cd34'));
  assert.equal(withCol.length, without.length);
  for (let i = 0; i < without.length; i++) {
    assert.equal(withCol[i].message, without[i].message);
    for (const f of RESULT_FIELDS) assert.equal(withCol[i][f], without[i][f], `campo ${f}`);
  }
  // {id} resuelve contra id_credito (primera columna que lo contiene), no contra ana_upload_id.
  assert.match(without[0].message, /crédito C-1/);
});

test('__raw (fila original reportada en review) conserva ana_upload_id', () => {
  const [c] = parseAssignmentCsv(withUploadId(BASE, '20261026T1530-ab12cd34'));
  assert.equal(c.__raw.ana_upload_id, '20261026T1530-ab12cd34');
  assert.equal(Object.keys(c).includes('__raw'), false, 'no enumerable');
});
