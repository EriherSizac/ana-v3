import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, digitsOnly, phone10ForWhatsappUrl, domSafetyInitScript } from '../dom-safety.js';

test('escapa los cinco caracteres', () => {
  assert.equal(escapeHtml(`<a "x">&'`), '&lt;a &quot;x&quot;&gt;&amp;&#39;');
});

test('null, undefined, números y objetos', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(12.5), '12.5');
  assert.equal(escapeHtml({}), '[object Object]');
  assert.equal(escapeHtml({ toString: () => '<b>' }), '&lt;b&gt;');
});

test('texto ya escapado se escapa de nuevo', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('payloads XSS', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('"><svg onload=x()>'), '&quot;&gt;&lt;svg onload=x()&gt;');
  assert.ok(!/[<>"']/.test(escapeHtml(`"'><script>x()</script>`)));
});

test('digitsOnly', () => {
  assert.equal(digitsOnly('+52 (55) 1234-5678'), '525512345678');
  assert.equal(digitsOnly(null), '');
});

test('phone10ForWhatsappUrl', () => {
  assert.equal(phone10ForWhatsappUrl('521551234567"8'), '5512345678');
  assert.equal(phone10ForWhatsappUrl('+52 1 55 1234 5678'), '5512345678');
  assert.equal(phone10ForWhatsappUrl('5512345678'), '5512345678');
  assert.equal(phone10ForWhatsappUrl('12345'), '');
  assert.equal(phone10ForWhatsappUrl(''), '');
  assert.equal(phone10ForWhatsappUrl(undefined), '');
});

test('las funciones reconstruidas desde toString() producen la misma salida', () => {
  for (const fn of [escapeHtml, digitsOnly, phone10ForWhatsappUrl]) {
    // eslint-disable-next-line no-new-func
    const rebuilt = new Function('return (' + fn.toString() + ')')();
    for (const input of ['<a "x">&\'', '521551234567"8', null, 42, '12345']) {
      assert.equal(rebuilt(input), fn(input));
    }
  }
});

test('domSafetyInitScript define window.__anaDomSafety', () => {
  const window = {};
  // eslint-disable-next-line no-new-func
  new Function('window', domSafetyInitScript())(window);
  assert.equal(typeof window.__anaDomSafety.escapeHtml, 'function');
  assert.equal(window.__anaDomSafety.escapeHtml('<'), '&lt;');
  assert.equal(window.__anaDomSafety.phone10ForWhatsappUrl('5215512345678'), '5512345678');
});
