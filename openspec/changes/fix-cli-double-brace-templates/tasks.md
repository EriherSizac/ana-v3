# Tasks

## 1. Infraestructura de pruebas

- [ ] 1.1 Agregar a `v3/cli-whatsapp/package.json` el script `"test": "node --test test/"` y crear `v3/cli-whatsapp/test/` con una prueba trivial; verificar que `npm test` en `v3/cli-whatsapp` termina con código 0 y reporta 1 prueba pasada
- [ ] 1.2 Mover `parseCSV` de `agent-config.js` a `v3/cli-whatsapp/assignment-csv.js` (export `parseAssignmentCsv`, sin imports con efectos) e importarlo desde `fetchAssignedChats`; verificar con `node -e "import('./assignment-csv.js')"` que no crea `%APPDATA%\ANA` y que una prueba de parseo (comillas, comas, saltos de línea, `""`, fila incompleta descartada) pasa

## 2. Renderizado de plantillas en una sola pasada

- [ ] 2.1 Crear `v3/cli-whatsapp/template-utils.js` con `renderTemplate(template, { fields, raw })` según design D1/D3 (regex alternada `{{...}}` | `{var}`, estándar con `total_balance || total_balanc`, expresiones, clave exacta en `fields` y luego `raw`, coincidencia parcial solo para llaves simples, `\n` literal); verificar con `npm test`
- [ ] 2.2 Escribir `test/template-utils.test.js` cubriendo cada escenario del delta de `v3/automated-sending`: `{{name}}` → `Juan`, `{first_name}`, mezcla simple+doble, coincidencia parcial, `{foo}` y `{{monto}}` literales, `{{total_balance}}` desde `total_balance`, `{{total_balanc}}` heredado, `{{contact_name}}` por columna original, valor `{first_name}` no reinterpretado, `{{total_balance * 0.5}}` = `500`, `{{total_balance / 3}}` = `33.33`, `{{saldo_x * 2}}` literal, llave suelta, `{{{name}}}` → `{Juan}` y `\n` literal; verificar que `npm test` pasa
- [ ] 2.3 Reemplazar en `parseAssignmentCsv` la pasada `\{(\w+)\}` por `renderTemplate(contact.message, { fields: contact, raw: rawValues })`; verificar con una prueba que un CSV con columna `message` = `Hola {{name}} {first_name}, saldo {{total_balance}}` produce el mensaje final esperado
- [ ] 2.4 Quitar la llamada a `replaceVariables` en `sendMessage` (`whatsapp.js:1263`) para enviar `messageTemplate` tal cual, y convertir `replaceVariables` de `message-utils.js` en envoltorio de `renderTemplate`; verificar con `grep -n replaceVariables v3/cli-whatsapp/*.js` que solo queda la definición y con `npm test` en verde
- [ ] 2.5 Actualizar las notas de `LIMITE-MENSAJES.md`/`README.md` del CLI solo si describen la sintaxis de variables (si no la describen, no tocarlas); verificar con `grep -n "{{" v3/cli-whatsapp/*.md` que lo documentado coincide con el comportamiento probado

## 3. Empaquetado y verificación manual

- [ ] 3.1 Agregar `template-utils.js` y `assignment-csv.js` a `$filesToCopy` en `v3/cli-whatsapp/build-portable.ps1`; verificar tras `build-portable.ps1` que ambos existen en `dist-portable/app/` y que `dist-portable/ANA.bat` arranca hasta el login sin `ERR_MODULE_NOT_FOUND`
- [ ] 3.2 Prueba de extremo a extremo: subir con `X-Admin-Key` y `direct: true` una asignación a un agente de prueba con un único contacto propio y plantilla `Hola {{name}} / {first_name} / {{total_balance}} / {{total_balance * 0.5}}`; verificar en WhatsApp que el mensaje recibido no contiene llaves y que `resultados.csv` registra `status: sent`
- [ ] 3.3 Revisar las plantillas activas (`GET /templates`) buscando `{{{`; verificar que no hay ninguna o avisar a supervisores antes del release

## 4. Release del CLI

- [ ] 4.1 Ejecutar `build-completo.ps1` en `v3/cli-whatsapp` (incrementa el patch de `package.json` y genera `dist-portable/ANA-<versión>.exe`); verificar que `package.json` y `dist-portable/latest.json` tienen la misma versión nueva
- [ ] 4.2 Publicar con `npm run upload` (`setup-and-upload.ps1` → `upload-to-s3.py`); verificar que `https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/latest.json` devuelve la nueva versión y que un CLI instalado con la versión anterior se autoactualiza al reiniciar

## Workflow follow-up

- Archivar el cambio (`openspec archive fix-cli-double-brace-templates`) tras el release y verificar que `openspec/specs/v3/automated-sending/spec.md` ya no contiene el escenario de `{Juan}` ni la nota de `total_balanc`.
