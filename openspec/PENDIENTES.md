# Pendientes manuales de las changes abiertas

Auditoría del 2026-10-29 de las tareas sin marcar en `openspec/changes/*/tasks.md`. Aquí están las que necesitan una persona o un entorno real: sesión real de WhatsApp, PCs de agentes, ventanas de observación, aprobaciones, borrados en prod o activación de modos estrictos. Cada entrada lleva la change, el id de la tarea, los pasos y el criterio para marcarla.

Contexto que vale para todo el documento:

- **No hay stages dev** de v3 ni de v4. Donde una tarea dice "en dev", se prueba en prod con usuarios y campaña de prueba (`prueba`) o se decide no hacerla.
- **Perfil AWS:** `pernexium`, cuenta 509399624341. Desde WSL: `wsl -e bash -lc "aws ... --profile pernexium"`.
- **v3:** stack `ana-backend-prod`, us-east-1, `https://ana-prod.pernexium.com.mx` (`https://ow24p7ablb.execute-api.us-east-1.amazonaws.com`).
- **v4:** stack `ana-backend-prod`, us-east-2, `https://njpfef2qna.execute-api.us-east-2.amazonaws.com`. Realtime: `wss://c1azskji9l.execute-api.us-east-2.amazonaws.com/prod`.
- **ANA Admin:** Amplify `d2vf3ua8mu4yi8` (us-east-2), rama `installer-2`, `https://ana-admin.pernexium.com.mx`.

## 0. Parámetros vigentes en prod: conservarlos en cada redeploy

Un redeploy sin estos valores apaga funciones en silencio.

**v4** (`v4/backend`):

```bash
npx serverless deploy --stage prod \
  --param="issuer=https://cognito-idp.us-east-2.amazonaws.com/us-east-2_UepfOyKpd" \
  --param="clientId=<APP_CLIENT_ID vigente>" \
  --param="permissionsEnforced=report" \
  --param="mediaLegacyOwner=true" \
  --param="realtimeEnabled=true" \
  --param="jobsCampaignIndex=campaign-status-index"
```

**v3** (`v3/ana-backend`, variables de entorno al desplegar):

```bash
ADMIN_AUTH_ENFORCED=false
AGENT_AUTH_ENFORCED=false
COGNITO_AGENT_CLIENT_IDS=1r6niimhkl2fmias6kk85n4ou4
# más realtimeBusArn=arn:aws:events:us-east-2:509399624341:event-bus/ana-realtime-prod
npm run deploy -- --stage prod
```

Comprobar después (solo lectura):

```bash
aws lambda get-function-configuration --function-name ana-backend-prod-jobsPoll --region us-east-2 --profile pernexium \
  --query "Environment.Variables.[JOBS_CAMPAIGN_INDEX,PERMISSIONS_ENFORCED,MEDIA_LEGACY_OWNER,REALTIME_ENABLED]"
aws lambda get-function-configuration --function-name ana-backend-prod-getChats --region us-east-1 --profile pernexium \
  --query "Environment.Variables.[AGENT_AUTH_ENFORCED,ADMIN_AUTH_ENFORCED,COGNITO_AGENT_CLIENT_IDS]"
```

## 1. Modos estrictos y seguridad

### `migrate-cli-to-cognito-login` 7.4: monitorear 5 días hábiles

Estado: modo reporte desde el 2026-10-29. En los últimos 7 días, el CLI 1.0.48 tuvo 45 solicitudes `ok` y 0 `missing`; las solicitudes sin versión tuvieron 9 `ok` y 4 `missing`.

1. Cada día hábil, ejecutar la consulta guardada `ana-backend-prod/agent-auth` (Logs Insights, us-east-1): `filter evt="agent_auth" | stats count() by reason, cliVersion, agent`.
2. **Criterio:** durante 5 días hábiles seguidos, ningún `missing` ni `not_in_roster` de agentes activos. Registrar el resultado en `PLAN_SEGURIDAD_Y_DEUDA.md`.

### `migrate-cli-to-cognito-login` 7.5: activar `AGENT_AUTH_ENFORCED=true`

Requisito: 7.4 cumplido.

