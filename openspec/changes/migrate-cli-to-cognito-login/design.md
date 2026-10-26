# Design

## Context

Ver proposal.md (Why). Hechos que condicionan el diseño:

- **CLI v3 1.0.46** (`v3/cli-whatsapp`): el login vive en `whatsapp.js:showLoginOverlay` (overlay en la página + `exposeFunction('verifyCredentialsBackend')`, resultado leído de `window.__loginResult`). Todas las llamadas al backend se hacen desde Node: `agent-config.js` (`/get/chats`, `/contacts/pending`, `/backups`, `/media`), `whatsapp-manual.js` (`/backups/chat*`, `/backups/chats`, `/backups/latest` vía `exposeFunction`, que hoy reciben `campaign`/`agentId` desde la página) y `whatsapp-monitor.js`. Los overlays de login de las ventanas manual y monitor (`/auth/verify`) son código muerto. Ningún archivo del repo llama a `GET /templates` (el consumidor es externo o no existe).
- Empaquetado: build portable con **Node 18.20.2** embebido y build pkg `node18-win-x64`. Las versiones actuales del AWS SDK JS v3 ya no soportan Node 18.
- Los logs del CLI imprimen respuestas completas del backend (p. ej. `[Auth Manual] Respuesta del backend`).
- **Backend v3** (`v3/ana-backend`, HTTP API + Lambda Node 20, stack prod `ana-backend-prod` us-east-1): sin authorizers; `requireAdmin` en `src/lib/adminAuth.ts`. El pool de Cognito está en **us-east-2** (`us-east-2_UepfOyKpd`).
- **v4** usa el mismo pool: Amplify v6 en el renderer, **ID token** como bearer porque el authorizer JWT de HTTP API valida `aud`, y `cognito:username` como identidad (`v4/desktop/src/lib/auth.ts`, `v4/backend/serverless.yml` authorizer `cognitoJwt`). Los desafíos que v4 ya maneja: TOTP, SMS, selección de MFA, alta de TOTP y contraseña nueva.
- **Roster**: `v3/agent-roster` (cambio `add-agent-roster-management`) guarda un objeto por campaña en `rosters/{campaign}.json` (`schemaVersion: 1`, `agents.<username>.enabled`, llaves normalizadas); habilitado solo si `enabled === true`; objeto inexistente = nadie habilitado; ilegible u otra versión = error. Este cambio solo lo lee y aplica esa regla.
- CRM: el CLI envía `user_id` fijo `6898b89b-...` (`index.js:350`, `whatsapp-manual.js:278/2272`, `whatsapp-monitor.js:532`) y una `X-Api-Key` embebida.

## Goals / Non-Goals

**Goals:**
- Una sola identidad de agente (Cognito) válida en el CLI y verificable por el backend en cada solicitud.
- Que el backend ate cada lectura/escritura al agente dueño y a una campaña donde está habilitado.
- Migrar la flota sin corte: modo reporte primero, estricto cuando los logs lo permitan, rollback por variable.

**Non-Goals:**
- `user_id` del CRM desde Cognito y quitar la `X-Api-Key` del CRM del CLI (seguimiento; ver Open Questions).
- "Olvidé mi contraseña" desde el CLI (lo resuelve el supervisor/administrador del pool).
- Autenticación de las rutas de supervisor con Cognito (siguen con `X-Admin-Key`; la web de administración es otro cambio).
- Cambiar la disposición de llaves S3 o la semántica consume-once.

## Decisions

### D1. `USER_PASSWORD_AUTH` con un app client público dedicado al CLI
Nuevo app client `ana-v3-cli` en el pool: sin secreto, flujos `ALLOW_USER_PASSWORD_AUTH` y `ALLOW_REFRESH_TOKEN_AUTH`, revocación de tokens activa, "prevent user existence errors" activo, ID/access token 60 min, refresh token 1 día. El CLI llama `InitiateAuth` / `RespondToAuthChallenge` (`SMS_MFA`, `SOFTWARE_TOKEN_MFA`, `SELECT_MFA_TYPE`, `MFA_SETUP` con `AssociateSoftwareToken` + `VerifySoftwareToken`, `NEW_PASSWORD_REQUIRED`), `InitiateAuth REFRESH_TOKEN_AUTH` y `RevokeToken`.
- Por qué un client dedicado: no se amplían los flujos del client de v4; el `aud` distingue el tráfico del CLI (la lista de audiencias del backend v3 contiene **solo** este client al inicio); duración de tokens y revocación propias.
- Alternativa: `USER_SRP_AUTH` con `amazon-cognito-identity-js` o Amplify en Node. Rechazada: la librería está en modo mantenimiento y Amplify v6 en Node exige polyfills de storage/crypto y pesa en el bundle; SRP evita que la contraseña viaje a Cognito, pero viaja por TLS directo a AWS (igual que con el Hosted UI), nunca a nuestro backend.
- Alternativa: Hosted UI / OAuth con navegador del sistema y loopback. Rechazada: el login debe vivir en el overlay de Playwright y el flujo loopback complica la instalación sin privilegios.

