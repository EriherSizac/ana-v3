import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKeyEvent, installKeyPolicy, manualKeyPolicyInitScript } from '../manual-key-policy.js';

const k = (key, code, mods = '') => ({
  key,
  code,
  ctrlKey: mods.includes('c'),
  altKey: mods.includes('a'),
  metaKey: mods.includes('m'),
  shiftKey: mods.includes('s'),
  altGraph: mods.includes('g'),
});
const ED = { editable: true };
const NO = { editable: false };

// [descripción, evento, contexto, esperado]
const CASES = [
  ['F12', k('F12', 'F12'), NO, 'block'],
  ['F1', k('F1', 'F1'), NO, 'block'],
  ['F5', k('F5', 'F5'), NO, 'allow'],
  ['Ctrl+F5', k('F5', 'F5', 'c'), NO, 'allow'],
  ['Ctrl+Shift+I', k('I', 'KeyI', 'cs'), NO, 'block'],
  ['Ctrl+Shift+J', k('J', 'KeyJ', 'cs'), NO, 'block'],
  ['Ctrl+Shift+C', k('C', 'KeyC', 'cs'), NO, 'block'],
  ['Ctrl+Shift+I en editable', k('I', 'KeyI', 'cs'), ED, 'block'],
  ['Ctrl+Shift+C en editable', k('C', 'KeyC', 'cs'), ED, 'block'],
  ['Ctrl+Shift+i minúscula', k('i', 'KeyI', 'cs'), ED, 'block'],
  ['Ctrl+Shift+j minúscula sin code', k('j', '', 'cs'), NO, 'block'],
  ['Cmd+Alt+I', k('I', 'KeyI', 'ma'), NO, 'block'],
  ['Ctrl+U', k('u', 'KeyU', 'c'), ED, 'block'],
  ['Ctrl+S', k('s', 'KeyS', 'c'), ED, 'block'],
  ['Ctrl+P', k('p', 'KeyP', 'c'), ED, 'block'],
  ['Ctrl+O', k('o', 'KeyO', 'c'), ED, 'block'],
  ['Alt+ArrowLeft', k('ArrowLeft', 'ArrowLeft', 'a'), ED, 'block'],
  ['Alt+ArrowRight', k('ArrowRight', 'ArrowRight', 'a'), NO, 'block'],
  ['AltGr+Q (ctrl+alt) → @', k('@', 'KeyQ', 'ca'), ED, 'allow-isolated'],
  ['AltGr+Q (solo altGraph) → @', k('@', 'KeyQ', 'g'), ED, 'allow-isolated'],
  ['AltGr+Digit2 → @', k('@', 'Digit2', 'ca'), ED, 'allow-isolated'],
  ['AltGr+Digit3 → #', k('#', 'Digit3', 'ca'), ED, 'allow-isolated'],
  ['AltGr+KeyE → €', k('€', 'KeyE', 'ca'), ED, 'allow-isolated'],
  ['AltGr+Dead', k('Dead', 'BracketLeft', 'ca'), ED, 'allow-isolated'],
  ['AltGr+Minus → \\', k('\\', 'Minus', 'cag'), ED, 'allow-isolated'],
  ['Ctrl+Alt+KeyE → e (US)', k('e', 'KeyE', 'ca'), ED, 'block'],
  ['Ctrl+Alt+KeyN → n (US)', k('n', 'KeyN', 'ca'), NO, 'block'],
  ['Ctrl+Alt+Digit2 → 2 (US)', k('2', 'Digit2', 'ca'), ED, 'block'],
  ['Ctrl+Alt+Backspace', k('Backspace', 'Backspace', 'ca'), ED, 'block'],
  ['Meta+Alt+@', k('@', 'KeyQ', 'ma'), ED, 'block'],
  ['Alt+Numpad6', k('6', 'Numpad6', 'a'), ED, 'allow'],
  ['Alt+Numpad4', k('4', 'Numpad4', 'a'), ED, 'allow'],
  ['Control solo', k('Control', 'ControlLeft', 'c'), NO, 'allow'],
  ['Alt solo', k('Alt', 'AltLeft', 'a'), NO, 'allow'],
  ['AltGraph solo', k('AltGraph', 'AltRight', 'cag'), NO, 'allow'],
  ['Shift solo', k('Shift', 'ShiftLeft', 's'), NO, 'allow'],
  ['Ctrl+V en editable', k('v', 'KeyV', 'c'), ED, 'allow'],
  ['Ctrl+C en editable', k('c', 'KeyC', 'c'), ED, 'allow'],
  ['Ctrl+X en editable', k('x', 'KeyX', 'c'), ED, 'allow'],
  ['Ctrl+A en editable', k('a', 'KeyA', 'c'), ED, 'allow'],
  ['Ctrl+Z en editable', k('z', 'KeyZ', 'c'), ED, 'allow'],
  ['Ctrl+Y en editable', k('y', 'KeyY', 'c'), ED, 'allow'],
  ['Cmd+V en editable', k('v', 'KeyV', 'm'), ED, 'allow'],
  ['Ctrl+Shift+Z en editable', k('Z', 'KeyZ', 'cs'), ED, 'allow'],
  ['Ctrl+Shift+V en editable', k('V', 'KeyV', 'cs'), ED, 'allow'],
  ['Ctrl+Shift+A en editable', k('A', 'KeyA', 'cs'), ED, 'block'],
  ['Ctrl+ArrowLeft en editable', k('ArrowLeft', 'ArrowLeft', 'c'), ED, 'allow'],
  ['Ctrl+Shift+ArrowRight en editable', k('ArrowRight', 'ArrowRight', 'cs'), ED, 'allow'],
  ['Ctrl+Backspace en editable', k('Backspace', 'Backspace', 'c'), ED, 'allow'],
  ['Ctrl+Delete en editable', k('Delete', 'Delete', 'c'), ED, 'allow'],
  ['Ctrl+Home en editable', k('Home', 'Home', 'c'), ED, 'allow'],
  ['Ctrl+C fuera de editable', k('c', 'KeyC', 'c'), NO, 'block'],
  ['Ctrl+A fuera de editable', k('a', 'KeyA', 'c'), NO, 'block'],
  ['Ctrl+Z fuera de editable', k('z', 'KeyZ', 'c'), NO, 'block'],
  ['Ctrl+V fuera de editable', k('v', 'KeyV', 'c'), NO, 'block'],
  ['Ctrl+Alt+V en editable', k('v', 'KeyV', 'ca'), ED, 'block'],
  ['Ctrl+N', k('n', 'KeyN', 'c'), ED, 'block'],
  ['a sin modificadores', k('a', 'KeyA'), NO, 'allow'],
  ['A con Shift', k('A', 'KeyA', 's'), ED, 'allow'],
  ['Enter', k('Enter', 'Enter'), ED, 'allow'],
  ['Escape', k('Escape', 'Escape'), NO, 'allow'],
];

