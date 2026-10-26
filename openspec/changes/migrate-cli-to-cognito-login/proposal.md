# Proposal

## Why

Hoy el CLI v3 inicia sesión con usuario + campaña + "palabra del día" contra `agents/{campaign}/credentials.csv` (`POST /auth/verify`), una respuesta que es solo un acuse: ninguna ruta posterior verifica identidad. Cualquiera que conozca un agente y una campaña puede consumir (y borrar) su asignación en `GET /get/chats`, leer o escribir sus respaldos (`/backups*`, incluido plantar payloads XSS en el Historial vía `POST /backups/chat`), subir media o sobrescribir sus pendientes. La palabra del día es además un secreto compartido que se reparte a mano cada día. Se decidió mover el CLI al User Pool de Cognito de Pernexium (`us-east-2_UepfOyKpd`), el mismo que usa v4, y autorizar por campaña con el roster de agentes habilitados (`v3/agent-roster`).

## What Changes

- **CLI (`v3/cli-whatsapp`)**: el overlay de login pide **usuario (username, no email) y contraseña** de Cognito; maneja los desafíos de MFA (código SMS/TOTP, selección de método, alta de TOTP) y de contraseña nueva obligatoria; después ofrece **solo las campañas donde el usuario está habilitado** (consulta `GET /agent/campaigns`).
- El CLI guarda el refresh token cifrado con DPAPI del usuario de Windows, renueva los tokens en silencio, envía `Authorization: Bearer <id token>` en **todas** sus llamadas al backend v3, nunca registra tokens/contraseñas/códigos ni los expone a la página de WhatsApp Web, y ofrece "Continuar", "Cambiar de usuario" y `--logout`.
- **Backend (`v3/ana-backend`)**: nueva verificación de identidad de agente con el ID token de Cognito (emisor del pool, `token_use=id`, audiencia en una lista de app clients) en las rutas de agente: `GET /get/chats/...`, `POST /contacts/pending`, `POST /backups`, `GET /backups/latest/...`, `POST /backups/chat`, `GET /backups/chat/...`, `GET /backups/chats/...`, `POST /media`, `GET /templates`, la nueva `GET /agent/campaigns` y `GET /agent/settings` (definida por `add-cli-remote-settings`).
- Autorización por propiedad + roster: el agente de la ruta o del body MUST ser el `cognito:username` del token (en minúsculas) y estar habilitado en esa campaña según `v3/agent-roster` (agente derivado de un rol de la campaña con `ana:campaign:message:send`, sin excepción de deshabilitación); `X-Admin-Key` no sustituye al token en estas rutas.
- Nueva ruta `GET /agent/campaigns` (JWT) que devuelve las campañas habilitadas del usuario según `v3/agent-roster`.
- Transición controlada por `AGENT_AUTH_ENFORCED`: en modo reporte (inicial) las solicitudes sin token o no autorizadas se atienden y se registran (con versión del CLI); en modo estricto se rechazan (401/403) sin tocar S3, y además se adjunta el authorizer JWT nativo de HTTP API a las rutas de agente.
- **BREAKING** (al final del despliegue): se retiran `POST /auth/verify`, `GET /credentials/{campaign}`, `POST /credentials/upload` y `POST /credentials/regenerate`, y la palabra del día deja de existir; se borran los `credentials.csv` de S3. Los CLIs que no se actualicen dejan de recibir asignaciones y de respaldar al activar el modo estricto.
- **Datos de `agent_id` legados** (los usernames de Cognito no coinciden con los `agent_id` actuales): al final del despliegue, un script único con dry-run por defecto mueve los respaldos de chat y su media a `legacy/` (se conservan como historial, consultable con `add-legacy-chat-history`) extrae solo los usernames legados por campaña a `legacy/agents/{campaign}.json` (referencia para el historial; nunca las frases) y archiva en un bucket restringido y luego purga las asignaciones (incluidas las copias de `historic/`), `chats/*.csv`, `review*/` y `credentials.csv` de esos `agent_id`, previa revisión legal/de retención.
- Nuevo app client público de Cognito para el CLI (sin secreto, `ALLOW_USER_PASSWORD_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH`, revocación de tokens activa), incluido en la lista de audiencias del backend v3.
- Fuera de alcance: alimentar el `user_id` fijo de las interacciones del CRM con la identidad de Cognito, la llave del CRM embebida en el CLI y el flujo "olvidé mi contraseña" desde el CLI (ver design.md).

