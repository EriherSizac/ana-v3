# Tasks

## 1. Módulo compartido y pruebas

- [x] 1.1 Si no existe por otro cambio, agregar a `v3/cli-whatsapp/package.json` el script `"test": "node --test test/"`; verificar que `npm test` corre en `v3/cli-whatsapp`
- [x] 1.2 Crear `v3/cli-whatsapp/phone-utils.js` con `createPhoneUtils()` autocontenida y `export const phone = createPhoneUtils()` según design D1/D3; verificar con `npm test`
- [x] 1.3 Escribir `test/phone-utils.test.js` con una tabla de casos para cada salida (`toWhatsAppUrlPhone`, `toCrmSearchPhone`, `toGestionCrmPhone`, `toLast10`, `toBackupKeyPhone`): `5512345678`, `525512345678`, `5215512345678`, `+525512345678`, `+52 1 55 1234 5678`, `+52 (55) 1234-5678`, `55-1234-5678`, `14155550100`, `0445512345678`, `52155123456789`, `''`, `null`, texto sin dígitos; verificar que `npm test` pasa y que las salidas de CRM y respaldo coinciden con las funciones actuales (copiar las implementaciones actuales a la prueba como oráculo para los casos MX)
- [x] 1.4 Agregar una prueba que evalúe `createPhoneUtils.toString()` en un `Function` aislado y obtenga los mismos resultados; verificar con `npm test`

## 2. Flujo automático y CRM en Node

- [ ] 2.1 En `sendMessage` (`whatsapp.js`) construir la URL con `phone.toWhatsAppUrlPhone(contact.phone)` manteniendo el error "Contacto sin teléfono..." cuando el resultado es vacío; verificar con log de la URL en una prueba manual con un contacto de 10 dígitos que abre `send?phone=52XXXXXXXXXX`
- [x] 2.2 Reemplazar el cuerpo de `normalizePhoneForBackend` en `agent-config.js` por `phone.toCrmSearchPhone` y el cálculo de `phone10` en `index.js` y `whatsapp-monitor.js` por `phone.toLast10`; verificar con `npm test` y con `grep -n "replace(/\\\\D/g" v3/cli-whatsapp/index.js v3/cli-whatsapp/whatsapp-monitor.js` que no quedan normalizaciones ad hoc de teléfono
- [ ] 2.3 Reemplazar `normalizePhoneForBackend` de Node en `whatsapp-manual.js:2170` por `phone.toGestionCrmPhone` y el cálculo de últimos 10 del modal sin WhatsApp por `phone.toLast10`; verificar abriendo "Subir gestión" en un chat `+52 1 ...` que el subtítulo muestra `Tel: +52XXXXXXXXXX`

## 3. Código inyectado en el navegador

- [ ] 3.1 Inyectar `window.__anaPhone` en la página manual con `addInitScript({ content })` antes de los scripts de respaldo, historial y Gestión (design D2); verificar en la consola de la página manual que `window.__anaPhone.toBackupKeyPhone('5512345678')` devuelve `5215512345678`
- [ ] 3.2 Sustituir la `normalizePhoneForBackend` del respaldo automático (`whatsapp-manual.js:1487`) por `window.__anaPhone.toBackupKeyPhone`, borrando el comentario "521 -> 52"; verificar abriendo un chat con respaldo previo que el log `[ChatBackup] ... Normalizado:` muestra `521...` y se informa "No hay cambios en el chat" (misma llave)
- [ ] 3.3 Sustituir `normalizePhone` del historial (`whatsapp-manual.js:2731`) por `toBackupKeyPhone`; verificar con "📜 Ver" sobre una conversación respaldada que se carga el mismo historial que antes. Los botones "💬 Abrir" (`2931`, `3273`) quedan a cargo del cambio `fix-historial-xss` (requisito "Teléfono saneado al abrir chat desde el historial"); si ese cambio ya se aplicó, que use `window.__anaPhone.toLast10` en lugar de una copia propia
- [x] 3.4 Verificar con `grep -n "'521' +" v3/cli-whatsapp/whatsapp-manual.js` que no quedan copias de normalización en el archivo

## 4. Empaquetado y release

- [ ] 4.1 Agregar `phone-utils.js` a `$filesToCopy` en `build-portable.ps1`; verificar que aparece en `dist-portable/app/` y que `ANA.bat` arranca sin `ERR_MODULE_NOT_FOUND`
- [ ] 4.2 Prueba de extremo a extremo con un agente de prueba: asignación (`direct: true`) con un contacto propio en formato de 10 dígitos y otro `521...`; verificar que ambos reciben el mensaje, que las interacciones llevan `phone_number` de 10 dígitos y que el monitor registra la respuesta
- [ ] 4.3 Ejecutar `build-completo.ps1` y `npm run upload`; verificar que `versions/latest.json` publica la nueva versión y que un CLI instalado se autoactualiza

## Workflow follow-up

- Archivar el cambio tras el release y confirmar que `openspec/specs/v3/automated-sending/spec.md` ya no contiene "sin anteponer `52`".
