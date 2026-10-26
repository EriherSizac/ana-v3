# Tasks

## 1. Helper de escape y pruebas

- [ ] 1.1 Crear `v3/cli-whatsapp/dom-safety.js` con `escapeHtml`, `digitsOnly`, `phone10ForWhatsappUrl` (funciones puras y autocontenidas, sin referencias externas) y `domSafetyInitScript()` que devuelve el código que define `window.__anaDomSafety`; verificar con `node -e "import('./dom-safety.js').then(m=>console.log(m.escapeHtml('<a \"x\">&\\'')))"` desde `v3/cli-whatsapp` que imprime `&lt;a &quot;x&quot;&gt;&amp;&#39;`
- [ ] 1.2 Crear `v3/cli-whatsapp/test/dom-safety.test.js` (`node:test` + `node:assert`) que cubra: los cinco caracteres, `null`/`undefined`/números/objetos, texto ya escapado (doble escape esperado), payloads `<img src=x onerror=…>` y `"><svg onload=…>`, `phone10ForWhatsappUrl` con `521551234567"8`, `+52 1 55 1234 5678`, menos de 10 dígitos, y que `new Function('return (' + escapeHtml.toString() + ')')()` produce la misma salida; verificar que `node --test test/` pasa
- [ ] 1.3 Agregar `"test": "node --test test/"` a `scripts` de `v3/cli-whatsapp/package.json` y verificar que `npm test` pasa y que `npx esbuild index.js --bundle --platform=node --format=cjs --outfile=dist/app.cjs --external:playwright` sigue generando el bundle sin errores
- [ ] 1.4 Registrar `manualPage.addInitScript({ content: domSafetyInitScript() })` en `initManualWhatsApp` antes del primer `addInitScript` existente; verificar en la ventana manual, tras cargar y tras F5, que `typeof window.__anaDomSafety.escapeHtml === 'function'` (comprobación con un `page.evaluate` temporal o `logToNodeConsole` durante desarrollo, retirado después)

## 2. Historial (lista y burbuja)

- [ ] 2.1 Reescribir la fila de `renderChatList` (`whatsapp-manual.js` ~2892) para que teléfono, vista previa, fecha y total se asignen con `textContent` y los botones usen `dataset.phone`/`dataset.phone10`; verificar con un respaldo cuyo `last_message_preview` sea `<b>x</b><img src=x onerror=window.__pwned=1>` que la fila muestra el texto literal y `window.__pwned` queda `undefined`
- [ ] 2.2 Reescribir el cuerpo de cada mensaje en `showHistoryBubble` (~3240) construyendo etiqueta, marca de tiempo, cuerpo y tipo con `textContent`; verificar con un mensaje multilínea que contenga `<a href="x">pago</a>` que se ven los saltos de línea y el texto literal sin enlace
- [ ] 2.3 Escapar `date` y `phoneDisplay` en el encabezado de la burbuja (~3182); verificar con `last_updated` igual a `<i>x</i>` que se muestra literal
- [ ] 2.4 Usar `phone10ForWhatsappUrl` en "💬 Abrir" y "💬 Abrir chat"; si devuelve `''`, no navegar y mostrar notificación de error; verificar con `contact_phone` `521551234567"8` que navega a `…send?phone=525512345678` y con `12345` que no navega

## 3. Modal de gestión y notificaciones de respaldo

- [ ] 3.1 Escapar `full_name`, `credit_id`, `product_name`, `dictamen` y `subdictamen` (texto y atributos `value`) en el formulario de gestión (~2539) y mostrar el error de carga (~2596) con `textContent`; verificar con respuestas simuladas (`getGestionDataFromBackend` temporalmente devolviendo `full_name: '<i>Juan</i>'` y subdictamen `A"><b>B`) que se muestran literales y que el payload enviado lleva `subdictamen` exactamente `A"><b>B`
- [ ] 3.2 Cambiar `showBackupToast` y `showBackupNotification` (~1847, ~1898) para que `message` se asigne con `textContent`; verificar que la notificación "Chat respaldado (N nuevos mensajes)" sigue mostrándose igual tras un respaldo automático real
- [ ] 3.3 En `chat-backup.js` `updateBackupProgress`, asignar `prog.message` con `textContent` (el resto del overlay sigue en plantilla con valores internos); verificar con un chat renombrado `<b>x</b>` en el teléfono de prueba que el overlay "Respaldando Chats" muestra "Procesando: <b>x</b>" literal y el botón "Cerrar" sigue funcionando

## 4. Higiene en código muerto y auditoría

- [ ] 4.1 Escapar `savedUser`/`savedCampaign` en los overlays de login no usados de `whatsapp-manual.js` (~51–92) y `whatsapp-monitor.js` (~61–102) con un escape inline equivalente (no se inyecta el helper en la ventana monitor); verificar con `node --check whatsapp-manual.js` y `node --check whatsapp-monitor.js`
- [ ] 4.2 Ejecutar `grep -n "innerHTML" whatsapp-manual.js whatsapp-monitor.js chat-backup.js` y confirmar, contra la tabla de `design.md`, que cada `innerHTML` restante con `${…}` solo interpola valores internos o escapados; actualizar la tabla de `design.md` si cambiaron números de línea

## 5. Verificación manual en WhatsApp Web real

- [ ] 5.1 Con un número de prueba, enviar al agente los mensajes `<img src=x onerror=alert(1)>`, `<script>alert(2)</script>` y `"><svg onload=alert(3)>`, esperar al respaldo automático y abrir "📜 Ver Historial" → fila → "📜 Ver"; verificar que no aparece ningún `alert`, que los textos se ven literales y que no se registró ninguna interacción en el CRM
- [ ] 5.2 Plantar con `curl -X POST {API}/backups/chat` (campaña y agente de prueba) un mensaje con payload HTML y verificar el mismo resultado desde la lista y la burbuja
- [ ] 5.3 Regresión: abrir "⬆️ Subir gestión" en un chat real, subir una gestión de prueba y verificar "✅ Gestión subida"; abrir "💬 Abrir chat" desde el historial y verificar que WhatsApp abre el chat correcto

## 6. Release vía autoupdate

- [ ] 6.1 Desde `v3/cli-whatsapp`, ejecutar `npm run build` (incrementa la versión patch de `package.json`, genera `dist/ANA.exe` y `dist/latest.json` y llama a `setup-and-upload.ps1`); verificar que `https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/latest.json` muestra la nueva versión
- [ ] 6.2 En un equipo con la versión anterior instalada, reiniciar ANA y verificar en consola "Auto-update" que descarga la nueva versión y que la ventana manual reproduce el resultado de 5.1
