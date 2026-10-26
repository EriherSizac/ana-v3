# Tasks

## 1. Módulo del registro local y pruebas

- [x] 1.1 Si no existe por otro cambio, agregar a `v3/cli-whatsapp/package.json` el script `"test": "node --test test/"`; verificar que `npm test` corre en `v3/cli-whatsapp`
- [x] 1.2 Crear `v3/cli-whatsapp/assignment-journal.js` (sin efectos al importar; directorio de datos recibido por parámetro) con `createJournal({dir, agentId, campaign, csvText, rows})`, `loadJournal({dir, agentId, campaign})`, `markInFlight`, `markDone`, `markForReview`, `pendingRows`, `reviewRows`, `removeJournal`, el `assignment_id` de design D6 y escritura atómica `*.tmp` + `renameSync` según design D2; verificar con `npm test`
- [x] 1.3 Escribir `test/assignment-journal.test.js` sobre un directorio temporal (`fs.mkdtempSync`): creación con todo `pending`, transiciones `pending → in_flight → done` e `in_flight → por_revisar`, `pendingRows` y `reviewRows` en orden, `assignment_id` estable para el mismo CSV, archivo por agente/campaña con nombre saneado, carga de journal con `sha256` o filas inconsistentes → renombrado a `*.invalid-*.json` sin devolver filas, `.tmp` huérfano ignorado, eliminación al terminar; verificar que `npm test` pasa
- [x] 1.4 Hacer que el parser de asignaciones (`assignment-csv.js` si `fix-cli-double-brace-templates` ya se aplicó, o `parseCSV` de `agent-config.js`) devuelva por contacto su índice de fila y su fila original (`rawValues`) sin que aparezcan en `resultados.csv`; verificar con una prueba que un CSV de 3 filas produce índices 0–2 y filas originales iguales a las columnas recibidas

## 2. Integración en el ciclo de envío

- [ ] 2.1 Cambiar `fetchAssignedChats` para devolver también el CSV crudo (`{ csvText, contacts }`), integrándolo con el envío de token de `secure-assignment-consumption` si ya está aplicado; verificar que el log `📥 CSV recibido` y el conteo de contactos no cambian en una prueba manual
- [ ] 2.2 En `index.js`, al recibir contactos crear el journal antes del primer `sendMessage`, marcar `in_flight`/`done` alrededor de cada envío según design D3 y eliminarlo tras enviar `[]` al final; verificar con una asignación de prueba de 3 contactos propios que `%APPDATA%\ANA\assignment-journal-<agent>-<campaign>.json` existe durante el ciclo y desaparece al terminar
- [ ] 2.3 Antes del primer poll y al inicio de cada iteración, reanudar el journal del agente/campaña configurados (design D5): contactos `in_flight` → `por_revisar` con resultado `status: por_revisar` "Envío interrumpido por cierre del CLI; revisar antes de reenviar" en `resultados.csv` y sin interacción CRM; contactos `pending` → procesar normalmente; listar en consola los journals de otros agentes/campañas sin procesarlos; verificar con la prueba manual 4.1
- [x] 2.4 Actualizar `LIMITE-MENSAJES.md` del CLI para describir la reanudación local y el reporte real de pendientes (reemplazando la descripción obsoleta de 45 mensajes/2 horas solo en lo relativo a pendientes); verificar que el documento coincide con los escenarios del delta de `v3/automated-sending`

## 3. Reporte de pendientes y contactos por revisar

- [x] 3.1 En `v3/ana-backend/src/handlers/contacts.ts`, aceptar el campo opcional `review` (design D6: validación de `assignment_id` y arreglo, escritura de `review/{campaign}/{agent_id}/{assignment_id}.csv` solo si hay filas, `reviewContacts` en la respuesta) sin cambiar el comportamiento sin `review`; agregar suite vitest si no existe; verificar con `test/contacts-review.test.ts` (S3 mockeado) los escenarios de "Registro de contactos por revisar" del delta `v3/agent-assignments`
- [x] 3.2 Implementar `GET /supervisors/review/{campaign}` (handler en `supervisors.ts` con `requireAdmin` antes de S3, listado paginado de `review/{campaign}/`, orden por `updatedAt` desc) y registrarla en `serverless.yml`; verificar con pruebas: 401 sin llave sin llamadas a S3, lista vacía, dos registros ordenados con `count` correcto
- [ ] 3.3 Desplegar el backend a prod antes del release del CLI (`npm run deploy -- --stage prod`); verificar con `curl` que `POST /contacts/pending` sin `review` responde como antes y que `GET /supervisors/review/prueba` responde 401 sin llave y 200 con llave
- [ ] 3.4 En el CLI, tras marcar `done` y registrar la interacción, llamar a `updatePendingContacts(pendingRows().map(r => r.raw), review)` con `review = {assignment_id, contacts: reviewRows().map(r => r.raw)}` solo si hay filas por revisar, sin bloquear el ciclo si falla; verificar con una asignación de 3 contactos que tras el primer contacto `chats/<agent>-<campaign>.csv` en S3 tiene 2 filas con las columnas originales, tras el segundo 1 fila y al final solo el encabezado `contact_phone,contact_name`, y que tras la prueba 4.2 existe `review/<campaign>/<agent>/<assignment_id>.csv` con el contacto interrumpido
- [ ] 3.5 Documentar en `v3/ana-backend/README-SUPERVISORES.md` cómo recuperar los pendientes de un agente desde `chats/{agent_id}-{campaign}.csv`, cómo consultar los contactos por revisar con `GET /supervisors/review/{campaign}` y cómo re-subirlos como asignación tras confirmar en WhatsApp si el mensaje salió; verificar que el procedimiento descrito funciona con los archivos generados en 3.4

## 4. Verificación integral y release

- [ ] 4.1 Prueba de cierre a mitad de ciclo: asignación de prueba de 4 contactos propios; cerrar el CLI (Ctrl+C) durante la espera tras el contacto 2 y reabrir; verificar que solo los contactos 3 y 4 reciben mensaje, que 1 y 2 no reciben un segundo mensaje y que `resultados.csv` de la nueva ejecución lista 3 y 4
- [ ] 4.2 Prueba de cierre durante el envío: cerrar el CLI mientras está visible el overlay "Enviando Mensaje" de un contacto y reabrir; verificar que ese contacto aparece con `status: por_revisar` en `resultados.csv` y en `GET /supervisors/review/{campaign}`, no recibe un segundo mensaje y el ciclo continúa con el siguiente
- [ ] 4.3 Agregar `assignment-journal.js` a `$filesToCopy` en `build-portable.ps1`; verificar que aparece en `dist-portable/app/` y que `ANA.bat` arranca sin `ERR_MODULE_NOT_FOUND`
- [ ] 4.4 Ejecutar `build-completo.ps1` y `npm run upload`; verificar que `versions/latest.json` publica la nueva versión y que un CLI instalado se autoactualiza y reanuda correctamente un journal creado por la propia versión nueva

## Workflow follow-up

- Archivar el cambio tras el release y confirmar que `openspec/specs/v3/automated-sending/spec.md` ya no afirma que los contactos "se reciben en el siguiente arranque".
- Seguimiento fuera de este cambio: escape correcto de comillas/saltos de línea en `contacts.ts` (también afecta a `review/`), autenticación de `/contacts/pending` (la cubre `migrate-cli-to-cognito-login`), estado "resuelto" de los registros de `review/` y su vista en ANA Admin (`link-review-contacts-to-uploads`).
