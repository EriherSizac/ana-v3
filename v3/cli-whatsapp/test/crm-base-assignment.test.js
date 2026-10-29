import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssignmentCsv } from '../assignment-csv.js';

// support-crm-base-upload: archivo publicado desde "Mi asignación" con columnas de la base CRM
// (sin campos multilínea, telefono_N conservadas, id_credito → credit).
const CSV = [
  'phone_number,id_credito,nombre_cliente,telefono_1,telefono_2,pago_minimo.1,comentarios_mejor_historico,message,ana_upload_id',
  '5500000001,900000001,MARIA  ESPÍRITU,5500000001,5500000002,400,*** 0000 SE CONTACTA POR WHATSAPP,"Hola MARIA  ESPÍRITU, mínimo 400",U1',
  '5500000002,900000001,MARIA  ESPÍRITU,5500000001,5500000002,400,*** 0000 SE CONTACTA POR WHATSAPP,"Hola MARIA  ESPÍRITU, mínimo 400",U1',
].join('\n');

test('el CLI parsea el archivo publicado de la base CRM', () => {
  const contacts = parseAssignmentCsv(CSV);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].phone, '5500000001');
  assert.equal(contacts[1].phone, '5500000002');
  assert.equal(contacts[0].credit, '900000001');
  assert.equal(contacts[0]['pago_minimo.1'], '400');
  assert.equal(contacts[0].message, 'Hola MARIA  ESPÍRITU, mínimo 400');
  assert.equal(contacts[0].__raw.ana_upload_id, 'U1');
});