1. En `v3/ana-backend/serverless.yml`, agregar `authorizer: { name: cognitoAgentJwt }` a las 9 rutas de agente.
2. Desplegar con `AGENT_AUTH_ENFORCED=true` y el resto de la sección 0.
3. Verificar:
   - Sin token, `curl -i https://ana-prod.pernexium.com.mx/get/chats/x/prueba` y `POST /backups/chat` responden 401.
   - Con el token de otro agente, responden 403.
   - Un CLI 1.0.48 sigue operando.
4. **Rollback:** flag en `false`, quitar el authorizer y redeploy. Está documentado en `v3/ana-backend/README.md`.

### `migrate-cli-to-cognito-login` 7.2: piloto (de hecho, omitido)

Se publicó 1.0.48 directo a toda la flota. Evidencia parcial: en 7 días, 1.0.48 tuvo todo `ok` en `getChats` (12), `updatePendingContacts` (6), `agentCampaigns` (6), `agentSettings` (21) y `listChatBackups` (1). Todavía no hay tráfico de 1.0.48 en `saveChatBackup` ni en `uploadMedia`.

- **Para marcar:** confirmar con un agente que, con 1.0.48, respalda un chat y sube media, y que esas Lambdas registran `reason:"ok"`.

### `secure-assignment-consumption` 3.2 y `report-pending-progress` 3.3: activar la llave de administración

Hoy `ADMIN_AUTH_ENFORCED=false` por decisión del usuario, porque `motor-de-gestion-v2` no envía `X-Admin-Key`. Por eso `GET /supervisors/review/prueba` y `GET /supervisors/assignments/agents/x/prueba` responden 200 sin llave.

1. Hacer que `motor-de-gestion-v2` (Amplify `d3j0zjtnxx2wyg`) envíe `X-Admin-Key`, o migrarlo a las rutas `/admin/*` con id token.
2. Desplegar v3 con `ADMIN_AUTH_ENFORCED=true`.
3. Verificar que estas tres responden 401 sin llave y 200/404 con llave:
   - `GET /supervisors/agents/{a}/{c}/contacts`
   - `GET /supervisors/assignments/agents/{a}/{c}`
   - `GET /supervisors/review/prueba`
4. Verificar que `POST /contacts/pending` sin `review` responde como antes.
5. Actualizar F1.4 en `PLAN_SEGURIDAD_Y_DEUDA.md`.

### `v4-enforce-permissions` 5.4: `permissionsEnforced=true`

Estado: en `report` desde el 2026-10-27. En los últimos 3 días hubo 0 eventos `perm_would_deny`.

1. Tras 5 días hábiles, buscar `perm_would_deny` en Logs Insights (us-east-2) en los log groups `ana-backend-prod-{api,agents,jobsPoll,jobsAdmin,interactions,settings,csvTrigger}`.
2. Dar grants explícitos a quien deba operar.
3. Redeploy con `--param="permissionsEnforced=true"` (resto igual a la sección 0).
4. **Criterio:** 24 h sin 403 inesperados en `jobsPoll` ni en `interactions`. Probar con un usuario de cada tipo: admin, líder, agente y supervisor de solo lectura.

### `migrate-cli-to-cognito-login` 8.1 y 8.2: retirar palabra del día y `/credentials/*`

`verifyCredentials` tuvo 33 invocaciones en 30 días y 1 en los últimos 5.

1. **8.1:** esperar 5 días hábiles con `Invocations = 0` de `ana-backend-prod-verifyCredentials`. Después:
   - Borrar `auth.ts`, `credentials.ts`, sus rutas y sus pruebas.
   - Correr `npm test` y `npm run build`.
   - Desplegar.
   - Verificar que `POST /auth/verify` y `GET /credentials/prueba` responden 404.
2. **8.2** (después de 8.1): quitar las referencias en `setup-campaign.sh`, `README-SUPERVISORES.md`, `SUPERVISORES.md` y `README.md`. Comprobar con `rg -i "credentials|palabra del d|dailyPassword" v3/ana-backend --glob '!node_modules'`.

> **Riesgo abierto (2026-10-29):** `GET https://ana-prod.pernexium.com.mx/credentials/prueba` responde **200 sin llave** con el CSV de credenciales de la campaña, porque `ADMIN_AUTH_ENFORCED=false`. Cualquiera puede leer las credenciales de cualquier campaña. El CLI 1.0.48 ya no las usa, así que conviene adelantar 8.1 o activar la llave de administración en cuanto `motor-de-gestion-v2` la envíe.