### D2. Cliente Cognito sin dependencias sobre la API JSON pública
`cognito-auth.js` hace `fetch` a `https://cognito-idp.us-east-2.amazonaws.com/` con `Content-Type: application/x-amz-json-1.1` y `X-Amz-Target: AWSCognitoIdentityProviderService.<Operación>`; estas operaciones no requieren firma SigV4 para un client público. ~150 líneas, funciona con el `fetch` global de Node 18 y no cambia el build.
- Alternativa: `@aws-sdk/client-cognito-identity-provider`. Rechazada por ahora: exige fijar una versión vieja compatible con Node 18 o subir el Node embebido (cambio de `cli-distribution` con su propio riesgo). Si se sube Node a 22 LTS en otro cambio, reemplazar el cliente propio por el SDK es local a este módulo.

### D3. ID token como bearer; identidad = `cognito:username` en minúsculas
Igual que v4: el authorizer JWT de HTTP API valida `aud`, que solo traen los ID tokens. `agent_id` deja de escribirse a mano: se deriva del token, de modo que el CLI nunca puede pedir datos de otro agente aunque la página le pase otros valores. Los usernames de Cognito **no** coinciden con los `agent_id` actuales (confirmado): cada agente entra con su usuario existente del pool (el mismo de v4) y no se mapea `agent_id` viejo → username. Los datos guardados bajo `agent_id` legados quedan huérfanos y se tratan en D12.

### D4. Verificación en el handler con `aws-jwt-verify`, más authorizer nativo en estricto
`src/lib/agentAuth.ts` exporta `requireAgent(event, {agent, campaign})` y `requireAgentToken(event)`; usa `CognitoJwtVerifier` (`tokenUse: 'id'`, `clientId: COGNITO_AGENT_CLIENT_IDS`), que cachea el JWKS por contenedor. Devuelve `null` (continuar) o la respuesta 401/403/503, siempre antes de cualquier llamada a S3 de datos del agente. Para rutas `POST` se parsea el body primero (las validaciones 400 existentes no tocan S3).
- El authorizer JWT de HTTP API (`cognitoAgentJwt`, issuer del pool, audience = la misma lista) no permite modo reporte, así que se adjunta: desde el inicio a `/agent/*`, y al resto de rutas de agente solo al activar el modo estricto. La verificación en el handler se mantiene siempre: da el mismo comportamiento con o sin authorizer, permite las pruebas y hace la parte de propiedad y roster que el authorizer no puede.
- Alternativa: solo authorizer. Rechazada: cortaría la flota al desplegar. Alternativa: Lambda authorizer. Rechazada: costo/latencia extra por solicitud y el roster igual necesita el agente del body.

### D5. Roster con caché de 60 s y `GET /agent/campaigns`
`isEnabled(agent, campaign)` lee `rosters/{campaign}.json` (reutilizando el lector que agregue `add-agent-roster-management` si ya existe) con la regla de habilitación de `v3/agent-roster` (ilegible u otra versión → `roster_error`), con caché en memoria del contenedor de 60 s (incluye resultados "no existe"). Con ~2 polls/min por agente evita una lectura S3 por solicitud; deshabilitar a un agente tarda ≤ 60 s. `GET /agent/campaigns` lista `rosters/` (paginado) y evalúa cada roster con la misma caché; si `v3/agent-roster` ofrece un índice por usuario, se usa ese índice.
- Alternativa: Roles API / DynamoDB de v4. Rechazada: la decisión es que el roster v3 sea la fuente de verdad, y acoplar v3 a tablas de v4 mezcla migraciones.

