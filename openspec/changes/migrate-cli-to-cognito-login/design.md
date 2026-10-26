# Design

## Context

Ver proposal.md (Why). Hechos que condicionan el diseño:

- **CLI v3 1.0.46** (`v3/cli-whatsapp`): el login vive en `whatsapp.js:showLoginOverlay` (overlay en la página + `exposeFunction('verifyCredentialsBackend')`, resultado leído de `window.__loginResult`). Todas las llamadas al backend se hacen desde Node: `agent-config.js` (`/get/chats`, `/contacts/pending`, `/backups`, `/media`), `whatsapp-manual.js` (`/backups/chat*`, `/backups/chats`, `/backups/latest` vía `exposeFunction`, que hoy reciben `campaign`/`agentId` desde la página) y `whatsapp-monitor.js`. Los overlays de login de las ventanas manual y monitor (`/auth/verify`) son código muerto. Ningún archivo del repo llama a `GET /templates` (el consumidor es externo o no existe).
- Empaquetado: build portable con **Node 18.20.2** embebido y build pkg `node18-win-x64`. Las versiones actuales del AWS SDK JS v3 ya no soportan Node 18.
- Los logs del CLI imprimen respuestas completas del backend (p. ej. `[Auth Manual] Respuesta del backend`).
- **Backend v3** (`v3/ana-backend`, HTTP API + Lambda Node 20, stack prod `ana-backend-prod` us-east-1): sin authorizers; `requireAdmin` en `src/lib/adminAuth.ts`. El pool de Cognito está en **us-east-2** (`us-east-2_UepfOyKpd`).
- **v4** usa el mismo pool: Amplify v6 en el renderer, **ID token** como bearer porque el authorizer JWT de HTTP API valida `aud`, y `cognito:username` como identidad (`v4/desktop/src/lib/auth.ts`, `v4/backend/serverless.yml` authorizer `cognitoJwt`). Los desafíos que v4 ya maneja: TOTP, SMS, selección de MFA, alta de TOTP y contraseña nueva.
- **Roster**: `v3/agent-roster` (cambio `add-agent-roster-management`) deriva los agentes de cada campaña de los roles del pool (rol de la campaña con `ana:campaign:message:send`) en `campaign-agents/{campaign}.json` (sincronización de v4 cada 5 min, vigente ≤ 24 h) y guarda solo excepciones en `rosters/{campaign}.json` (`schemaVersion: 2`, `overrides.<username>.enabled`). Habilitado = derivado ∧ no `enabled:false`; lista inexistente = nadie; ilegible, vencida u otra versión = error. Este cambio solo lo lee y aplica esa regla.
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
`isEnabled(agent, campaign)` lee `campaign-agents/{campaign}.json` y `rosters/{campaign}.json` con el lector de `add-agent-roster-management` (`src/lib/roster.ts`) y su regla efectiva (ilegible, vencida u otra versión → `roster_error`), con caché en memoria del contenedor de 60 s (incluye resultados "no existe"). Con ~2 polls/min por agente evita una lectura S3 por solicitud; una excepción tarda ≤ 60 s y un cambio de rol ≤ 5 min + 60 s. `GET /agent/campaigns` lista `campaign-agents/` (paginado) y evalúa cada campaña con la misma caché.
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
Se mantienen durante la transición (los CLIs viejos las usan para entrar). Se eliminan (funciones, handlers `auth.ts`/`credentials.ts`, rutas de `serverless.yml`, secciones del README y de `setup-campaign.sh`) cuando, con el modo estricto activo, `verifyCredentials` no tiene invocaciones durante 5 días hábiles (D11). Después, en la purga de D12, se extraen solo los usernames de cada `credentials.csv` a `legacy/agents/{campaign}.json`, se archiva el archivo en el bucket de archivo y se borra del bucket de datos.

### D11. Duraciones y periodos de observación (confirmados)
Refresh token del client `ana-v3-cli`: **1 día**. Observación: **5 días hábiles** con cero `missing`/`not_in_roster` de agentes activos antes de activar el modo estricto, y otros **5 días hábiles** sin invocaciones de `verifyCredentials` (con el estricto activo) antes de retirar `/auth/verify` y `/credentials/*`.

