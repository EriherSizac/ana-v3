import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate } from '../template-utils.js';
import { replaceVariables } from '../message-utils.js';

const render = (tpl, fields = {}, raw = fields) => renderTemplate(tpl, { fields, raw });

test('{{name}} produce el valor sin llaves residuales', () => {
  assert.equal(render('Hola {{name}}', { name: 'Juan' }), 'Hola Juan');
});

test('{first_name} simple', () => {
  assert.equal(render('Hola {first_name}', { first_name: 'Ana' }), 'Hola Ana');
});

test('mezcla de llaves simples y dobles', () => {
  assert.equal(
    render('Hola {first_name}, debes {{total_balance}}', { first_name: 'Ana', total_balance: '1500' }),
    'Hola Ana, debes 1500'
  );
});

test('coincidencia parcial de llaves simples por columna original', () => {
  assert.equal(render('Hola {cliente}', {}, { nombre_cliente: 'Pedro' }), 'Hola Pedro');
});

test('{foo} inexistente queda literal', () => {
  assert.equal(render('x {foo} y', { name: 'Juan' }), 'x {foo} y');
});

test('{{monto}} inexistente queda literal', () => {
  assert.equal(render('Paga {{monto}}', { name: 'Juan' }), 'Paga {{monto}}');
});

test('{{total_balance}} desde la columna total_balance', () => {
  assert.equal(render('{{total_balance}}', { total_balance: '1500' }), '1500');
});

test('{{total_balanc}} heredado desde total_balanc', () => {
  assert.equal(render('{{total_balanc}}', { total_balanc: '850' }), '850');
  assert.equal(render('{{total_balance}}', { total_balanc: '850' }), '850');
});

test('{{product}} ausente se reemplaza por vacío', () => {
  assert.equal(render('P:{{product}}.', { name: 'Juan' }), 'P:.');
});

test('{{contact_name}} por columna original del CSV', () => {
  assert.equal(render('{{contact_name}}', { name: 'Juan Pérez' }, { contact_name: 'Juan Pérez' }), 'Juan Pérez');
});

test('un valor con llaves no se reinterpreta', () => {
  assert.equal(render('Hola {{name}}', { name: '{first_name}', first_name: 'Ana' }), 'Hola {first_name}');
  assert.equal(render('Hola {name}', { name: '{{first_name}}', first_name: 'Ana' }), 'Hola {{first_name}}');
});

test('expresión {{total_balance * 0.5}} = 500', () => {
  assert.equal(render('{{total_balance * 0.5}}', { total_balance: '1000' }), '500');
});

test('expresión {{total_balance / 3}} = 33.33', () => {
  assert.equal(render('{{total_balance / 3}}', { total_balance: '100' }), '33.33');
});

test('expresión con identificador inexistente queda literal', () => {
  assert.equal(render('{{saldo_x * 2}}', { total_balance: '100' }), '{{saldo_x * 2}}');
});

test('expresión resuelve identificadores contra columnas originales', () => {
  assert.equal(render('{{saldo * 2}}', {}, { saldo: '10' }), '20');
});

test('coma de miles se interpreta como decimal (comportamiento existente)', () => {
  assert.equal(render('{{total_balance * 2}}', { total_balance: '1,500' }), '3');
});

test('llaves sueltas se envían sin cambios', () => {
  assert.equal(render('Total: { y } fin', { name: 'Juan' }), 'Total: { y } fin');
  assert.equal(render('Total: {', {}), 'Total: {');
  assert.equal(render('}{', {}), '}{');
});

test('{{{name}}} produce {Juan}', () => {
  assert.equal(render('{{{name}}}', { name: 'Juan' }), '{Juan}');
});

test('\\n literal se convierte en salto de línea', () => {
  assert.equal(render('Hola\\nAdiós', {}), 'Hola\nAdiós');
});

test('{message} simple no se sustituye con el propio mensaje', () => {
  assert.equal(render('a {message} b', { message: 'X' }, {}), 'a {message} b');
});

test('plantilla vacía o nula', () => {
  assert.equal(renderTemplate(undefined), '');
  assert.equal(renderTemplate(null), '');
  assert.equal(renderTemplate(''), '');
});

test('replaceVariables es envoltorio de renderTemplate', () => {
  assert.equal(replaceVariables('Hola {{name}} {first_name}', { name: 'Juan', first_name: 'Ana' }), 'Hola Juan Ana');
});

// support-crm-base-upload: columnas con sufijo .N de la base CRM (pago_minimo.1).
test('{{pago_minimo.1}} y expresiones con la columna .N completa', () => {
  const row = { pago_minimo: '377', 'pago_minimo.1': '400' };
  assert.equal(render('Mínimo {{pago_minimo.1}}', row), 'Mínimo 400');
  assert.equal(render('{{pago_minimo.1*0.5}}', row), '200');
  assert.equal(render('{{pago_minimo*1}}', row), '377');
  // Columna .N inexistente: como antes, la base seguida de .N.
  assert.equal(render('{{pago_minimo.5*2}}', row), '755');
});