### D6. Transición por `AGENT_AUTH_ENFORCED` y logs estructurados
`AGENT_AUTH_ENFORCED: ${env:AGENT_AUTH_ENFORCED, 'false'}`, `COGNITO_USER_POOL_ID: ${env:COGNITO_USER_POOL_ID, 'us-east-2_UepfOyKpd'}`, `COGNITO_AGENT_CLIENT_IDS: ${env:COGNITO_AGENT_CLIENT_IDS, ''}` (coma-separado). En reporte se procesa todo y se registra `{"evt":"agent_auth","mode","route","reason","agent","campaign","user","cliVersion"}`. Metric filters de CloudWatch → métricas `AnaAgentAuth/Requests` por `reason` y `cliVersion`, y un widget de Logs Insights (`filter evt="agent_auth" | stats count() by reason, cliVersion, agent`). El CLI nuevo envía `X-Ana-Cli-Version`; un `missing` con `cliVersion: unknown` es un CLI viejo, un `not_in_roster` es un hueco del roster a corregir antes de activar.
- Las rutas `/agent/*` no tienen modo reporte (ningún CLI viejo las usa).

### D7. Sesión en disco protegida con DPAPI
`session-store.js` guarda `{username, refreshToken, issuedAt}` cifrado con `[System.Security.Cryptography.ProtectedData]::Protect(..., 'CurrentUser')` invocando `powershell.exe -NoProfile -NonInteractive` y pasando el secreto por stdin (nunca por argumentos). ID/access tokens solo en memoria en un único módulo de sesión compartido por las tres ventanas (single-flight para la renovación). Sin DPAPI (dev fuera de Windows) no se persiste.
- Alternativa: archivo en claro con ACL (`icacls`). Rechazada: un respaldo o copia del perfil lo expone. Alternativa: `keytar`/Credential Manager. Rechazada: módulo nativo que complica pkg/portable.

### D8. UX del overlay
Pasos en el mismo overlay (fondo azul, sin `alert/confirm/prompt`): usuario+contraseña → [selección de MFA] → [código | alta TOTP con QR (librería `qrcode` generada en Node como data URL) + clave] → [contraseña nueva] → campaña (selector con búsqueda) → continuar. Con sesión reutilizable: "Sesión activa: <usuario>" + campaña + "Continuar"/"Cambiar de usuario". La página solo envía entradas del usuario por `exposeFunction` y recibe `{step, error?, campaigns?}`; nunca tokens. Se borran los overlays muertos de manual y monitor.

### D9. Sesión rechazada en caliente
Ante 401: forzar renovación y reintentar una vez; si falla, o ante 403, el ciclo se trata como sin contactos, se muestra el aviso y se sigue consultando (mismo enfoque que el plan anterior: no se reabre el login en caliente por el bloqueador de clics de la ventana de automatización). Con refresh token de 1 día, el caso normal es reabrir ANA al día siguiente.

### D10. Retiro de palabra del día y `/credentials/*`
Se mantienen durante la transición (los CLIs viejos las usan para entrar). Se eliminan (funciones, handlers `auth.ts`/`credentials.ts`, rutas de `serverless.yml`, secciones del README y de `setup-campaign.sh`) cuando, con el modo estricto activo, `verifyCredentials` no tiene invocaciones durante 5 días hábiles (D11). Después se borran los `credentials.csv` (contienen frases en claro) como parte de la purga de D12, una vez que el roster está poblado.

### D11. Duraciones y periodos de observación (confirmados)
Refresh token del client `ana-v3-cli`: **1 día**. Observación: **5 días hábiles** con cero `missing`/`not_in_roster` de agentes activos antes de activar el modo estricto, y otros **5 días hábiles** sin invocaciones de `verifyCredentials` (con el estricto activo) antes de retirar `/auth/verify` y `/credentials/*`.