### D12. Datos de `agent_id` legados: se conservan los respaldos de chat y la lista de nombres, se archiva y purga el resto
Como los usernames no coinciden (D3), en la fase de retiro (tras el estricto, junto con el retiro de `/auth/verify` y `/credentials/*`) un script único `v3/ana-backend/scripts/purge-legacy-agent-data.ts` limpia lo escrito bajo `agent_id` legados:
- **Legado** = el agente de la llave no es un username del pool (`ListUsers`, normalizado) y el objeto tiene `LastModified` anterior al release del CLI (`--cutover <ISO>`). Si el agente coincide con un username del pool se reporta como ambiguo y no se toca, salvo que figure en un archivo `--treat-as-legacy` revisado por una persona. Nunca toca `versions/` (autoupdate), `campaign-agents/`, `rosters/` ni objetos de usernames de Cognito (p. ej. las copias en `historic/` que escribe `add-contact-upload-console` tras el cutover). Un `agent_id` legado nunca se habilita por coincidir con un username: la pertenencia solo sale de los roles (`add-agent-roster-management` D10/D11).
- **Lista de agentes legados** (referencia del historial, la usa `add-legacy-chat-history`): antes de tocar cada `agents/{campaign}/credentials.csv`, el script extrae **solo la columna de usuario** (normalizada, sin duplicados, ordenada; nunca la frase) y escribe `legacy/agents/{campaign}.json` = `{"schemaVersion":1,"campaign","agents":[...],"extractedAt"}`. Se agregan también los `agent_id` legados que aparezcan en `backups/` y `media/` de la campaña sin estar en el CSV, para que el filtro del historial los incluya. No se escribe si ya existe con el mismo contenido (corridas repetibles).
- **Se mueven a `legacy/`** (retención; consultables con `add-legacy-chat-history`): `backups/{campaign}/{agent}/...`, `backups/{campaign}/{YYYY-MM}/{agent}_{DD}.json` y `media/{campaign}/{agent}/...` → `legacy/backups/...` y `legacy/media/...`, conservando el resto de la llave. Copia sin sobrescribir, verificación de conteo y tamaño por prefijo, y borrado de originales solo con `--delete-source`.
- **Se archivan y purgan**: `agents/{campaign}/{agent}-contacts-*`, `assignments/agents/{campaign}/{agent}-contacts-*`, `historic/agents/{campaign}/{agent}-contacts-*`, `chats/{agent}-{campaign}.csv`, `review/{campaign}/{agent}/...` y `review-state/{campaign}/{agent}/...` (si existen) y `agents/{campaign}/credentials.csv`. Antes de borrar, el script copia todas esas llaves al bucket de archivo `ana-legacy-archive-prod` (misma llave) y verifica que el conteo copiado coincide; si no coincide, aborta sin borrar. `credentials.csv` se archiva igual que el resto (decisión del usuario), después de extraer la lista de nombres.
- **Bucket de archivo**: bloqueo total de acceso público, SSE (KMS administrada), versionado, política que solo permite acceso a un rol de administración (sin acceso de las Lambdas de la app ni de usuarios de desarrollo), lifecycle a Glacier a los 30 días y caducidad según la revisión legal/de retención (tarea 8.4).
- Dry-run por defecto (inventario por prefijo con conteo y tamaño, y conteo de nombres por campaña); `--apply` es obligatorio para extraer, mover, archivar o borrar; registra en un archivo local las llaves movidas/archivadas/borradas, nunca su contenido.
- Alternativa: no archivar `credentials.csv` (versión anterior de este diseño). Descartada por decisión del usuario: el archivo se conserva como evidencia en el bucket de archivo restringido.
- Alternativa: copiar también los respaldos al bucket de archivo. Descartada: `legacy/` ya es la retención y debe seguir consultable.
- Alternativa: conservar todo y dar una herramienta de administración por `agent_id`. Descartada por decisión del usuario: solo se conservan el historial de chats y la lista de nombres.

