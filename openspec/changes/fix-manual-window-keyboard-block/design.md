# Design

## Context

Ver proposal.md (Why). Estado actual de la ventana manual (`whatsapp-manual.js`):

- `initManualWhatsApp` registra con `addInitScript` (líneas ~538–564) un `keydown` en `document` (captura) que deja pasar F5 y Ctrl/Cmd+V sin Shift/Alt, y cancela con `preventDefault` + `stopPropagation` toda tecla de función y todo evento con `ctrlKey || metaKey || altKey`. El comentario dice "Bloquear atajos de teclado para DevTools", pero el código bloquea mucho más; el resto de la ventana (ocultar controles, bloquear clic en burbujas, Delete/Backspace fuera de editables, spec "Restricciones de interfaz de WhatsApp") muestra que la intención real es "solo responder": impedir también los atajos de WhatsApp Web (en Windows usan Ctrl+Alt: nuevo chat Ctrl+Alt+N, archivar Ctrl+Alt+E, eliminar chat Ctrl+Alt+Retroceso, fijar/silenciar/no leído Ctrl+Alt+Shift+…, perfil/ajustes Ctrl+Alt+P/,).
- Tras conectar (~688) y en cada `load` (~763) se añaden **otros** `keydown` que solo bloquean F12, Ctrl+Shift+I/J/C y Cmd+Alt+I/J/C, más `contextmenu`. Son redundantes: los init scripts de Playwright ya se ejecutan en cada documento nuevo, incluido F5.
- `__anaManualMessageKeyBlocker` (~1195) cancela Delete/Backspace fuera de campos editables; no cambia.
- Ventanas de automatización (`whatsapp.js:474`) y monitor (`whatsapp-monitor.js:856`) solo bloquean DevTools y el agente no escribe en ellas; no tienen el problema y no se tocan.
- En Windows, AltGr llega como `ctrlKey && altKey` (y Chromium además informa `getModifierState('AltGraph')`). El carácter producido aparece en `event.key` (`@`, `€`, `#`…), mientras `event.code` identifica la tecla física (`KeyQ`, `Digit2`, `KeyE`).
- La flota es solo Windows (`pkg --targets node18-win-x64`).

## Goals / Non-Goals

**Goals:**
- Escribir cualquier carácter AltGr y usar códigos Alt en la ventana manual.
- Copiar/cortar/deshacer/seleccionar/navegar por palabras dentro de campos editables.
- Mantener bloqueados DevTools, atajos del navegador peligrosos y atajos de WhatsApp Web.
- Política única, pura y probada con `node:test`.

**Non-Goals:**
- Atajos reservados por Chromium que la página no puede cancelar (Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+Shift+N/W, Alt+F4): siguen igual que hoy.
- Opción (Alt) de macOS como modificador de caracteres: fuera de alcance (no hay flota macOS).
- Cambiar las ventanas de automatización o monitor.

## Decisions

1. **Denegación por defecto con excepciones explícitas, no solo una denylist.** Una denylist pura (F12, Ctrl+Shift+I…) reabriría todos los atajos de WhatsApp Web (archivar, eliminar chat, nuevo chat), que cambian entre versiones y no podemos enumerar de forma fiable; eso contradice "solo responder". Se mantiene el bloqueo por defecto y se añaden excepciones para escritura, más una denylist que gana siempre (incluso en editables). *Alternativa descartada*: denylist de DevTools + atajos conocidos de WhatsApp — frágil ante cambios de WhatsApp.

2. **Función pura `classifyKeyEvent(ev, ctx) → 'allow' | 'allow-isolated' | 'block'`** en `v3/cli-whatsapp/manual-key-policy.js`, con `ev = { key, code, ctrlKey, altKey, metaKey, shiftKey, altGraph }` y `ctx = { editable }`. Orden de evaluación:
   1. Teclas modificadoras solas (`Control`, `Alt`, `AltGraph`, `Shift`, `Meta`, `OS`) → `allow`.
   2. `F5` (con cualquier modificador) → `allow`; otras `F1`–`F24` → `block`.
   3. Denylist: `(ctrl||meta) && shift && !alt` con `I/J/C` (por `code` `KeyI/KeyJ/KeyC` o `key`); `meta && alt` con `I/J/C`; `(ctrl||meta) && !alt` con `U/S/P/O`; `alt && !ctrl && !meta` con `ArrowLeft/ArrowRight` → `block`.
   4. AltGr: `(altGraph || (ctrl && alt)) && !meta` y (`key === 'Dead'` o `key` es un único carácter imprimible —un code point, no `\p{Cc}`— que **no** coincide con la letra de `code` `KeyX` (comparando en minúsculas) ni con el dígito de `code` `DigitN`) → `allow-isolated`.
   5. Códigos Alt: `alt && !ctrl && !meta && /^Numpad\d$/.test(code)` → `allow`.
   6. Edición en editable: `ctx.editable && (ctrl||meta) && !alt` y (`key` en minúsculas ∈ {v, c, x, a, z, y} — con Shift solo `v` y `z` — o `key` ∈ {ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Home, End, Backspace, Delete}) → `allow`.
   7. Cualquier otro con `ctrl||meta||alt` → `block`; sin modificadores → `allow`.
   La regla 4 distingue AltGr de un atajo real porque con AltGr la tecla produce otro carácter (`KeyQ` → `@`), mientras un Ctrl+Alt+letra sin carácter AltGr produce la propia letra (`KeyE` → `e` en US). Para teclas no alfanuméricas (`Slash`, `BracketLeft`…) no se puede saber el carácter base; se permite como AltGr, pero aislado (regla 4 + Decisión 3), así que no dispara atajos.

