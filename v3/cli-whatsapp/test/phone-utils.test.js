import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneUtils, phone, phoneUtilsInitScript } from '../phone-utils.js';

// Oráculos: copias de las implementaciones previas al cambio
const oldCrmSearch = (rawPhone) => {
  // agent-config.js normalizePhoneForBackend
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+52${digits}`;
  if (digits.startsWith('521') && digits.length === 13) return `+52${digits.slice(3)}`;
  if (digits.startsWith('52') && digits.length === 12) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
};
const oldBackupKey = (rawPhone) => {
  // whatsapp-manual.js (respaldo automático / historial "Ver")
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (normalized.length === 10) normalized = '521' + normalized;
  if (normalized.startsWith('521') && normalized.length === 13) return normalized;
  if (normalized.startsWith('52') && !normalized.startsWith('521') && normalized.length === 12) {
    normalized = '521' + normalized.slice(2);
  }
  return normalized;
};
const oldLast10 = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

const CASES = [
  // raw, url, crm, gestion, last10, backup
  ['5512345678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['525512345678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['5215512345678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['+525512345678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['+52 1 55 1234 5678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['+52 (55) 1234-5678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['55-1234-5678', '525512345678', '+525512345678', '+525512345678', '5512345678', '5215512345678'],
  ['14155550100', '14155550100', '+14155550100', '', '4155550100', '14155550100'],
  ['+1 415 555 0100', '14155550100', '+14155550100', '', '4155550100', '14155550100'],
  ['0445512345678', '0445512345678', '+0445512345678', '', '5512345678', '0445512345678'],
  ['52155123456789', '52155123456789', '+52155123456789', '', '5123456789', '52155123456789'],
  ['', '', '', '', '', ''],
  [null, '', '', '', '', ''],
  [undefined, '', '', '', '', ''],
  ['sin dígitos', '', '', '', '', ''],
];

for (const [raw, url, crm, gestion, last10, backup] of CASES) {
  test(`salidas para ${JSON.stringify(raw)}`, () => {
    assert.equal(phone.toWhatsAppUrlPhone(raw), url, 'url');
    assert.equal(phone.toCrmSearchPhone(raw), crm, 'crm');
    assert.equal(phone.toGestionCrmPhone(raw), gestion, 'gestion');
    assert.equal(phone.toLast10(raw), last10, 'last10');
    assert.equal(phone.toBackupKeyPhone(raw), backup, 'backup');
  });
}

test('CRM, respaldo y últimos 10 coinciden con las implementaciones anteriores', () => {
  const extra = ['521234567890', '5255123456789', '5212345678', '123', '+52 55 1234 5678'];
  for (const raw of [...CASES.map((c) => c[0]), ...extra]) {
    assert.equal(phone.toCrmSearchPhone(raw), oldCrmSearch(raw), `crm ${raw}`);
    assert.equal(phone.toBackupKeyPhone(raw), oldBackupKey(raw), `backup ${raw}`);
    assert.equal(phone.toLast10(raw), oldLast10(raw), `last10 ${raw}`);
  }
});

test('parseMxPhone reconoce solo longitudes exactas', () => {
  assert.deepEqual(phone.parseMxPhone('5215512345678'), { digits: '5215512345678', national10: '5512345678' });
  assert.deepEqual(phone.parseMxPhone('0445512345678'), { digits: '0445512345678', national10: null });
});

test('createPhoneUtils es autocontenida (evaluada en aislamiento)', () => {
  // eslint-disable-next-line no-new-func
  const isolated = Function('"use strict"; return (' + createPhoneUtils.toString() + ')()')();
  for (const [raw, url, crm, gestion, last10, backup] of CASES) {
    assert.equal(isolated.toWhatsAppUrlPhone(raw), url);
    assert.equal(isolated.toCrmSearchPhone(raw), crm);
    assert.equal(isolated.toGestionCrmPhone(raw), gestion);
    assert.equal(isolated.toLast10(raw), last10);
    assert.equal(isolated.toBackupKeyPhone(raw), backup);
  }
});

test('el init script define window.__anaPhone', () => {
  const window = {};
  // eslint-disable-next-line no-new-func
  Function('window', phoneUtilsInitScript())(window);
  assert.equal(window.__anaPhone.toBackupKeyPhone('5512345678'), '5215512345678');
});