### Interacción con otros cambios
- `secure-assignment-consumption` (reducido a las tres lecturas `GET /supervisors/...`): no toca los requisitos de este cambio salvo `backend-api-security` "Rutas intencionalmente públicas", que ambos modifican de forma compatible (los dos quitan las lecturas de supervisor; este además quita las rutas del CLI). **Archivar `secure-assignment-consumption` antes** que este.
- `fix-campaign-case-normalization`: sigue siendo válido durante la transición (los CLIs viejos entran por `/auth/verify`). Modifica requisitos de `agent-auth` y `campaign-credentials` que este cambio elimina: **archivarlo antes**; si no se desplegó cuando se active el modo estricto, conviene recortarle la parte de credenciales y `/auth/verify` y conservar solo la normalización de asignaciones y respaldos. Además agrega normalización de campaña/agente en rutas de asignaciones y respaldos (requisitos ADDED, compatibles con los MODIFIED de este cambio); su helper `normalizeCampaign` (`trim().toLowerCase()`) se reutiliza aquí para comparar con el token y el roster.
- `fix-setup-campaign-admin-key`: tras el retiro, `setup-campaign.sh` deja de subir credenciales (tarea 8.2).
- `add-cli-remote-settings`: define `GET /agent/settings`; este cambio solo aporta la autenticación (`requireAgentToken`, authorizer). Si se despliega antes, debe usar este módulo o su propia protección temporal.
- `report-pending-progress` y `normalize-whatsapp-phone-country-code` cambian llamadas del CLI a `/contacts/pending` y `/backups/chat`: el header de autenticación lo agrega el wrapper común (`backendFetch`), sin tocar sus requisitos.
- `fix-historial-xss` corrige el render; este cambio cierra la escritura anónima en `POST /backups/chat`. Son complementarios.
- `add-agent-roster-management`: los agentes se derivan de los roles (sin siembra desde `credentials.csv`); su renombrado de campañas al catálogo de v4 corre antes del release de este CLI y la purga de D12 corre después de su pasada final (`--delete-source`), así que solo encuentra nombres de campaña del catálogo, incluidos `credentials.csv` e `historic/`.
- `add-contact-upload-console` escribe `historic/agents/{campaign}/{username}-contacts-*` con usernames de Cognito tras el cutover: la detección de legado los excluye. `link-review-contacts-to-uploads` agrega `review-state/`, que D12 trata igual que `review/`.
- `add-legacy-chat-history`: lee `legacy/backups/`, `legacy/media/` y `legacy/agents/` en solo lectura desde ANA Admin; requiere que D12 haya movido los datos y extraído la lista de nombres.

## Risks / Trade-offs

- [Agente sin usuario en Cognito o sin rol de envío en su campaña al llegar el CLI nuevo → no puede trabajar] → Fase 0 obligatoria: cada agente activo con usuario en el pool y un rol de su campaña que otorgue `ana:campaign:message:send` (checklist de `add-agent-roster-management`, tarea 3.5) y prueba de login de cada supervisor antes del release; verificar con `GET /agent/campaigns` por usuario. Los agentes legados no se trasladan.
- [Usernames de Cognito distintos a los `agent_id` actuales (confirmado) → las asignaciones pendientes bajo el `agent_id` viejo no llegan al CLI nuevo] → Antes del release, los supervisores re-suben los contactos pendientes a nombre del username de Cognito; los respaldos de chat pasan a `legacy/` y el resto se purga (D12).
- [Los respaldos de chat son historial de cobranza con posibles obligaciones de retención] → No se borran, se mueven a `legacy/`; aun así el `--apply` de la purga exige una revisión legal/de retención documentada (puerta operativa, tarea 8.4).
- [Purgar objetos de un username real que coincide con un `agent_id` legado] → Los coincidentes se reportan como ambiguos y solo se tratan si una persona los lista en `--treat-as-legacy`; en ningún caso esa coincidencia habilita al usuario (la pertenencia sale solo de roles).
- [El bucket de archivo conserva `credentials.csv` con frases del día en claro (ya inútiles, pero reutilizables si alguien repitió la frase en otro sistema)] → bloqueo de acceso público, SSE, acceso solo para un rol de administración, lifecycle a Glacier y caducidad definida en la revisión de retención (D12, tarea 8.5); las frases nunca se copian a `legacy/` ni a logs.
- [Activar estricto con CLIs viejos activos → sin asignaciones ni respaldos] → Criterio basado en logs (cero `missing` de agentes activos y cero `not_in_roster` durante 5 días hábiles, D11); rollback: `AGENT_AUTH_ENFORCED=false`, quitar el authorizer y redeploy.
- [Release del CLI defectuoso] → El autoupdate solo sube de versión: rollback = republicar el código anterior con versión mayor. El backend en modo reporte acepta ambos CLIs.
- [Contraseña transmitida a Cognito (no SRP)] → TLS directo a AWS, nunca se registra ni pasa por nuestro backend; MFA del pool como segundo factor.
- [Refresh token robado de la PC] → DPAPI lo ata al usuario de Windows; duración 1 día; revocable (`RevokeToken`/`AdminUserGlobalSignOut`) y deshabilitar en roster corta el acceso en ≤ 60 s.
- [Llamadas a Cognito en us-east-2 desde la red del call center] → Mismo endpoint que ya usa v4; el error de red muestra mensaje claro.
- [Consumidor externo desconocido de `GET /templates` o `/backups*`] → Los logs `missing` con `cliVersion: unknown` durante el modo reporte lo revelan; si aparece uno legítimo, se decide antes de activar el estricto.
- [Lambda sin acceso al JWKS] → `aws-jwt-verify` hace fetch HTTPS al emisor; la Lambda no está en VPC. En estricto un fallo de JWKS da 401 (fail-closed).

