# Tasks

## 1. Helper de fecha/hora y pruebas

- [x] 1.1 Si no existe por otro cambio, agregar a `v3/cli-whatsapp/package.json` el script `"test": "node --test test/"`; verificar que `npm test` corre en `v3/cli-whatsapp`
- [x] 1.2 Crear `v3/cli-whatsapp/interaction-time.js` con `INTERACTIONS_TIME_ZONE` e `interactionDateTime(date, timeZone)` según design D2 (un solo `formatToParts`, `hourCycle: 'h23'`, formateador cacheado, fallback a hora local con advertencia si `Intl` rechaza la zona); verificar con `npm test`
- [x] 1.3 Escribir `test/interaction-time.test.js` con los instantes de design D3 (19:40 del día anterior en UTC, 23:59 → `23:00 - 00:00`, 00:05 → `00:00 - 01:00`, abril en UTC-6) y la comparación en procesos hijos con `TZ=UTC` y `TZ=Asia/Tokyo`; verificar que `npm test` pasa en la máquina de desarrollo

## 2. Uso en todos los sitios que registran interacciones

- [x] 2.1 Reemplazar el bloque `now/contact_date/hh/mm/nextH` de `index.js:491-495` por `interactionDateTime()` y expandir sus tres campos en la interacción automática; verificar con `grep -n "toISOString().slice(0, 10)" v3/cli-whatsapp/index.js` sin resultados y con el log `📤 [insertInteractions] Payload enviado` de un envío de prueba — (verificado 2026-10-29: `grep -n "toISOString().slice(0, 10)" v3/cli-whatsapp/index.js` sin resultados; la interacción automática usa `interactionDateTime()` (index.js:727); `test/interaction-time.test.js` en verde)
- [x] 2.2 Hacer lo mismo en `submitGestionInteraction` (`whatsapp-manual.js:2286`) y `submitNoWhatsappInfoInteraction` (`whatsapp-manual.js:326`); si `fix-no-whatsapp-modal-duplicates` ya se aplicó, usar también `interactionDateTime().contact_date` para su agrupación "por fecha local"; verificar con el mismo `grep` sobre `whatsapp-manual.js`
- [x] 2.3 Hacer lo mismo en `whatsapp-monitor.js:533`; verificar con `grep` sobre `whatsapp-monitor.js` (el `getHours` del log "Poll tick" puede quedar, no es dato del CRM)
- [ ] 2.4 Verificación manual después de las 18:00 hora de México, con el equipo de prueba en zona UTC: un envío automático, una gestión manual y una respuesta detectada por el monitor; verificar en los payloads registrados en consola que `contact_date` es la fecha de México y `contact_time`/`range_time` la hora de México

## 3. Empaquetado y release

- [x] 3.1 Agregar `interaction-time.js` a `$filesToCopy` en `build-portable.ps1`; verificar que aparece en `dist-portable/app/`, que `ANA.bat` arranca sin `ERR_MODULE_NOT_FOUND` y que `dist-portable\nodejs\node.exe -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City'}).format(new Date()))"` imprime la fecha de México — (verificado 2026-10-29: `interaction-time.js` en `$filesToCopy` y en `dist-portable/app/` del build 1.0.48; los 29 módulos de `app/` importan con `dist-portable/nodejs/node.exe` 18.20.2 sin `ERR_MODULE_NOT_FOUND`; `dist-portable\nodejs\node.exe` imprime la fecha de México 2026-10-29)
- [ ] 3.2 Avisar a quien opera los reportes del CRM que, desde esta versión, las interacciones de 18:00–23:59 quedan con la fecha correcta y cómo identificar las históricas (design, Risks); verificar con confirmación escrita del aviso
- [x] 3.3 Ejecutar `build-completo.ps1` y `npm run upload`; verificar que `versions/latest.json` publica la nueva versión y que un CLI instalado se autoactualiza — (verificado 2026-10-29: CLI 1.0.48 publicado; `versions/latest.json` = 1.0.48 y GET público 200 de `ANA-1.0.48.exe`/`ANA-latest.exe` (antes 403); autoactualización de un CLI instalado en openspec/PENDIENTES.md)

## Workflow follow-up

- Archivar el cambio tras el release y confirmar que las notas sobre `contact_date` en UTC desaparecen de `v3/crm-interactions` y `v3/manual-gestion`.