## Capabilities

### New Capabilities

_Ninguna._ (Consume `v3/agent-roster`, definida por `add-agent-roster-management`.)

### Modified Capabilities

- `v3/agent-auth`: deja de ser la verificación de palabra del día (requisitos REMOVED) y pasa a definir la verificación del ID token de Cognito, la identidad del agente, la autorización por roster, el modo de transición y `GET /agent/campaigns`.
- `v3/cli-agent-session`: login Cognito con desafíos MFA/contraseña nueva, selección de campaña, almacenamiento protegido y renovación de la sesión, envío del token en todas las llamadas, sesión expirada/revocada, cierre de sesión y cambio de usuario.
- `v3/backend-api-security`: las rutas del CLI dejan de ser públicas; se agrega la autenticación de agente y el authorizer JWT; las rutas de credenciales salen de la lista de llave de administración.
- `v3/agent-assignments`: `GET /get/chats` y `POST /contacts/pending` exigen autenticación de agente con propiedad y roster.
- `v3/chat-backups`: las seis rutas de respaldos y media exigen autenticación de agente con propiedad y roster.
- `v3/message-templates`: `GET /templates` exige autenticación de agente y campaña habilitada.
- `v3/campaign-credentials`: se retira la capacidad completa (todos sus requisitos REMOVED; `retire_capabilities: true`).

## Impact

- Backend: nuevo `src/lib/agentAuth.ts` (verificación JWT, roster, modo), handlers `chats.ts`, `contacts.ts`, `backups.ts`, `chatBackups.ts`, `media.ts`, `templates.ts`, nuevo handler `agent.ts` (`GET /agent/campaigns`); al final se eliminan `auth.ts` y `credentials.ts`; script `scripts/purge-legacy-agent-data.ts`. `serverless.yml`: variables `COGNITO_USER_POOL_ID`, `COGNITO_AGENT_CLIENT_IDS`, `AGENT_AUTH_ENFORCED`, authorizer `cognitoAgentJwt`. Dependencia nueva: `aws-jwt-verify`.
- CLI: `whatsapp.js` (overlay), nuevo `cognito-auth.js` y `session-store.js`, `agent-config.js`, `index.js`, `whatsapp-manual.js`, `whatsapp-monitor.js` (llamadas autenticadas; se borra el login muerto con palabra del día), `config.js`; dependencia nueva `qrcode` (alta de TOTP); el cliente de Cognito usa `fetch` sin SDK (Node 18 embebido); release por autoupdate (`cli-distribution`).
- Cognito: app client nuevo en el pool compartido; todos los agentes necesitan usuario en el pool y un rol de su campaña con `ana:campaign:message:send` (agentes derivados de `v3/agent-roster`) **antes** del release del CLI.
- Operación: métricas/logs de llamadas sin token por versión del CLI, criterio de activación del modo estricto (5 días hábiles), rollback por variable y redeploy.
- Datos: `legacy/backups/`, `legacy/media/` y `legacy/agents/` nuevos en `ana-backend-storage-prod`; bucket de archivo `ana-legacy-archive-prod` (acceso solo administración, SSE, Glacier) para lo purgado, incluidos los `credentials.csv`; los contactos pendientes de `agent_id` legados se re-suben al username de Cognito antes del release.
- Otros cambios: `secure-assignment-consumption` queda reducido a las lecturas de supervisor y debe archivarse antes que este; `fix-campaign-case-normalization` sigue válido durante la transición y debe archivarse antes (o abandonarse); `fix-setup-campaign-admin-key` y `add-cli-remote-settings` se coordinan (ver design.md).
- Documentación: `v3/ana-backend/README.md`, `README-SUPERVISORES.md`, `SUPERVISORES.md`, `v3/cli-whatsapp/README-USUARIO.md`, `HISTORIAL.md`, `PLAN_SEGURIDAD_Y_DEUDA.md`.
