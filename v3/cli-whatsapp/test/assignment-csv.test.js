import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssignmentCsv } from '../assignment-csv.js';

test('parsea comillas, comas, saltos de línea y comillas escapadas', () => {
  const csv = [
    'phone_number,contact_name,message,id_credito',
    '5512345678,"Pérez, Juan","Hola\nsegunda ""línea""",C1',
    '5598765432,Ana,Hola,C2',
  ].join('\r\n');
  const contacts = parseAssignmentCsv(csv);
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts[0], {
    phone: '5512345678',
    name: 'Pérez, Juan',
    message: 'Hola\nsegunda "línea"',
    credit: 'C1',
  });
  assert.equal(contacts[1].name, 'Ana');
});

test('descarta filas incompletas', () => {
  const csv = 'phone_number,contact_name,message\n5512345678,Juan,Hola\n5598765432,Ana\n';
  const contacts = parseAssignmentCsv(csv);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].phone, '5512345678');
});

test('CSV sin filas de datos', () => {
  assert.deepEqual(parseAssignmentCsv('phone_number,message'), []);
  assert.deepEqual(parseAssignmentCsv(''), []);
});

test('renderiza el mensaje final del CSV en una sola pasada', () => {
  const csv = [
    'phone_number,contact_name,first_name,total_balance,message',
    '5512345678,Juan Pérez,Juan,1500,"Hola {{name}} {first_name}, saldo {{total_balance}} / {{total_balance * 0.5}} / {{contact_name}}"',
  ].join('\n');
  const [contact] = parseAssignmentCsv(csv);
  assert.equal(contact.message, 'Hola Juan Pérez Juan, saldo 1500 / 750 / Juan Pérez');
});
