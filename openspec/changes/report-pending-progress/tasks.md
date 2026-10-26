# Tasks

## 1. Módulo del registro local y pruebas

- [ ] 1.1 Si no existe por otro cambio, agregar a `v3/cli-whatsapp/package.json` el script `"test": "node --test test/"`; verificar que `npm test` corre en `v3/cli-whatsapp`
- [ ] 1.2 Crear `v3/cli-whatsapp/assignment-journal.js` (sin efectos al importar; directorio de datos recibido por parámetro) con `createJournal({dir, agentId, campaign, csvText, rows})`, `loadJournal({dir, agentId, campaign})`, `markInFlight`, `markDone`, `pendingRows`, `removeJournal` y escritura atómica `*.tmp` + `renameSync` según design D2; verificar con `npm test`
- [ ] 1.3 Escribir `test/assignment-journal.test.js` sobre un directorio temporal (`fs.mkdtempSync`): creación con todo `pending`, transiciones `pending → in_flight → done`, `pendingRows` en orden, archivo por agente/campaña con nombre saneado, carga de journal con `sha256` o filas inconsistentes → renombrado a `*.invalid-*.json` sin devolver filas, `.tmp` huérfano ignorado, eliminación al terminar; verificar que `npm test` pasa
- [ ] 1.4 Hacer que el parser de asignaciones (`assignment-csv.js` si `fix-cli-double-brace-templates` ya se aplicó, o `parseCSV` de `agent-config.js`) devuelva por contacto su índice de fila y su fila original (`rawValues`) sin que aparezcan en `resultados.csv`; verificar con una prueba que un CSV de 3 filas produce índices 0–2 y filas originales iguales a las columnas recibidas

## 2. Integración en el ciclo de envío

- [ ] 2.1 Cambiar `fetchAssignedChats` para devolver también el CSV crudo (`{ csvText, contacts }`), integrándolo con el envío de token de `secure-assignment-consumption` si ya está aplicado; verificar que el log `📥 CSV recibido` y el conteo de contactos no cambian en una prueba manual
- [ ] 2.2 En `index.js`, al recibir contactos crear el journal antes del primer `sendMessage`, marcar `in_flight`/`done` alrededor de cada envío según design D3 y eliminarlo tras enviar `[]` al final; verificar con una asignación de prueba de 3 contactos propios que `%APPDATA%\ANA\assignment-journal-<agent>-<campaign>.json` existe durante el ciclo y desaparece al terminar
- [ ] 2.3 Antes del primer poll y al inicio de cada iteración, reanudar el journal del agente/campaña configurados (design D5): contactos `in_flight` → `done` con resultado `error` "Envío interrumpido por cierre del CLI; no se reintenta" y sin interacción CRM; contactos `pending` → procesar normalmente; listar en consola los journals de otros agentes/campañas sin procesarlos; verificar con la prueba manual 4.1
- [ ] 2.4 Actualizar `LIMITE-MENSAJES.md` del CLI para describir la reanudación local y el reporte real de pendientes (reemplazando la descripción obsoleta de 45 mensajes/2 horas solo en lo relativo a pendientes); verificar que el documento coincide con los escenarios del delta de `v3/automated-sending`

## 3. Reporte de pendientes tras cada contacto

- [ ] 3.1 Confirmar con el equipo de Pernexium (y en los logs de acceso del bucket `ana-backend-storage-prod`, prefijo `chats/`) que ningún proceso externo lee o republica `chats/{agent_id}-{campaign}.csv`; verificar con la respuesta escrita. Si existe tal proceso, no aplicar 3.2–3.3 y revertir el requisito "Consumo de la lista de pendientes" del delta a su texto original (design, Open Questions)
- [ ] 3.2 Tras marcar `done` y registrar la interacción, llamar a `updatePendingContacts(pendingRows().map(r => r.raw))` sin bloquear el ciclo si falla; verificar con una asignación de 3 contactos que tras el primer contacto `chats/<agent>-<campaign>.csv` en S3 tiene 2 filas con las columnas originales, tras el segundo 1 fila y al final solo el encabezado `contact_phone,contact_name`
- [ ] 3.3 Documentar en `v3/ana-backend/README-SUPERVISORES.md` cómo recuperar los pendientes de un agente desde `chats/{agent_id}-{campaign}.csv` y re-subirlos como asignación; verificar que el procedimiento descrito funciona con el archivo generado en 3.2

## 4. Verificación integral y release

- [ ] 4.1 Prueba de cierre a mitad de ciclo: asignación de prueba de 4 contactos propios; cerrar el CLI (Ctrl+C) durante la espera tras el contacto 2 y reabrir; verificar que solo los contactos 3 y 4 reciben mensaje, que 1 y 2 no reciben un segundo mensaje y que `resultados.csv` de la nueva ejecución lista 3 y 4
- [ ] 4.2 Prueba de cierre durante el envío: cerrar el CLI mientras está visible el overlay "Enviando Mensaje" de un contacto y reabrir; verificar que ese contacto aparece como interrumpido en `resultados.csv`, no recibe un segundo mensaje y el ciclo continúa con el siguiente
- [ ] 4.3 Agregar `assignment-journal.js` a `$filesToCopy` en `build-portable.ps1`; verificar que aparece en `dist-portable/app/` y que `ANA.bat` arranca sin `ERR_MODULE_NOT_FOUND`
- [ ] 4.4 Ejecutar `build-completo.ps1` y `npm run upload`; verificar que `versions/latest.json` publica la nueva versión y que un CLI instalado se autoactualiza y reanuda correctamente un journal creado por la propia versión nueva

## Workflow follow-up

- Archivar el cambio tras el release y confirmar que `openspec/specs/v3/automated-sending/spec.md` ya no afirma que los contactos "se reciben en el siguiente arranque".
- Seguimiento fuera de este cambio: escape correcto de comillas/saltos de línea en `contacts.ts` y autenticación de `/contacts/pending`.