## 2. Datos en prod: migraciones, borrados y aprobación legal

### `migrate-cli-to-cognito-login` 8.4: aprobación legal y de retención

Obtener una aprobación escrita, con fecha, responsable y plazo de caducidad, para el archivo de respaldos de chat (historial de cobranza) y de `credentials.csv`. Registrarla en `PLAN_SEGURIDAD_Y_DEUDA.md`. **Bloquea 8.5.**

### `migrate-cli-to-cognito-login` 8.5: bucket de archivo y purga de legados

1. Crear `ana-legacy-archive-prod` con:
   - bloqueo total de acceso público;
   - SSE-KMS y versionado;
   - política que solo permita el rol de administración;
   - lifecycle a Glacier a los 30 días y caducidad según 8.4.
2. Desde `v3/ana-backend`, correr `npx tsx scripts/purge-legacy-agent-data.ts --bucket ana-backend-storage-prod --profile pernexium` en dry-run y adjuntar el inventario (solo conteos).
3. Correr `--apply`. Después, `--apply --delete-source`.
4. Verificar:
   - `aws s3api get-bucket-policy` y `get-public-access-block` muestran solo el rol de administración.
   - `aws s3 ls --recursive --summarize` no encuentra `credentials.csv`, asignaciones, `historic/` ni `chats/*.csv` de `agent_id` legados.
   - Existen `legacy/agents/{campaign}.json`, y `legacy/backups/` y `legacy/media/` tienen los conteos del inventario.
   - `versions/` no cambió.

### `add-legacy-chat-history` 4.1 y 4.2

Requisito: 8.5 terminado. Hoy el dry-run del índice da "Sin respaldos legados".

1. Correr `npx tsx scripts/build-legacy-chat-index.ts --bucket ana-backend-storage-prod --profile pernexium` (dry-run) y después con `--apply`.
2. Verificar que existe un `legacy/index/{campaign}.json` por campaña y que los conteos coinciden con el inventario de 8.5.
3. **4.2:** en ANA Admin → Historial legacy, con un admin y con un líder:
   - buscar por teléfono y por fecha;
   - abrir una conversación con imagen;
   - comprobar que al líder se le bloquea una campaña ajena;
   - comprobar que la línea `legacy_chat_access` de CloudWatch no lleva contenido.

### `add-agent-roster-management` 3.4: renombrado de campañas al catálogo

La migración de mayúsculas ya se confirmó: el dry-run dio copy=0.

1. Preparar `campaign-renames.json` y `catalog.json`. Una persona revisa el mapeo y queda registrada en el PR.
2. Correr `npx tsx scripts/rename-campaigns.ts --bucket ana-backend-storage-prod --profile pernexium --mapping campaign-renames.json --catalog catalog.json` (dry-run) y después con `--apply`.
3. Verificar que cada campaña v3 con datos corresponde a una del catálogo. Adjuntar el reporte, sin contenidos.

### `add-agent-roster-management` 3.6

Requisito: el estricto de 7.5. Correr la segunda pasada `--apply --delete-source` de `rename-campaigns.ts` y verificar con `aws s3 ls` que no quedan prefijos viejos.

### `v4-canonical-identity-keys` 6.5

Requisito: una semana sin incidentes desde el 2026-10-27, o sea, a partir del 2026-11-03.

1. Correr `npx tsx scripts/migrate-canonical-ids.ts --apply --delete-source` en `v4/backend`, con el perfil `pernexium`.
2. Redeploy con `--param="mediaLegacyOwner=false"` (resto igual a la sección 0).
3. Verificar que las llaves legadas ya no existen y que `GET /media/url` con un segmento legado responde 403.

### `v4-harden-send-job-queue` 7.3: Deploy C

Deploy B entró el 2026-10-27 y ya pasó más de un día.

1. Quitar `campaign-index` de `JobsTable` en `v4/backend/serverless.yml` y cambiar el default de `JOBS_CAMPAIGN_INDEX` a `campaign-status-index`.
2. Desplegar prod con los parámetros de la sección 0.
3. Verificar que `aws dynamodb describe-table --table-name ana-backend-jobs-prod --region us-east-2 --profile pernexium` muestra solo `campaign-status-index` y que `GET /jobs/summary` sigue respondiendo.