for (const [desc, ev, ctx, expected] of CASES) {
  test(`${desc} → ${expected}`, () => {
    assert.equal(classifyKeyEvent(ev, ctx), expected);
  });
}

test('evento vacío o sin contexto no lanza', () => {
  assert.equal(classifyKeyEvent({}, undefined), 'allow');
  assert.equal(classifyKeyEvent(undefined, undefined), 'allow');
});

test('classifyKeyEvent reconstruida desde toString() da los mismos resultados', () => {
  // eslint-disable-next-line no-new-func
  const rebuilt = new Function('return (' + classifyKeyEvent.toString() + ')')();
  for (const [desc, ev, ctx, expected] of CASES) {
    assert.equal(rebuilt(ev, ctx), expected, desc);
  }
});

function fakeWindow() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn, capture) {
      listeners[type] = { fn, capture };
    },
  };
}

function fakeEvent(ev, target) {
  const calls = { prevented: false, stopped: false };
  return {
    calls,
    ...ev,
    target,
    composedPath: () => [target],
    getModifierState: (m) => (m === 'AltGraph' ? Boolean(ev.altGraph) : false),
    preventDefault() { calls.prevented = true; },
    stopImmediatePropagation() { calls.stopped = true; },
  };
}

test('el init script instala keydown y contextmenu en window (captura) y aplica decisiones', () => {
  const window = fakeWindow();
  // eslint-disable-next-line no-new-func
  new Function('window', manualKeyPolicyInitScript())(window);
  assert.equal(window.listeners.keydown.capture, true);
  assert.equal(window.listeners.contextmenu.capture, true);

  const box = { isContentEditable: true, tagName: 'DIV' };
  const body = { isContentEditable: false, tagName: 'BODY' };

  const blocked = fakeEvent(k('F12', 'F12'), body);
  window.listeners.keydown.fn(blocked);
  assert.deepEqual(blocked.calls, { prevented: true, stopped: true });

  const isolated = fakeEvent(k('@', 'KeyQ', 'cag'), box);
  window.listeners.keydown.fn(isolated);
  assert.deepEqual(isolated.calls, { prevented: false, stopped: true });

  const paste = fakeEvent(k('v', 'KeyV', 'c'), box);
  window.listeners.keydown.fn(paste);
  assert.deepEqual(paste.calls, { prevented: false, stopped: false });

  const pasteOutside = fakeEvent(k('v', 'KeyV', 'c'), body);
  window.listeners.keydown.fn(pasteOutside);
  assert.deepEqual(pasteOutside.calls, { prevented: true, stopped: true });

  const input = fakeEvent(k('a', 'KeyA', 'c'), { tagName: 'INPUT', type: 'text' });
  window.listeners.keydown.fn(input);
  assert.deepEqual(input.calls, { prevented: false, stopped: false });

  const menu = fakeEvent({}, body);
  window.listeners.contextmenu.fn(menu);
  assert.equal(menu.calls.prevented, true);
});

test('installKeyPolicy bloquea si classify lanza', () => {
  const window = fakeWindow();
  globalThis.window = window;
  try {
    installKeyPolicy(() => { throw new Error('x'); });
    const e = fakeEvent(k('a', 'KeyA'), { tagName: 'DIV' });
    window.listeners.keydown.fn(e);
    assert.equal(e.calls.prevented, true);
  } finally {
    delete globalThis.window;
  }
});