3. **`allow-isolated` = no `preventDefault`, sí `stopImmediatePropagation`.** El carácter se inserta (el editor de WhatsApp escribe a partir de `beforeinput`/`input`, que no se cancelan), pero ningún manejador `keydown` de WhatsApp ve el evento, de modo que AltGr+E (`€`) no puede activar un atajo que WhatsApp asocie a Ctrl+Alt+E por `code`. `block` = `preventDefault` + `stopImmediatePropagation`. `allow` = no se toca el evento (las teclas de edición deben llegar al editor, que implementa deshacer, flechas y borrado con `keydown`).

4. **Listener en `window` en fase de captura**, registrado con `addInitScript` antes de que corra cualquier script de WhatsApp, para ejecutarse antes que cualquier listener de la página (hoy está en `document`, que va después de `window`). `ctx.editable` se calcula con el `event.target` (o `composedPath()[0]`): `isContentEditable`, `INPUT` de texto o `TEXTAREA`. `ev.altGraph` = `event.getModifierState?.('AltGraph') === true`.

5. **Inyección**: el módulo exporta `classifyKeyEvent` y `manualKeyPolicyInitScript()` que devuelve una cadena `(${installKeyPolicy.toString()})(${classifyKeyEvent.toString()})`; ambas funciones son autocontenidas para sobrevivir a `toString()` en el bundle (esbuild sin minificar + `pkg --no-bytecode`). Se registra con `manualPage.addInitScript({ content })` sustituyendo el init script actual de teclado; el bloqueo de `contextmenu` se mantiene en el mismo init script.

6. **Eliminar los `keydown`/`contextmenu` duplicados** de los `page.evaluate` post-conexión y `on('load')`, conservando en ambos la llamada a `window.applyManualUIRestrictions()`. Dejar ambos no rompe nada hoy, pero si el init script cambia, los duplicados confunden la depuración.

## Risks / Trade-offs

- [Algún manejador de WhatsApp necesita `keydown` de caracteres AltGr (p. ej. menciones con `@` en grupos)] → Las menciones y el autocompletado se basan en el texto insertado (`input`); verificar en sesión real escribiendo `@` en un grupo. Si fallara, cambiar `allow-isolated` por `allow` solo para caracteres no ligados a atajos.
- [Ctrl+Alt+tecla de puntuación en teclado US queda permitido aislado] → No produce carácter ni llega a WhatsApp; efecto nulo.
- [Ctrl+C dentro de editable permite copiar texto] → Solo hay selección dentro de campos editables (la selección está deshabilitada en el resto), así que solo se copia el borrador del agente o la búsqueda.
- [Diferencias de Chromium al reportar AltGr] → La regla acepta `AltGraph` o `ctrl && alt`; pruebas unitarias con ambas formas y verificación manual con distribuciones Latinoamérica y España.

## Migration Plan

1. Implementar módulo + pruebas, integrar, verificar en sesión real con ambas distribuciones de teclado.
2. `npm run build` (bump patch + upload) y confirmar `versions/latest.json`.
3. Rollback: revertir y publicar otra versión patch (el autoupdate no baja de versión).

## Decisiones de implementación

- **Script `test`:** se reutiliza `node --test` (ver `fix-cli-double-brace-templates`; `node --test test/` falla en Node 22).
- **Denylist por letra:** las reglas de DevTools y Ctrl+U/S/P/O comparan la letra por `code` (`KeyI`…) o, si `code` está vacío, por `key` de un carácter en minúsculas; así Ctrl+Shift+`i` minúscula también se bloquea.
- **Ctrl+V fuera de campos editables pasa a bloquearse.** La política anterior lo permitía en toda la página; el requisito nuevo solo lo permite dentro de editables (regla 6) y la tarea 1.2 lo fija con prueba. No hay campo en el que se pueda pegar fuera de un editable, así que no hay pérdida funcional.
- **Fallo cerrado:** si `classify` lanza, `installKeyPolicy` bloquea el evento.
- **Editable:** `isContentEditable`, `TEXTAREA` o `INPUT` de tipo `text/search/email/url/tel/password/number`, evaluado sobre `composedPath()[0]` (o `event.target`).
- **Init scripts:** el de teclado se registra después de `domSafetyInitScript()` y `phoneUtilsInitScript()`; todos los init scripts corren antes que los scripts de WhatsApp, así que el listener en `window` (captura) sigue siendo el primero en ver los `keydown`.
- **Verificación del bundle:** se comprobó que el bundle de `esbuild` contiene `function classifyKeyEvent(ev, ctx)` intacta y que el init script generado desde el módulo empaquetado instala la política y aísla AltGr+Q (sin `preventDefault`, con `stopImmediatePropagation`). El bundle se generó fuera de `dist/` para no dejar artefactos.
- **`README-USUARIO.md`** estaba vacío; se creó con la sección "Teclado en la ventana manual".
- **`build-portable.ps1`:** se agregó `manual-key-policy.js` a `$filesToCopy`.