### `fix-campaign-case-normalization` 8.2

Esta prueba usa login con credenciales y palabra del día, y el CLI 1.0.48 ya inicia sesión con Cognito, así que el flujo quedó obsoleto. Opciones:

- reformular la prueba: subir desde ANA Admin a `ErickCase` en `PruebaCase` y que lo reciba un CLI con el usuario Cognito `erickcase`; o
- cerrarla como superada por `migrate-cli-to-cognito-login`.

Si se hace, borrar al final `agents/pruebacase/` y `historic/agents/pruebacase/`.

## 3. Pruebas en WhatsApp Web real (CLI v3 1.0.48)

Se necesita una PC con ANA 1.0.48, un número de prueba y un agente y campaña de prueba (`prueba`).

| Change / tarea | Qué probar |
|---|---|
| `fix-historial-xss` 5.1 | Enviar al agente `<img src=x onerror=alert(1)>`, `<script>alert(2)</script>` y `"><svg onload=alert(3)>`; esperar el respaldo; abrir "📜 Ver Historial" → fila → "📜 Ver". Debe verse sin `alert`, con el texto literal y sin interacción en el CRM. |
| `fix-historial-xss` 5.2 | Plantar un mensaje HTML con `curl -X POST https://ana-prod.pernexium.com.mx/backups/chat` (campaña y agente de prueba) y repetir 5.1 desde la lista y desde la burbuja. |
| `fix-historial-xss` 5.3 | Regresión de "⬆️ Subir gestión" (debe salir "✅ Gestión subida") y de "💬 Abrir chat" desde el historial. |
| `fix-manual-window-keyboard-block` 3.1–3.6 | En el cuadro de mensaje, con teclado Español (Latinoamérica) y Español (España): AltGr+Q `@`, AltGr+`'` `\`, AltGr+`+` `~`, Alt+64, AltGr+2/3/E/`+`/`ç`. Probar menciones `@` en un grupo, Ctrl+C/X/Z/Y/A/Retroceso/flechas y los bloqueos (F12, Ctrl+Shift+I/J/C, Ctrl+U/S/P/O, Alt+←/→, Ctrl+Alt+N/Retroceso), F5, y `@` y Ctrl+V en "Subir gestión" y "Ver Historial". |
| `fix-no-whatsapp-modal-duplicates` 3.1 | Con el ajuste `noWhatsappConsultRegistration=false` y 3 o más `no_whatsapp` en `resultados.csv`, abrir el modal 3 veces. No debe haber botón ni interacciones nuevas, ni existir `%APPDATA%\ANA\no-whatsapp-consultas.json`. |
| `fix-no-whatsapp-modal-duplicates` 3.2–3.3 | Activar el ajuste en ANA Admin → Configuración (Developer) y pulsar "Registrar consulta (3)". Deben quedar 3 interacciones `no_whatsapp_info_registered` y el estado "Consulta ya registrada hoy". Reiniciar: sin pendientes. Apagar: el botón desaparece en ≤ 5 min. |
| `fix-cli-double-brace-templates` 3.2 | Asignación `direct: true` con plantilla `Hola {{name}} / {first_name} / {{total_balance}} / {{total_balance * 0.5}}`. El mensaje debe llegar sin llaves y `resultados.csv` debe decir `sent`. |
| `normalize-whatsapp-phone-country-code` 4.2 | Un contacto de 10 dígitos y otro `521…`. Los dos deben recibir el mensaje, las interacciones deben llevar `phone_number` de 10 dígitos y el monitor debe registrar la respuesta. |
| `fix-interaction-date-timezone` 2.4 | Después de las 18:00 de México, con la PC en zona UTC: un envío automático, una gestión y una respuesta detectada. En los payloads, `contact_date` debe ser la fecha de México y `contact_time`/`range_time` la hora de México. |
| `report-pending-progress` 4.1 | Asignación de 4 contactos; Ctrl+C tras el 2 y reabrir. Solo deben recibir el 3 y el 4. |
| `report-pending-progress` 4.2 | Cerrar con el overlay "Enviando Mensaje" visible y reabrir. Ese contacto debe quedar `por_revisar` en `resultados.csv` y en ANA Admin (detalle de la carga), sin reenvío. |

## 4. Releases en PCs reales

| Change / tarea | Qué probar |
|---|---|
| `fix-historial-xss` 6.2, `fix-manual-window-keyboard-block` 4.3, `fix-no-whatsapp-modal-duplicates` 4.2 | En una PC de agente con ANA anterior a 1.0.47, reiniciar y ver en la consola "Auto-update" la descarga de 1.0.48. Después repetir 5.1 de XSS, comprobar que se puede escribir `@` con teclado latinoamericano y que el modal no registra al abrir. |
| `v4-harden-desktop-shell` 6.1 | Instalar `ana Setup 1.4.0.exe` en al menos dos PCs reales con su antivirus. WhatsApp debe conectar con sandbox, AltGr debe escribir `@` en la respuesta y los envíos de campaña deben funcionar. |
| `v4-fix-desktop-session-lifecycle` 6.3 | En una PC con la versión anterior a 1.3.0: se actualiza sola en ≤ 30 min; tras 2 h "Mi asignación" sigue cargando; con el QR pendiente aparece inactivo en `GET /agents`. |
| `add-realtime-v4-desktop` 4.1 | 1.4.0 está publicado con la URL embebida, pero `AnaRealtime/ActiveConnections{client=desktop}` = 0 del 26 al 28 de octubre: todavía ninguna PC se conectó. En una PC con 1.4.0, confirmar `ActiveConnections{client=desktop}` ≥ 1, jobs en < 3 s y un cambio de `sendMinGapSeconds` aplicado en < 3 s. |

## 5. Realtime: pruebas y ventanas de observación

| Change / tarea | Qué hacer |
|---|---|
| `add-realtime-gateway` 5.3 | Prueba de apagado con un cliente conectado. Necesita redeploy de prod con `realtimeEnabled=false` y luego `true`. Criterio: cierre en ≤ 5 min, reconexión 403, REST sin cambios. Hacerla en ventana acordada. |
| `add-realtime-gateway` 6.4 | Dos conexiones (`cli` de un usuario de prueba y otra de otro usuario), con `wscat -c "wss://c1azskji9l.execute-api.us-east-2.amazonaws.com/prod?client=cli&v=test" -s ana.v1 -s <idToken>`. Forzar `{"scope":"user","username":"<u>"}` desde ANA Admin: solo el primero debe recibir `session.refresh`. Repetir guardando permisos de un rol del usuario. |
| `add-realtime-v3-cli` 4.2 | El publish a la flota ya se hizo (1.0.48). Falta la primera semana: comparar en CloudWatch las invocaciones de `ana-backend-prod-getChats` contra la semana previa y confirmar que no saltó la alarma `realtime-post-failing`. |
| `add-realtime-v4-desktop` 3.3 | Resiliencia: cortar la red 3 min y restaurar (debe reconectar y consultar una vez). Con `realtimeEnabled=false`, el poll debe volver a 5 s en ≤ 5 min. Revisar los logs del main y `jobsPoll` en CloudWatch. |
| `add-realtime-v4-desktop` 4.2 | La primera semana tras la adopción de 1.4.0: menos invocaciones de `jobsPoll` y sin alarmas `realtime-post-failing`. |
| Alarmas | `ana-backend-prod-{agent-sync-failing,realtime-post-failing,realtime-notify-errors,realtime-authorizer-errors}` no tienen `AlarmActions`. **Decidir el destino SNS** (tema y suscriptores) y agregarlo en `v4/backend/serverless.yml`. |

## 6. Pruebas de punta a punta con usuarios reales (ANA Admin + clientes)

| Change / tarea | Qué probar |
|---|---|
| `add-admin-web-foundation` 6.3 | Aceptación: SSO desde otra app Pernexium del apex, login con MFA, gate con un agente ("Sin acceso"), un líder y un admin, y cierre de sesión. |
| `add-agent-roster-management` 5.1 | Asignar a un usuario de prueba un rol de `prueba` con `ana:campaign:message:send`. Debe aparecer en `campaign-agents/prueba.json` en ≤ 5 min y como "Agente" en ANA Admin. Deshabilitarlo en v3 y v4, quitar el rol y comprobar que sale. La parte `AGENT_ROSTER_FILTER=true` necesita `AGENT_ROSTER_FILTER=true` en v4 (hoy `false` en las Lambdas de prod). |
| `add-cli-remote-settings` 4.1 | Un Developer activa el flag. `config/cli-settings.json` debe registrar autor y fecha, un CLI con token debe recibirlo en `GET /agent/settings` y debe aparecer el botón del modal; al apagarlo desaparece en ≤ 5 min. |
| `add-contact-upload-console` 5.1 | v3: repartir entre 2 agentes habilitados y comprobar que el CLI consume. v4: asignar a un agente y comprobar que solo ese agente recibe jobs y que el historial trae los mismos conteos que la vista previa. |
| `link-review-contacts-to-uploads` 4.1 | Cargar desde ANA Admin, cerrar el CLI durante el envío, ver el contacto en el detalle de la carga, reasignarlo a otro agente (que lo recibe por `GET /get/chats`) y comprobar el estado "Reasignado". |
| `v4-secure-direct-send` 5.2 | No hay dev. En prod: la key nueva (SSM `/ana/v4/prod/send-api-key`, entregada por canal seguro) debe dar 200 con un envío de prueba real; la expuesta 401 (ya verificado); una ráfaga de más de 10 solicitudes debe dar 429; un agente inexistente, 400. |

## 7. Coordinación con personas

| Change / tarea | Qué hacer |
|---|---|
| `migrate-cli-to-cognito-login` 1.2 | Con cada supervisor, listar los agentes activos y su username de Cognito; dar de alta a quien falte con un rol de la campaña con `ana:campaign:message:send`. Comprobar con `aws cognito-idp admin-get-user --user-pool-id us-east-2_UepfOyKpd --username <u> --region us-east-2 --profile pernexium` que el estado es `CONFIRMED` o `FORCE_CHANGE_PASSWORD`. |
| `migrate-cli-to-cognito-login` 1.3 y `add-agent-roster-management` 3.5 | Por campaña activa, confirmar con su líder que cada agente activo tiene usuario y rol "Agente <Campaña>". Comparar con `aws s3 cp s3://ana-backend-storage-prod/campaign-agents/<c>.json - --profile pernexium` y `rosters/<c>.json`. Registrar el resultado por campaña en `PLAN_SEGURIDAD_Y_DEUDA.md`. |
| `migrate-cli-to-cognito-login` 1.4 | Pedir a los supervisores que re-suban los pendientes de `agent_id` legados a nombre del username de Cognito. Revisar con `aws s3 ls s3://ana-backend-storage-prod/assignments/agents/ --recursive --profile pernexium` (solo nombres). |
| `fix-interaction-date-timezone` 3.2 | Avisar a quien opera los reportes del CRM que, desde 1.0.47, las interacciones de 18:00–23:59 llevan la fecha correcta, y cómo identificar las históricas. Guardar la confirmación escrita. |