## Migration Plan

0. **Preparación**: crear el app client `ana-v3-cli`; confirmar que cada agente activo tiene usuario en el pool (su username existente; alta con contraseña temporal solo de los faltantes); confirmar que cada uno tiene un rol de su campaña con `ana:campaign:message:send` y aparece en `campaign-agents/{campaign}.json` (`add-agent-roster-management` desplegado, con las campañas ya renombradas al catálogo); re-subir los contactos pendientes a nombre del username. Sin esto no se publica el CLI.
1. **Backend en modo reporte**: desplegar con `AGENT_AUTH_ENFORCED=false`, `COGNITO_AGENT_CLIENT_IDS=<ana-v3-cli>`; verificar que CLI 1.0.46 sigue funcionando y que aparecen logs `reason:"missing"`.
2. **Piloto**: 1–2 agentes con el CLI nuevo (`--no-self-update` desde el build); verificar `reason:"ok"` en todas las rutas.
3. **Release del CLI** por autoupdate; comunicar a los agentes el primer login (contraseña temporal → nueva → MFA si aplica).
4. **Monitoreo** durante 5 días hábiles con cero `missing`/`not_in_roster` de agentes activos (D11).
5. **Estricto**: `AGENT_AUTH_ENFORCED=true` y authorizer adjunto a todas las rutas de agente; redeploy. Rollback: revertir ambos y redeploy.
6. **Retiro**: tras 5 días hábiles sin invocaciones de `/auth/verify`, eliminar `/auth/verify` y `/credentials/*`; con la revisión legal/de retención aprobada, ejecutar `purge-legacy-agent-data.ts` (D12): extraer los nombres a `legacy/agents/`, mover respaldos y media legados a `legacy/`, y archivar y purgar asignaciones, `historic/`, `chats/*.csv`, `review*/` y `credentials.csv`.

## Open Questions

- `user_id` de las interacciones del CRM: si el CRM identifica usuarios por el `sub` de este mismo pool, el CLI podría enviar el `sub` del token en lugar del UUID fijo; requiere confirmar con el equipo del CRM y queda como cambio posterior de `v3/crm-interactions`.

## Decisiones de implementación

Decisiones mínimas tomadas al implementar, consistentes con los specs:

- **DPAPI por `-Command -`** (D7): `session-store.js` invoca `powershell.exe -NoProfile -NonInteractive -Command -` y manda por stdin el script de una línea con el dato en base64; nada sensible va en argumentos. Se descartó `-EncodedCommand`: en el equipo de desarrollo la creación del proceso con el script codificado fue bloqueada (`spawn EPERM`, política de seguridad del endpoint), riesgo que también existe en las PCs del call center. Se usa una entropía fija de la aplicación (no secreta). El archivo es `{"v":1,"protection":"dpapi-currentuser","data":<base64>}` y cifra todo `{username, refreshToken, issuedAt}`. Un fallo de descifrado (otra cuenta/PC, archivo corrupto) borra el archivo; un fallo transitorio de PowerShell (timeout/no disponible) no lo borra.
- **Modo reporte sin configuración**: si falta `COGNITO_USER_POOL_ID` o `COGNITO_AGENT_CLIENT_IDS` en modo reporte, las solicitudes con token se registran con `reason:"invalid"` y el campo extra `config:"missing"` (sin token siguen siendo `missing`); en estricto y en `/agent/*` responde 503.
- **Logs `agent_auth` por `process.stdout.write`** (no `console.log`) para que la línea sea JSON puro sin el prefijo de Lambda y los metric filters JSON (`{ $.evt = "agent_auth" }`) puedan extraer `reason` y `cliVersion`. `cliVersion` se sanea (`^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$`, si no `unknown`) para no crear dimensiones arbitrarias.
- **Authorizer `cognitoAgentJwt`**: `audience` toma `COGNITO_AGENT_CLIENT_IDS` como un solo elemento (placeholder `ana-v3-cli-pendiente` si falta, que rechaza todo). Con más de un client se agrega un elemento por id en `serverless.yml`. El emisor usa `COGNITO_USER_POOL_ID`.
- **Validaciones 400 antes de autenticar**: los handlers mantienen sus 400 de parámetros/body (no tocan S3) antes de `requireAgent`; en estricto una solicitud sin token y sin parámetros recibe 400.
- **`GET /templates`**: el roster se evalúa con `campaign` normalizada; el prefijo del bucket de templates sigue usando el valor recibido (la ruta no normaliza, igual que antes).
- **`GET /agent/campaigns`**: si la lista de una campaña es ilegible o está vencida, esa campaña se omite (fail-closed) y se registra `agent_campaigns_roster_error`; las demás se evalúan normalmente.
- **App Client del CLI**: `DEFAULT_COGNITO.clientId` queda vacío hasta crear `ana-v3-cli` (tarea 1.1); se configura con `ANA_COGNITO_CLIENT_ID`. Sin client id el overlay muestra "ANA no tiene configurado el inicio de sesión; contacta a soporte" sin llamar a Cognito. Antes del release (7.3) hay que fijar el id en `cognito-auth.js`.
- **Configuración remota**: `remote-settings.js` conserva su propio `fetch` inyectable (ya diseñado en `add-cli-remote-settings`, con `setTokenProvider`), ahora con el ID token de la sesión y `X-Ana-Cli-Version` de `getCliVersion()`; es la única llamada al backend v3 fuera de `backendFetch`. El resto (asignaciones, pendientes, respaldos, historial, media, campañas) pasa por `backend-client.js`.
- **Identidad para el backend**: `agent-config.js` y la ventana manual toman `agent_id`/`campaign` de `agentSession.identity()`; los argumentos de la página se ignoran. `.agent-config.json` se sigue escribiendo tras el login (solo `agent_id` y `campaign`) y lo usan el CRM y el registro local de asignaciones.
- **Arranque**: se quitó la doble inicialización de la ventana de automatización (nota del spec): `initWhatsApp()` corre una sola vez y muestra el login; "No hay credenciales configuradas" se imprime si no existe `.agent-session`; si tras el login no hay identidad se imprime "Configura credenciales y vuelve a ejecutar". La campaña para el CRM se calcula después del login.
- **Sesión rechazada (D9)**: con un aviso activo, cada ciclo consulta `GET /agent/campaigns` para detectar si el agente recuperó el acceso a su campaña; mientras el aviso siga no se consumen asignaciones ni se reanuda el registro local. El aviso se muestra en consola y en el widget de estado con la cuenta regresiva del siguiente intento.
- **Login**: la máquina de estados vive en Node (`login-flow.js`); el overlay (`login-overlay.js`) se dibuja con `textContent` y se vuelve a dibujar en `load`. El QR se genera en Node con `qrcode` (data URL) y la URI `otpauth://totp/ANA:<usuario>?secret=…&issuer=ANA`. Solo se soporta alta de TOTP (no SMS) en `MFA_SETUP`.
- **Purga (D12)**: `chats/{agent}-{campaign}.csv` se asigna a la campaña conocida más larga que sea sufijo; `credentials.csv` siempre se archiva y purga (no depende del cutover); objetos con `LastModified` ≥ cutover son "nuevos" y no se tocan; la columna de usuario de `credentials.csv` se detecta por encabezado (`user`, `usuario`, `agent_id`, `agent`, `username`; si no, la primera). `ListUsers` usa `@aws-sdk/client-cognito-identity-provider` como devDependency (solo el script). El log local se escribe solo con `--apply`. Repetir la corrida no reescribe `legacy/agents/` si los agentes no cambiaron y marca los movidos como idénticos.
