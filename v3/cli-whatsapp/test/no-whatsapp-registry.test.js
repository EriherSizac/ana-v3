import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseNoWhatsappPhones,
  localDateKey,
  registryKey,
  loadRegistry,
  saveRegistry,
  pendingPhones,
  markRegistered,
  registrationEnabledFrom,
  buildConsultaInteractions,
  MAX_INTERACTIONS_PER_BATCH,
} from '../no-whatsapp-registry.js';

const HEADER = 'phone,name,first_name,last_name,credit,discount,total_balanc,product,status,error,sent_at,response';

test('CSV con response entrecomillado (comas y saltos de línea) y product con coma', async () => {
  const csv = [
    HEADER,
    '5512345678,Juan,,,C1,,100,"Crédito, auto",no_whatsapp,No tiene WhatsApp,2026-10-26T10:00:00Z,',
    '5598765432,Ana,,,C2,,100,Auto,sent,,2026-10-26T10:01:00Z,"hola, sí\n5511112222,x,,,,,,,no_whatsapp\notra línea"',
    '5533334444,Luis,,,C3,,100,Auto,no_whatsapp,,2026-10-26T10:02:00Z,"dice ""no"""',
  ].join('\n');
  assert.deepEqual(await parseNoWhatsappPhones(csv), ['5512345678', '5533334444']);
});

test('BOM y \\r\\n', async () => {
  const csv = '﻿' + ['Phone,Status', '5215512345678,no_whatsapp', '+52 55 9876 5432,no_whatsapp'].join('\r\n') + '\r\n';
  assert.deepEqual(await parseNoWhatsappPhones(csv), ['5512345678', '5598765432']);
});

test('deduplica por últimos 10 dígitos (521…, +52…, 10 dígitos)', async () => {
  const csv = ['phone,status', '5215512345678,no_whatsapp', '+525512345678,no_whatsapp', '5512345678,no_whatsapp'].join('\n');
  assert.deepEqual(await parseNoWhatsappPhones(csv), ['5512345678']);
});

test('columnas faltantes, archivo vacío, sin filas no_whatsapp', async () => {
  assert.deepEqual(await parseNoWhatsappPhones('name,status\nJuan,no_whatsapp\n'), []);
  assert.deepEqual(await parseNoWhatsappPhones(''), []);
  assert.deepEqual(await parseNoWhatsappPhones(undefined), []);
  assert.deepEqual(await parseNoWhatsappPhones('phone,status\n5512345678,sent\n'), []);
  assert.deepEqual(await parseNoWhatsappPhones('phone,status\n'), []);
});

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ana-nowa-'));

test('registro ausente o JSON inválido ⇒ vacío', () => {
  const dir = tmpDir();
  assert.deepEqual(loadRegistry(path.join(dir, 'no-existe.json')), { version: 1, entries: {} });
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{no json');
  assert.deepEqual(loadRegistry(bad), { version: 1, entries: {} });
  fs.writeFileSync(bad, '[1,2]');
  assert.deepEqual(loadRegistry(bad), { version: 1, entries: {} });
});

test('saveRegistry poda claves de más de 7 días y escribe de forma atómica', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'no-whatsapp-consultas.json');
  const now = new Date('2026-10-26T18:00:00Z');
  const reg = {
    version: 1,
    entries: {
      'erick|camp|2026-10-26': ['5512345678'],
      'erick|camp|2026-10-19': ['5500000001'],
      'erick|camp|2026-10-18': ['5500000002'],
      'basura': ['1'],
    },
  };
  saveRegistry(file, reg, now);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  const loaded = loadRegistry(file);
  assert.deepEqual(Object.keys(loaded.entries).sort(), ['erick|camp|2026-10-19', 'erick|camp|2026-10-26']);
});

test('pendingPhones tras markRegistered y persistencia entre "reinicios"', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'no-whatsapp-consultas.json');
  const now = new Date('2026-10-26T18:00:00Z');
  const key = registryKey('erick', 'camp', now);
  const phones = ['5500000001', '5500000002', '5500000003', '5500000004', '5500000005'];

  let reg = loadRegistry(file);
  assert.deepEqual(pendingPhones(reg, key, phones), phones);
  reg = markRegistered(reg, key, phones.slice(0, 2));
  saveRegistry(file, reg, now);

  const reloaded = loadRegistry(file);
  assert.deepEqual(pendingPhones(reloaded, key, phones), phones.slice(2));

  // Día siguiente: todos pendientes
  const tomorrow = new Date('2026-10-27T18:00:00Z');
  assert.deepEqual(pendingPhones(reloaded, registryKey('erick', 'camp', tomorrow), phones), phones);
  // Otra campaña: todos pendientes
  assert.deepEqual(pendingPhones(reloaded, registryKey('erick', 'otra', now), phones), phones);
});

test('la clave cambia con el día local (America/Mexico_City)', () => {
  // 2026-10-27T01:40Z es todavía 26 de octubre en Ciudad de México
  assert.equal(localDateKey(new Date('2026-10-27T01:40:00Z')), '2026-10-26');
  assert.equal(localDateKey(new Date('2026-10-27T06:05:00Z')), '2026-10-27');
  assert.notEqual(
    registryKey('a', 'c', new Date('2026-10-27T05:59:00Z')),
    registryKey('a', 'c', new Date('2026-10-27T06:00:00Z'))
  );
});

test('buildConsultaInteractions: máximo 200 y comentario no_whatsapp_info_registered', () => {
  const phones = Array.from({ length: 250 }, (_, i) => String(5500000000 + i));
  const list = buildConsultaInteractions({ phones10: phones, campaignName: 'camp', userId: 'u', now: new Date('2026-10-27T01:40:00Z') });
  assert.equal(list.length, MAX_INTERACTIONS_PER_BATCH);
  assert.deepEqual(list[0], {
    credit_id: '',
    campaign_name: 'camp',
    user_id: 'u',
    subdictamen: 'Consulta No Whatsapp',
    contact_date: '2026-10-26',
    contact_time: '19:40',
    range_time: '19:00 - 20:00',
    action_channel: 'whatsapp',
    action: 'whatsapp',
    contactable: false,
    phone_number: '5500000000',
    email_address: null,
    template_used: null,
    comments: 'no_whatsapp_info_registered',
    promise_date: null,
    promise_amount: null,
    promise_payment_plan: null,
    inoutbound: 'inbound',
    payment_made_date: null,
  });
  assert.equal(phones.length - list.length, 50);
});

test('registrationEnabledFrom: solo true estricto', () => {
  assert.equal(registrationEnabledFrom(true), true);
  for (const v of ['true', 1, undefined, null, false, {}, 'yes']) {
    assert.equal(registrationEnabledFrom(v), false, String(v));
  }
});

test('readRegistrationSetting: excepción o getter ausente ⇒ false', async () => {
  const { readRegistrationSetting } = await import('../no-whatsapp-registry.js');
  assert.equal(readRegistrationSetting(() => true), true);
  assert.equal(readRegistrationSetting(() => 'true'), false);
  assert.equal(readRegistrationSetting(() => { throw new Error('x'); }), false);
  assert.equal(readRegistrationSetting(undefined), false);
});