## 8. Aceptación pendiente de tareas ya marcadas

Estas tareas se marcaron `[x]` porque el entregable existe (código con pruebas en verde, deploy o release verificados en solo lectura). Les falta una prueba manual de aceptación; la nota de cada tarea dice qué se verificó.

| Change | Tareas | Prueba manual faltante |
|---|---|---|
| `add-admin-web-foundation` | 6.1, 6.2 | Ver correr el workflow `admin-web` en un PR (requiere push) y `GET /api/me` 200 con sesión real. |
| `add-agent-roster-management` | 3.7, 4.4, 5.2 | `curl` documentados con id token; `/api/users` 200 con sesión; un agente deshabilitado deja de ver la campaña en `GET /agent/campaigns` en ≤ 60 s. |
| `add-cli-remote-settings` | 2.2 | Cambiar el flag en ANA Admin y verlo en la ventana manual en ≤ 5 min. |
| `add-realtime-admin-web` | 4.1, 4.2 | Repartir desde Contactos actualiza "Mi asignación" de otro usuario en < 3 s; indicador "En vivo"; "Forzar actualización". |
| `add-realtime-gateway` | 2.4, 5.2 | `ping`→`pong` con token; `PostFailed` forzado. |
| `add-realtime-v3-cli` | 3.3, 4.1 | Publicar desde "Mi asignación" inicia el ciclo en < 3 s; `ANA_REALTIME=off` muestra "Próximo poll"; probar el `.exe` en una PC limpia. |
| `add-realtime-v4-desktop` | 3.1, 3.2 | Repartir aparece en < 3 s; `{"scope":"user"}` forzado relee `/me`. |
| `fix-cli-double-brace-templates`, `fix-interaction-date-timezone`, `normalize-whatsapp-phone-country-code`, `report-pending-progress`, `migrate-cli-to-cognito-login` | 4.2; 3.3; 4.3; 4.4; 7.3 | Un CLI instalado se autoactualiza a 1.0.48 (el `.exe` ya es público); `report-pending-progress` además reanuda un journal propio. |
| `fix-historial-xss` / `fix-no-whatsapp-modal-duplicates` / `normalize-whatsapp-phone-country-code` / `report-pending-progress` / `fix-manual-window-keyboard-block` | Código de la ventana manual | Cubierto por las pruebas de la sección 3. |
| `migrate-cli-to-cognito-login` | 5.1, 5.2, 5.4, 6.1–6.3 | Login con TOTP, SMS, alta TOTP y contraseña temporal; `.agent-session` sin tokens en claro y descartado en otro usuario de Windows; avisos 401/403 con el estricto; `--logout` revoca el refresh token. |
| `v4-add-desktop-remote-settings` | 2.3, 5.1–5.3 | `GET /settings` con defaults y 403 sin Developer; en la PC piloto, abrir un chat no llama `/interactions/open`; cambio reversible de `sendMinGapSeconds` 120 → 150 → 120. |
| `v4-canonical-identity-keys` | 3.1, 6.2, 6.4 | Un usuario con ñ o acentos ve su historial y su media y conecta WhatsApp sin QR. |
| `v4-enforce-permissions` | 3.2, 3.3, 5.3 | Un líder ve "Ver como" con sus agentes; un rol con `-ana:chats:message:reply` no puede responder. |
| `v4-fix-conversation-backup` | 3.2, 3.3, 5.1, 5.2 | "Cargar más" con más de 200 mensajes; mensaje desde el teléfono vinculado; `GET /conversations?limit=2` trae `nextToken`. |
| `v4-fix-crm-interactions` | 3.2, 5.1, 5.2 | Doble clic en "Registrar" crea una sola interacción; una interacción a las 19:xx llega con la fecha del día. |
| `v4-fix-desktop-messaging` | 2.3, 3.1, 5.1 | Dos CSV con plantillas distintas; `{apodo}` deshabilita el botón; WhatsApp desconectado conserva el texto; doble Enter. |
| `v4-fix-desktop-session-lifecycle` | 2.4, 2.5, 3.2, 4.2, 6.1 | Token de 5 min sigue operando a los 15; `admin-user-global-sign-out` muestra el aviso sin pedir QR; sin heartbeat con QR visible; UpdateGate sin red. |
| `v4-harden-desktop-shell` | 2.1, 3.2, 4.1, 6.2 | Enlace `https` abre el navegador; `window.require` es `undefined`; sin violaciones de CSP en el build empaquetado; `chrome.exe` sin `--no-sandbox`; un día sin reportes de WhatsApp sin conectar. |
| `v4-harden-send-job-queue` | 7.1, 7.2 | Carga de prueba: el resumen no cuenta enviados, dos cargas iguales crean jobs distintos y reassign sin `skipped` por historial. |
| `v4-normalize-phone-mx` | 1.4, 4.1, 4.2 | CSV con `12345` → "Error" sin `PATCH /phone`; un `044…` de prueba llega. |
| `v4-review-interrupted-sends` | 3.2, 3.3, 5.1–5.3 | Cerrar durante "escribiendo…" y reabrir 11 min después: aparece "Por revisar"; claim 200/409; resolve `discard`; flujo en ANA Admin. |
| `v4-secure-direct-send` | 5.3 | Una semana de 401 de `directSend` en CloudWatch. |
| `link-review-contacts-to-uploads` | 2.3, 3.5 | `curl` con id token y el flujo con un `*.example.csv`. |
