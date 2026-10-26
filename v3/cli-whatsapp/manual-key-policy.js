/**
 * Política de teclado de la ventana manual (módulo puro).
 *
 * Denegación por defecto con excepciones explícitas de escritura (AltGr, códigos Alt,
 * atajos de edición en campos editables) y una denylist que gana siempre (DevTools,
 * código fuente, guardar, imprimir, abrir, atrás/adelante).
 *
 * `classifyKeyEvent` e `installKeyPolicy` MUST ser autocontenidas: se inyectan en la
 * página por su código fuente con `manualKeyPolicyInitScript()`.
 */

/**
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altGraph?: boolean }} ev
 * @param {{ editable?: boolean }} [ctx]
 * @returns {'allow' | 'allow-isolated' | 'block'}
 */
export function classifyKeyEvent(ev, ctx) {
  const key = String((ev && ev.key) || '');
  const code = String((ev && ev.code) || '');
  const ctrl = Boolean(ev && ev.ctrlKey);
  const alt = Boolean(ev && ev.altKey);
  const meta = Boolean(ev && ev.metaKey);
  const shift = Boolean(ev && ev.shiftKey);
  const altGraph = Boolean(ev && ev.altGraph);
  const editable = Boolean(ctx && ctx.editable);
  const lower = key.toLowerCase();

  // Letra de la tecla física: por code (KeyX) o, si no hay code, por key
  const codeLetter = /^Key([A-Z])$/.test(code) ? code.slice(3).toLowerCase() : '';
  const letterIs = (letters) =>
    (codeLetter && letters.indexOf(codeLetter) !== -1) || (key.length === 1 && letters.indexOf(lower) !== -1);

  // 1. Modificadoras solas
  if (['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS'].indexOf(key) !== -1) return 'allow';

  // 2. Teclas de función
  if (key === 'F5') return 'allow';
  if (/^F\d{1,2}$/.test(key)) return 'block';

  // 3. Denylist (gana siempre, también en editables)
  if ((ctrl || meta) && shift && !alt && letterIs(['i', 'j', 'c'])) return 'block';
  if (meta && alt && letterIs(['i', 'j', 'c'])) return 'block';
  if ((ctrl || meta) && !alt && letterIs(['u', 's', 'p', 'o'])) return 'block';
  if (alt && !ctrl && !meta && (key === 'ArrowLeft' || key === 'ArrowRight')) return 'block';

  // 4. AltGr: produce un carácter distinto de la letra/dígito de la tecla, o tecla muerta
  if ((altGraph || (ctrl && alt)) && !meta) {
    if (key === 'Dead') return 'allow-isolated';
    const chars = Array.from(key);
    if (chars.length === 1 && !/\p{Cc}/u.test(key)) {
      const digitMatch = /^Digit(\d)$/.exec(code);
      const sameLetter = codeLetter !== '' && codeLetter === lower;
      const sameDigit = digitMatch !== null && digitMatch[1] === key;
      if (!sameLetter && !sameDigit) return 'allow-isolated';
    }
  }

  // 5. Códigos Alt del teclado numérico
  if (alt && !ctrl && !meta && /^Numpad\d$/.test(code)) return 'allow';

  // 6. Atajos de edición dentro de campos editables
  if (editable && (ctrl || meta) && !alt) {
    const editLetters = shift ? ['v', 'z'] : ['v', 'c', 'x', 'a', 'z', 'y'];
    if (key.length === 1 && editLetters.indexOf(lower) !== -1) return 'allow';
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete'].indexOf(key) !== -1) {
      return 'allow';
    }
  }

  // 7. Denegación por defecto de combinaciones con modificadores
  if (ctrl || meta || alt) return 'block';
  return 'allow';
}

/**
 * Instala la política en la página: listener `keydown` en `window` (captura) y bloqueo
 * de `contextmenu`.
 * @param {typeof classifyKeyEvent} classify
 */
export function installKeyPolicy(classify) {
  const isEditable = (t) => {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = String(t.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = String(t.type || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].indexOf(type) !== -1;
    }
    return false;
  };

  window.addEventListener('keydown', (e) => {
    let target = e.target;
    try {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
      if (path && path.length) target = path[0];
    } catch (_) {
      // usar e.target
    }
    const ev = {
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altGraph: typeof e.getModifierState === 'function' && e.getModifierState('AltGraph') === true,
    };
    let decision = 'block';
    try {
      decision = classify(ev, { editable: isEditable(target) });
    } catch (_) {
      decision = 'block';
    }
    if (decision === 'allow') return;
    if (decision === 'allow-isolated') {
      // El carácter se inserta, pero ningún manejador keydown de WhatsApp ve el evento
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // Bloquear menú contextual (clic derecho)
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}

/**
 * Código para `page.addInitScript({ content })`.
 * @returns {string}
 */
export function manualKeyPolicyInitScript() {
  return `(${installKeyPolicy.toString()})(${classifyKeyEvent.toString()});`;
}