### D12. Datos de `agent_id` legados: se conservan los respaldos de chat, se purga el resto
Como los usernames no coinciden (D3), en la fase de retiro (tras el estricto, junto con el retiro de `/auth/verify` y `/credentials/*`) un script único `v3/ana-backend/scripts/purge-legacy-agent-data.ts` limpia lo escrito bajo `agent_id` legados:
- **Legado** = el agente de la llave no es un username del pool (`ListUsers`, normalizado) y el objeto tiene `LastModified` anterior al release del CLI (`--cutover <ISO>`). Si el agente coincide con un username del pool se reporta como ambiguo y no se toca, salvo que figure en un archivo `--treat-as-legacy` revisado por una persona. Nunca toca `versions/` (autoupdate) ni objetos de usernames de Cognito.
- **Se mueven a `legacy/`** (retención; consultables con `add-legacy-chat-history`): `backups/{campaign}/{agent}/...`, `backups/{campaign}/{YYYY-MM}/{agent}_{DD}.json` y `media/{campaign}/{agent}/...` → `legacy/backups/...` y `legacy/media/...`, conservando el resto de la llave. Copia sin sobrescribir, verificación de conteo y tamaño por prefijo, y borrado de originales solo con `--delete-source`.
- **Se purgan**: `agents/{campaign}/{agent}-contacts-*`, `assignments/agents/{campaign}/{agent}-contacts-*`, `chats/{agent}-{campaign}.csv`, `review/{campaign}/{agent}/...` (si `report-pending-progress` se publicó antes que este CLI) y `agents/{campaign}/credentials.csv`. Antes de borrar, el script exporta esas llaves (salvo `credentials.csv`) a un bucket de archivo dedicado (`ana-legacy-archive-prod`, lifecycle a Glacier) y verifica que el conteo copiado coincide. `credentials.csv` no se archiva: solo contiene frases en claro ya inútiles y archivarlas prolonga su exposición.
- Dry-run por defecto (inventario por prefijo con conteo y tamaño); `--apply` es obligatorio para mover, exportar o borrar; registra en un archivo local las llaves movidas/borradas, nunca su contenido.
- Alternativa: copiar también los respaldos al bucket de archivo. Descartada: `legacy/` ya es la retención y debe seguir consultable; el bucket de archivo solo cubre lo que se borra.
- Alternativa: conservar todo y dar una herramienta de administración por `agent_id`. Descartada por decisión del usuario: solo se conserva el historial de chats.

### Interacción con otros cambios
- `secure-assignment-consumption` (reducido a las tres lecturas `GET /supervisors/...`): no toca los requisitos de este cambio salvo `backend-api-security` "Rutas intencionalmente públicas", que ambos modifican de forma compatible (los dos quitan las lecturas de supervisor; este además quita las rutas del CLI). **Archivar `secure-assignment-consumption` antes** que este.
- `fix-campaign-case-normalization`: sigue siendo válido durante la transición (los CLIs viejos entran por `/auth/verify`). Modifica requisitos de `agent-auth` y `campaign-credentials` que este cambio elimina: **archivarlo antes**; si no se desplegó cuando se active el modo estricto, conviene recortarle la parte de credenciales y `/auth/verify` y conservar solo la normalización de asignaciones y respaldos. Además agrega normalización de campaña/agente en rutas de asignaciones y respaldos (requisitos ADDED, compatibles con los MODIFIED de este cambio); su helper `normalizeCampaign` (`trim().toLowerCase()`) se reutiliza aquí para comparar con el token y el roster.
- `fix-setup-campaign-admin-key`: tras el retiro, `setup-campaign.sh` deja de subir credenciales (tarea 8.2).
- `add-cli-remote-settings`: define `GET /agent/settings`; este cambio solo aporta la autenticación (`requireAgentToken`, authorizer). Si se despliega antes, debe usar este módulo o su propia protección temporal.
- `report-pending-progress` y `normalize-whatsapp-phone-country-code` cambian llamadas del CLI a `/contacts/pending` y `/backups/chat`: el header de autenticación lo agrega el wrapper común (`backendFetch`), sin tocar sus requisitos.
- `fix-historial-xss` corrige el render; este cambio cierra la escritura anónima en `POST /backups/chat`. Son complementarios.
- `add-agent-roster-management`: su renombrado de campañas al catálogo de v4 corre antes de la siembra de rosters (y del release de este CLI); la purga de D12 corre después de su pasada final, así que solo encuentra nombres de campaña del catálogo.
- `add-legacy-chat-history`: lee `legacy/backups/` y `legacy/media/` en solo lectura desde ANA Admin; requiere que D12 haya movido los datos.

## Risks / Trade-offs

