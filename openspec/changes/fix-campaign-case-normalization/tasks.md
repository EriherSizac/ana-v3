# Tasks

## 1. Infraestructura de pruebas del backend

- [ ] 1.1 Si `v3/ana-backend` aún no tiene suite (otro cambio pudo agregarla), agregar devDependencies `vitest`, `aws-sdk-client-mock` y `tsx`, el script `"test": "vitest run"` y `vitest.config.ts` con `include: ['test/**/*.test.ts']`; verificar que `npm test` corre (0 pruebas o las existentes en verde) y que `npm run build` sigue sin compilar `test/` (tsconfig incluye solo `src/**/*`)

## 2. Normalización compartida

- [ ] 2.1 Crear `v3/ana-backend/src/lib/campaign.ts` con `normalizeKeySegment(raw: unknown): string` (trim + `toLowerCase()`, `''` si no es string o queda vacío), los alias `normalizeCampaign` y `normalizeAgent`, y `credentialsKey(campaign)`; verificar con `test/campaign.test.ts` que `" Prueba "`→`prueba`, `"ERICK"`→`erick`, `"   "`→`''`, `undefined`/número→`''`, `"viñedo"`→`viñedo`, y que `credentialsKey('prueba')` es `agents/prueba/credentials.csv`

## 3. Rutas de credenciales

- [ ] 3.1 En `src/handlers/credentials.ts`, usar `normalizeCampaign` + `credentialsKey` en `getCampaignCredentials` (path param), `uploadCampaignCredentials` y `regenerateDailyPasswords` (body); tratar `''` como faltante con los 400 actuales (`Campaña requerida` / `Campaña y CSV son requeridos`) y devolver la campaña normalizada en `data.campaign` (y `data.key` en carga); verificar con `test/credentials.test.ts` (mock de S3 y `ADMIN_API_KEY` en env) que `campaign: " Prueba "` escribe/lee `agents/prueba/credentials.csv`, que `"   "` responde 400 sin llamadas a S3 y que `GET /credentials/PRUEBA` lee la llave en minúsculas
- [ ] 3.2 Verificar en las mismas pruebas que se conservan los contratos existentes: 401/503 de `X-Admin-Key` antes de tocar S3, 404 `Campaña sin credenciales…` y `CSV de credenciales no encontrado`, 400 de encabezado inválido, y que la columna `user` del CSV se guarda tal cual (sin reescribirla)

## 4. Verificación de agentes

- [ ] 4.1 En `src/handlers/auth.ts`, sustituir `campaign.toLowerCase()` por `normalizeCampaign(campaign)` (para la lectura de S3 y para `data.campaign`) y tratar `''` como campo faltante; verificar con `test/auth.test.ts` que `{"user":"Erick","campaign":" Prueba ","dailyPassword":"<frase>"}` lee `agents/prueba/credentials.csv` y responde 200 con `data.campaign: "prueba"`, que un CSV con usuario `Erick` valida al usuario `erick` (comparación existente), que `campaign: "   "` responde 400 sin acceso a S3, y que con solo `agents/Prueba/credentials.csv` en el mock responde 401 `Campaña no encontrada o sin credenciales configuradas`
- [ ] 4.2 Prueba de integración entre rutas: subir con `POST /credentials/upload` `campaign: "Prueba"` (mock S3 en memoria) y verificar con `POST /auth/verify` `campaign: "prueba"` → 200

## 5. Rutas de contactos y asignaciones

- [ ] 5.1 En `src/handlers/supervisors.ts`, normalizar agente y campaña al leer el path en `uploadAgentContacts` (llaves `assignments/`, `agents/` directo e `historic/`), `publishAgentContactsDeprecated`, `uploadAgentContactsLogging`, `getAgentContacts`, `listAgentAssignments` y `getAgentAssignments`, usando el agente normalizado tanto en el nombre de archivo como en el filtro `{agent}-contacts`, y devolviendo `agent`/`campaign`/`key`/`prefix` normalizados; verificar con `test/supervisors-case.test.ts` (mock S3, llave admin) que con `" Erick "`/`" Prueba "` cada ruta escribe `…/prueba/erick-contacts-{ts}.csv` o lista/lee ese archivo, que un objeto heredado `Erick-contacts-*.csv` no se devuelve, y que `"%20"` en agente o campaña responde 400 `Agente y campaña son requeridos` sin llamadas a S3
- [ ] 5.2 En `src/handlers/chats.ts` (`/get/chats`) y `src/handlers/contacts.ts` (`/contacts/pending`), normalizar agente y campaña antes de construir el prefijo `agents/{campaign}/`, el filtro `{agent}-contacts` y la llave `chats/{agent_id}-{campaign}.csv`; verificar con `test/chats-case.test.ts` que una carga directa de supervisor a `Erick`/`Prueba` es consumida por `GET /get/chats/erick/prueba`, y que `campaign` o `agent_id` `"   "` en `/contacts/pending` responde 400 `campaign y agent_id son requeridos`
- [ ] 5.3 Documentar en `v3/ana-backend/README-SUPERVISORES.md` y `README.md` que agente y campaña son insensibles a mayúsculas/espacios en todas las rutas (se guardan en minúsculas); verificar que la tabla de endpoints de `README.md` lo indica

