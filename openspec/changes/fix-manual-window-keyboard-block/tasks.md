# Tasks

## 1. Política de teclado pura y pruebas

- [x] 1.1 Crear `v3/cli-whatsapp/manual-key-policy.js` con `classifyKeyEvent(ev, ctx)` (orden de reglas de `design.md`, Decisión 2), `installKeyPolicy(classify)` (listener `keydown` en `window`, captura; calcula `altGraph` y `editable`; aplica `block`/`allow-isolated`/`allow`; bloquea `contextmenu`) y `manualKeyPolicyInitScript()`; ambas funciones sin referencias externas; verificar con `node --check manual-key-policy.js`
- [x] 1.2 Crear `v3/cli-whatsapp/test/manual-key-policy.test.js` (`node:test`) con una tabla de casos: F12/F1 → block, F5 y Ctrl+F5 → allow; Ctrl+Shift+I/J/C (también en editable y con `key` en minúscula) → block; Ctrl+U/S/P/O → block; Alt+ArrowLeft → block; AltGr+Q→`@` (`ctrl+alt` y también solo `altGraph`) → allow-isolated; AltGr+Digit2→`@`, AltGr+Digit3→`#`, AltGr+KeyE→`€`, AltGr+`Dead` → allow-isolated; Ctrl+Alt+KeyE→`e`, Ctrl+Alt+KeyN→`n`, Ctrl+Alt+Backspace → block; Meta+Alt+`@` → block; Alt+Numpad6 → allow; Control/Alt/AltGraph solos → allow; en editable Ctrl+V/C/X/A/Z/Y, Ctrl+Shift+Z, Ctrl+Shift+V, Ctrl+ArrowLeft, Ctrl+Backspace → allow; fuera de editable Ctrl+C/A → block, Ctrl+V → block; Ctrl+Alt+V en editable → block; tecla `a` sin modificadores → allow; y que `classifyKeyEvent` reconstruida con `new Function('return (' + fn.toString() + ')')()` da los mismos resultados; verificar que `node --test test/` pasa
- [x] 1.3 Asegurar `"test": "node --test test/"` en `v3/cli-whatsapp/package.json` (puede existir por otro cambio) y verificar que `npm test` pasa

## 2. Integración en la ventana manual

- [x] 2.1 En `initManualWhatsApp`, reemplazar el `addInitScript` de teclado/menú contextual (~538–564) por `manualPage.addInitScript({ content: manualKeyPolicyInitScript() })`; verificar con `npx esbuild index.js --bundle --platform=node --format=cjs --outfile=dist/app.cjs --external:playwright` que el bundle se genera y que `dist/app.cjs` contiene el cuerpo de `classifyKeyEvent` sin renombres que rompan referencias internas
- [ ] 2.2 Quitar los `keydown` y `contextmenu` duplicados de los `manualPage.evaluate` posteriores a la conexión (~688) y del handler `on('load')` (~763), conservando `window.applyManualUIRestrictions()`; verificar tras F5 que el menú contextual sigue bloqueado y que F12 no abre DevTools
- [x] 2.3 Actualizar el comentario del init script para describir la política (denegación por defecto + excepciones); verificar con `node --check whatsapp-manual.js`

## 3. Verificación manual en WhatsApp Web real (Windows)

- [ ] 3.1 Con distribución "Español (Latinoamérica)": en el cuadro de mensaje escribir AltGr+Q (`@`), AltGr+`'` (`\`), AltGr+`+` (`~`) y Alt+64 en el teclado numérico; verificar que se escriben `@`, `\`, `~`, `@` y que el chat abierto no cambia (no se archiva, no se fija, no se silencia)
- [ ] 3.2 Con distribución "Español (España)": AltGr+2/3/E/`+`/`ç`; verificar `@`, `#`, `€`, `]`, `}` y ningún cambio de estado del chat
- [ ] 3.3 En un chat de grupo de prueba escribir `@` con AltGr y verificar que aparece el selector de menciones como sin la política
- [ ] 3.4 En el cuadro de mensaje: seleccionar texto, Ctrl+C, Ctrl+X, Ctrl+Z, Ctrl+Y, Ctrl+A, Ctrl+Retroceso, Ctrl+flechas; verificar que funcionan sobre el borrador y que Ctrl+A no selecciona la página; fuera del cuadro, verificar que Ctrl+A/Ctrl+C no hacen nada
- [ ] 3.5 Verificar bloqueados: F12, Ctrl+Shift+I/J/C (también con foco en el cuadro), Ctrl+U, Ctrl+S, Ctrl+P, Ctrl+O, Alt+←/→, Ctrl+Alt+N y Ctrl+Alt+Retroceso con distribución US; verificar que F5 recarga y que tras recargar todo lo anterior se mantiene
- [ ] 3.6 Regresión: abrir "⬆️ Subir gestión" y "📜 Ver Historial", escribir `@` y usar Ctrl+V en sus campos de texto; verificar que funcionan y que Escape sigue cerrando la burbuja del historial

## 4. Documentación y release

- [x] 4.1 Agregar a `v3/cli-whatsapp/README-USUARIO.md` una nota "Teclado en la ventana manual" (AltGr y códigos Alt funcionan; copiar/pegar/deshacer solo dentro del cuadro de mensaje; atajos de WhatsApp desactivados); verificar con `grep -n "AltGr" README-USUARIO.md`
- [ ] 4.2 Desde `v3/cli-whatsapp`, ejecutar `npm run build` (bump patch, `dist/ANA.exe`, `dist/latest.json`, `setup-and-upload.ps1`); verificar que `https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/latest.json` muestra la nueva versión
- [ ] 4.3 En un equipo de agente con teclado latinoamericano y la versión anterior, reiniciar ANA y verificar que se autoactualiza y que puede escribir `@` en la ventana manual