- [Agente sin usuario en Cognito o sin roster al llegar el CLI nuevo → no puede trabajar] → Fase 0 obligatoria: alta de todos los agentes activos (desde `credentials.csv` + roster) y prueba de login de cada supervisor antes del release; verificar con `GET /agent/campaigns` por usuario.
- [Usernames de Cognito distintos a los `agent_id` actuales (confirmado) → las asignaciones pendientes bajo el `agent_id` viejo no llegan al CLI nuevo] → Antes del release, los supervisores re-suben los contactos pendientes a nombre del username de Cognito; los respaldos de chat pasan a `legacy/` y el resto se purga (D12).
- [Los respaldos de chat son historial de cobranza con posibles obligaciones de retención] → No se borran, se mueven a `legacy/`; aun así el `--apply` de la purga exige una revisión legal/de retención documentada (puerta operativa, tarea 8.4).
- [Purgar objetos de un username real que coincide con un `agent_id` legado] → Los coincidentes se reportan como ambiguos y solo se tratan si una persona los lista en `--treat-as-legacy`.
- [Activar estricto con CLIs viejos activos → sin asignaciones ni respaldos] → Criterio basado en logs (cero `missing` de agentes activos y cero `not_in_roster` durante 5 días hábiles, D11); rollback: `AGENT_AUTH_ENFORCED=false`, quitar el authorizer y redeploy.
- [Release del CLI defectuoso] → El autoupdate solo sube de versión: rollback = republicar el código anterior con versión mayor. El backend en modo reporte acepta ambos CLIs.
- [Contraseña transmitida a Cognito (no SRP)] → TLS directo a AWS, nunca se registra ni pasa por nuestro backend; MFA del pool como segundo factor.
- [Refresh token robado de la PC] → DPAPI lo ata al usuario de Windows; duración 1 día; revocable (`RevokeToken`/`AdminUserGlobalSignOut`) y deshabilitar en roster corta el acceso en ≤ 60 s.
- [Llamadas a Cognito en us-east-2 desde la red del call center] → Mismo endpoint que ya usa v4; el error de red muestra mensaje claro.
- [Consumidor externo desconocido de `GET /templates` o `/backups*`] → Los logs `missing` con `cliVersion: unknown` durante el modo reporte lo revelan; si aparece uno legítimo, se decide antes de activar el estricto.
- [Lambda sin acceso al JWKS] → `aws-jwt-verify` hace fetch HTTPS al emisor; la Lambda no está en VPC. En estricto un fallo de JWKS da 401 (fail-closed).

## Migration Plan

0. **Preparación**: crear el app client `ana-v3-cli`; confirmar que cada agente activo tiene usuario en el pool (su username existente; alta con contraseña temporal solo de los faltantes); poblar los rosters con esos usernames (`add-agent-roster-management` desplegado, con las campañas ya renombradas al catálogo); re-subir los contactos pendientes a nombre del username. Sin esto no se publica el CLI.
1. **Backend en modo reporte**: desplegar con `AGENT_AUTH_ENFORCED=false`, `COGNITO_AGENT_CLIENT_IDS=<ana-v3-cli>`; verificar que CLI 1.0.46 sigue funcionando y que aparecen logs `reason:"missing"`.
2. **Piloto**: 1–2 agentes con el CLI nuevo (`--no-self-update` desde el build); verificar `reason:"ok"` en todas las rutas.
3. **Release del CLI** por autoupdate; comunicar a los agentes el primer login (contraseña temporal → nueva → MFA si aplica).
4. **Monitoreo** durante 5 días hábiles con cero `missing`/`not_in_roster` de agentes activos (D11).
5. **Estricto**: `AGENT_AUTH_ENFORCED=true` y authorizer adjunto a todas las rutas de agente; redeploy. Rollback: revertir ambos y redeploy.
6. **Retiro**: tras 5 días hábiles sin invocaciones de `/auth/verify`, eliminar `/auth/verify` y `/credentials/*`; con la revisión legal/de retención aprobada, ejecutar `purge-legacy-agent-data.ts` (D12): mover respaldos y media legados a `legacy/`, exportar y purgar asignaciones y `chats/*.csv`, y borrar los `credentials.csv`.

## Open Questions

- `user_id` de las interacciones del CRM: si el CRM identifica usuarios por el `sub` de este mismo pool, el CLI podría enviar el `sub` del token en lugar del UUID fijo; requiere confirmar con el equipo del CRM y queda como cambio posterior de `v3/crm-interactions`.