## 6. Respaldos y multimedia

- [ ] 6.1 En `src/handlers/backups.ts`, `chatBackups.ts` y `media.ts`, normalizar agente y campaña antes de construir `backups/{campaign}/…` y `media/{campaign}/{agent_id}/…` (incluida la URL devuelta por `/media`), tratando `''` como faltante con los 400 actuales; verificar con `test/backups-case.test.ts` que `POST /backups/chat` con `"Erick"`/`"Prueba"` escribe en `backups/prueba/erick/…`, que `GET /backups/chats/PRUEBA/ERICK` lista ese prefijo, que `POST /backups` con `agent_id: " Erick "` es encontrado por `GET /backups/latest/erick/prueba`, que `/media` devuelve una URL con `media/prueba/erick/`, y que `npm test` y `npm run build` pasan

## 7. Migración de datos existentes

- [ ] 7.1 Crear `v3/ana-backend/scripts/migrate-campaign-case.ts` según design.md D2 (prefijos `agents/` y `assignments/agents/`, normalización de campaña y de la parte de agente del nombre de archivo, paginado, dry-run por defecto, `--apply`, `--include-ready`, `--ready-since`, `--bucket`, `--profile`, conflictos sin sobrescribir, nunca borra, nunca imprime contenido); verificar con `test/migrate-campaign-case.test.ts` contra el mock de S3: `agents/Prueba/credentials.csv` → `agents/prueba/credentials.csv`; `assignments/agents/Prueba/Erick-contacts-{ts}.csv` → `assignments/agents/prueba/erick-contacts-{ts}.csv` (timestamp intacto); `assignments/agents/prueba/Erick-contacts-{ts}.csv` (solo agente) → copia; `agents/prueba/Erick-contacts-{ts}.csv` se reporta y solo se copia con `--include-ready`; destino existente → conflicto; colisión de dos orígenes → conflicto; dry-run no emite `CopyObject`
- [ ] 7.2 Documentar en `v3/ana-backend/README-SUPERVISORES.md` cómo ejecutar el script; verificar que el comando documentado corre en dry-run contra el bucket dev (`ana-backend-storage-dev`) sin errores
- [ ] 7.3 Inventario de solo lectura en prod: `aws s3 ls s3://ana-backend-storage-prod/agents/ --recursive --profile pernexium`, lo mismo para `assignments/agents/`, y dry-run del script con `--bucket ana-backend-storage-prod`; verificar que la salida lista los agentes/campañas y objetos afectados (o ninguno) y adjuntarla al PR

## 8. Despliegue y verificación en producción

- [ ] 8.1 Desplegar (`npm run deploy -- --stage prod` en `v3/ana-backend`), ejecutar inmediatamente el script con `--apply` (y `--include-ready` solo si la revisión de fechas de 7.3 lo justifica) y resolver manualmente los conflictos; verificar con `GET /credentials/{campaña}` y `GET /supervisors/assignments/agents/{agente}/{campaña}` (con `X-Admin-Key`) que cada agente/campaña migrados responden desde las llaves en minúsculas
- [ ] 8.2 Verificar extremo a extremo: subir credenciales y una asignación directa de prueba con agente `ErickCase` y campaña `PruebaCase`, iniciar sesión desde un CLI instalado con `erickcase`/`pruebacase` y confirmar login y recepción de la asignación; luego borrar los objetos de prueba bajo `agents/pruebacase/` e `historic/agents/pruebacase/`

## Workflow follow-up

- Al archivar, revisar las notas de Purpose de `openspec/specs/v3/campaign-credentials/spec.md` y `agent-auth`.
