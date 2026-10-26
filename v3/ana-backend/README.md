## **Mapa de Endpoints**

Base URL: **`https://ow24p7ablb.execute-api.us-east-1.amazonaws.com`**

## **Agente y campaña: insensibles a mayúsculas**

En **todas** las rutas de las tablas de abajo que reciben agente (`{agent}`, `{agentId}`, `agent_id`) o campaña (`{campaign}`, `{campaignId}`, `campaign`), en la ruta o en el body, el backend quita espacios laterales y convierte a minúsculas antes de construir llaves S3: `Erick`/` Prueba ` se guardan y se leen como `erick`/`prueba` (p. ej. `agents/prueba/credentials.csv`, `agents/prueba/erick-contacts-{ts}.csv`, `backups/prueba/erick/…`). Las respuestas devuelven los valores normalizados; un valor vacío tras normalizar responde el 400 de campo requerido de cada ruta. Excepción: `/templates` (bucket del motor) no se normaliza. Los objetos antiguos con mayúsculas se rescatan con `scripts/migrate-campaign-case.ts` (ver [README-SUPERVISORES.md](README-SUPERVISORES.md#migración-de-llaves-con-mayúsculas)).

## **Autenticación de supervisor**

Las rutas de administración exigen el header `X-Admin-Key` con la llave `ADMIN_API_KEY`, definida en el `.env` de despliegue de `v3/ana-backend` (ver `.env.example`). Sin header o con llave incorrecta responden **401**; si el backend no tiene llave configurada responden **503**.

| **Método** | **Ruta** |
| --- | --- |
| **GET** | **`/credentials/{campaign}`** |
| **POST** | **`/credentials/upload`** |
| **POST** | **`/credentials/regenerate`** |
| **POST** | **`/supervisors/agents/{agent}/{campaign}/contacts`** |
| **POST** | **`/agents/{agent}/{campaign}/contacts`** (deprecated) |
| **GET** | **`/supervisors/agents/{agent}/{campaign}/contacts`** |
| **GET** | **`/supervisors/assignments/agents/{agent}/{campaign}`** |
| **GET** | **`/supervisors/assignments/agents/{agent}/{campaign}/contacts`** |
| **POST** | **`/supervisors/files/download`** |
| **POST** | **`/templates`** |

Ejemplo:

```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY"   https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/prueba
```

Para configurar una campaña de prueba completa con `setup-campaign.sh`:

```bash
export ADMIN_API_KEY=...   # o: set -a; source .env; set +a
chmod +x setup-campaign.sh
./setup-campaign.sh
```

Detalle y opciones (`BASE_URL`) en [README-SUPERVISORES.md](README-SUPERVISORES.md#ejemplo-3-script-completo-de-configuración).

### **Contactos & Chats (flujo principal)**

Agente y campaña se normalizan a minúsculas en todas estas rutas (ver arriba).

| **Método** | **Ruta** | **Handler** | **S3 Path** | **Descripción** |
| --- | --- | --- | --- | --- |
| **POST** | **`/supervisors/agents/{agent}/{campaign}/contacts`** | uploadAgentContacts | **`agents/{campaign}/`** + **`historic/`** | **Supervisor sube CSV** con mensaje. El CLI lo consume desde aquí |
| **GET** | **`/get/chats/{agentId}/{campaignId}`** | getChats | Lee y **borra** de **`agents/{campaign}/`** | **CLI descarga contactos** (consume-once) |
| **POST** | **`/agents/{agent}/{campaign}/contacts`** | publishAgentContactsDeprecated | **`agents/{campaign}/`** | **Deprecated.** Sube CSV multipart al path legacy |

### **Supervisores - Consulta**

| **Método** | **Ruta** | **Handler** | **Descripción** |
| --- | --- | --- | --- |
| **GET** | **`/supervisors/agents/{agent}/{campaign}/contacts`** | getAgentContacts | Ver contactos subidos de un agente |
| **GET** | **`/supervisors/assignments/agents/{agent}/{campaign}`** | listAgentAssignments | Listar assignments de un agente |
| **GET** | **`/supervisors/assignments/agents/{agent}/{campaign}/contacts`** | getAgentAssignments | Ver contactos en assignments |
| **POST** | **`/supervisors/files/download`** | downloadFilesByKey | Descargar archivos por S3 key |

### **Backups**

| **Método** | **Ruta** | **Handler** | **Descripción** |
| --- | --- | --- | --- |
| **POST** | **`/backups`** | **`uploadBackup`** | Subir backup general |
| **GET** | **`/backups/latest/{agentId}/{campaign}`** | **`getLatestBackup`** | Último backup de un agente |
| **POST** | **`/backups/chat`** | **`saveChatBackup`** | Guardar backup de chat individual |
| **GET** | **`/backups/chat/{campaign}/{agentId}/{contactPhone}`** | **`getChatBackup`** | Obtener backup de un chat específico |
| **GET** | **`/backups/chats/{campaign}/{agentId}`** | **`listChatBackups`** | Listar todos los chats respaldados |

### **Otros**

| **Método** | **Ruta** | **Handler** | **Descripción** |
| --- | --- | --- | --- |
| **POST** | **`/contacts/pending`** | updatePendingContacts | Actualizar contactos pendientes |
| **POST** | **`/media`** | uploadMedia | Subir media |
| **POST** | **`/auth/verify`** | **`verifyCredentials`** | Verificar credenciales |
| **GET** | **`/credentials/{campaign}`** | **`getCampaignCredentials`** | Obtener credenciales de campaña |
| **POST** | **`/credentials/upload`** | **`uploadCampaignCredentials`** | Subir credenciales |
| **POST** | **`/credentials/regenerate`** | **`regenerateDailyPasswords`** | Regenerar passwords diarios |

`/auth/verify` y `/credentials/*` (palabra del día) siguen activas solo durante
la transición al login con Cognito; se retiran al final del despliegue
(`migrate-cli-to-cognito-login` tarea 8.1).

## **Autenticación de agente (CLI v3, ID token de Cognito)**

`migrate-cli-to-cognito-login`. El CLI inicia sesión contra el pool de Pernexium
`us-east-2_UepfOyKpd` con el App Client público **`ana-v3-cli`** y envía
`Authorization: Bearer <ID token>` y `X-Ana-Cli-Version: <versión>` en todas sus
llamadas. El backend (`src/lib/agentAuth.ts`, `aws-jwt-verify`) verifica: firma
contra el JWKS del pool, `iss` del pool, `token_use=id`, `aud` ∈
`COGNITO_AGENT_CLIENT_IDS` y `exp`; luego **propiedad** (`cognito:username` en
minúsculas = agente de la ruta o del body) y **roster** (agente derivado de la
campaña sin `enabled:false`, `v3/agent-roster`, caché de 60 s). `X-Admin-Key`
**no** sustituye al token.

| **Método** | **Ruta** | **Agente / campaña de** | **Modo** |
| --- | --- | --- | --- |
| GET | `/get/chats/{agentId}/{campaignId}` | path | transición |
| POST | `/contacts/pending` | body `agent_id` / `campaign` | transición |
| POST | `/backups` | body | transición |
| GET | `/backups/latest/{agentId}/{campaign}` | path | transición |
| POST | `/backups/chat` | body | transición |
| GET | `/backups/chat/{campaign}/{agentId}/{contactPhone}` | path | transición |
| GET | `/backups/chats/{campaign}/{agentId}` | path | transición |
| POST | `/media` | body | transición |
| GET | `/templates?campaign=X&channel=Y` | solo `campaign` (query), sin agente | transición |
| GET | `/agent/campaigns` | token | **siempre estricta** + authorizer `cognitoAgentJwt` |
| GET | `/agent/settings` | token | **siempre estricta** + authorizer `cognitoAgentJwt` |

`POST /templates` sigue con `X-Admin-Key` (supervisores).

**Variables** (`serverless.yml` → `provider.environment`, ver `.env.example`):

| Variable | Default | Uso |
| --- | --- | --- |
| `AGENT_AUTH_ENFORCED` | `false` | `false` = modo reporte (registra y atiende); `true` = estricto |
| `COGNITO_USER_POOL_ID` | `us-east-2_UepfOyKpd` | emisor de los tokens (también del authorizer) |
| `COGNITO_AGENT_CLIENT_IDS` | `''` | id(s) del App Client `ana-v3-cli`, separados por coma. **Pendiente**: el client aún no existe (tarea 1.1); vacío = `/agent/*` responde 503 y en reporte las rutas registran `config:"missing"`. El authorizer `cognitoAgentJwt` toma la variable como **un solo** elemento de `audience` (placeholder `ana-v3-cli-pendiente` si falta): con más de un client hay que agregar un elemento por id en `serverless.yml`. |

**Respuestas**:

- Modo reporte: se atiende como antes y se registra el motivo.
- Modo estricto: sin token, vencido, inválido u otro client → `401 {"error":"Unauthorized"}`
  (o `401 {"message":"Unauthorized"}` del authorizer de API Gateway); agente ajeno,
  fuera del roster o roster ilegible/vencido → `403 {"error":"Forbidden"}`; siempre
  sin tocar S3.
- Estricto (o `/agent/*`) sin `COGNITO_USER_POOL_ID`/`COGNITO_AGENT_CLIENT_IDS` →
  `503 {"error":"Agent auth not configured"}`.
- `GET /agent/campaigns` → `200 {"username":"erick","campaigns":["prueba","ventas"]}`
  (habilitadas, minúsculas, orden alfabético; vacío si ninguna).

**Logs**: una línea JSON por solicitud (stdout, sin prefijo de Lambda), nunca con
el token: `{"evt":"agent_auth","mode":"report|strict","route","reason","agent","campaign","user","cliVersion"}`
con `reason` ∈ `ok|missing|invalid|expired|wrong_client|mismatch|not_in_roster|roster_error`
(`cliVersion: "unknown"` = CLI 1.0.46 o anterior). Métrica `AnaAgentAuth/Requests`
(dimensiones `reason`, `cliVersion`) por metric filter en cada función de agente, y
consulta guardada `ana-backend-{stage}/agent-auth` en Logs Insights:

```
filter evt = "agent_auth" | stats count() by reason, cliVersion, agent
```

Ejemplos (dev; `$ID_TOKEN` = ID token de un usuario de prueba emitido para `ana-v3-cli`):

```bash
# /agent/* sin token → 401 (aun en modo reporte)
curl -i https://ana-dev.pernexium.com.mx/agent/campaigns
# con token → 200 {"username":"...","campaigns":[...]}
curl -H "Authorization: Bearer $ID_TOKEN" -H "X-Ana-Cli-Version: 1.0.47" https://ana-dev.pernexium.com.mx/agent/campaigns
# modo reporte: sin token sigue respondiendo 200/404 y registra reason "missing"
curl -i https://ana-dev.pernexium.com.mx/get/chats/erick/prueba
```

**Transición y rollback** (design D6/D11): desplegar con `AGENT_AUTH_ENFORCED=false`,
publicar el CLI, observar 5 días hábiles sin `missing`/`not_in_roster` de agentes
activos y entonces `AGENT_AUTH_ENFORCED=true` + agregar `authorizer: { name: cognitoAgentJwt }`
a las 9 rutas de agente y redeploy. Rollback: `AGENT_AUTH_ENFORCED=false`, quitar ese
authorizer de las rutas fuera de `/agent/*` y redeploy.

**App Client `ana-v3-cli`** (pendiente de crear, tarea 1.1): público (sin secreto),
`ALLOW_USER_PASSWORD_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH`, revocación de tokens
activa, *prevent user existence errors* activo, ID/access 60 min, refresh 1 día.
Id: _pendiente_ (registrar aquí y en `COGNITO_AGENT_CLIENT_IDS`; el CLI lo lee de
`ANA_COGNITO_CLIENT_ID` o de `DEFAULT_COGNITO.clientId` en `v3/cli-whatsapp/cognito-auth.js`).

**Purga de datos de `agent_id` legados** (design D12, después del retiro de la
palabra del día y con la revisión legal aprobada): `scripts/purge-legacy-agent-data.ts`
(dry-run por defecto; `--apply`, `--delete-source`, `--cutover`, `--treat-as-legacy`,
`--archive-bucket`, `--profile`). Ver el encabezado del script.

## **ANA Admin: rutas `/admin/*` (id token de Cognito)**

Las rutas bajo `/admin/` las usa ANA Admin (`admin-web/`). **No aceptan
`X-Admin-Key`**: API Gateway exige un id token del pool `us-east-2_UepfOyKpd`
emitido para el App Client de ANA Admin/v4 (authorizer `cognitoAdminJwt`,
audiencia `COGNITO_ADMIN_CLIENT_IDS`, por defecto `1r6niimhkl2fmias6kk85n4ou4`).
Sin token → `401 {"message":"Unauthorized"}` sin invocar la función.

Autorización: cada handler llama a v4 `GET /me` (`ANA_V4_API_BASE`) con el
mismo token (timeout 5 s, caché 60 s por usuario) y decide con `permissions`,
`campaigns` e `isAdmin` (`src/lib/adminAccess.ts`). v4 caído →
`503 {"success":false,"message":"Autorización no disponible"}`; sin permiso →
`403 "Sin permiso"`; campaña fuera de alcance → `403 "Sin permiso para esta campaña"`.
Errores: siempre `{"success":false,"message"}` sin trazas.

Campaña y agente se normalizan (trim + minúsculas) y se validan:
campaña `^[a-z0-9][a-z0-9._-]{0,63}$`, username `^[a-z0-9][a-z0-9._@+-]{0,127}$`
(si no, 400 sin tocar S3).

### Agentes = usuarios con rol "Agente <Campaña>"

El alta de agentes **ya no** se hace con `credentials.csv`: agente de la campaña X
es un usuario del pool habilitado (`CONFIRMED` o `FORCE_CHANGE_PASSWORD`) con un
rol de la API de Roles cuyo `campaign_name` es X y cuyo nombre contiene
"agente" (envío por defecto, salvo deny `-ana:campaign:message:send`). Roles `*`,
líderes y admins no son agentes.

| Objeto S3 | Escritor | Forma |
|---|---|---|
| `campaign-agents/{campaign}.json` | solo la sincronización de v4 (cada 5 min) | `{"schemaVersion":1,"campaign","generatedAt","agents":[{"username","cognitoUsername","roleIds"}]}` |
| `rosters/{campaign}.json` | rutas `/admin/*` | `{"schemaVersion":2,"campaign","updatedAt","updatedBy","overrides":{"<username>":{"enabled","updatedAt","updatedBy"}}}` |

Regla efectiva (`src/lib/roster.ts`, la usan la autenticación del CLI y la carga
de contactos): **habilitado = figura en la lista derivada vigente (≤ 24 h) y no
tiene `enabled:false`**. Lista inexistente = sin agentes; lista o roster
ilegibles, de otra versión o vencidos = error (no se habilita a nadie).

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/admin/campaigns/{campaign}/roster` | `ana:admin:agents:manage` | lista derivada con estado efectivo + `inactiveOverrides` |
| POST | `/admin/campaigns/{campaign}/roster/agents` | `ana:admin:agents:manage` | `{"agents":[{"username","enabled"}]}` (1–200); `enabled:true` a quien no es agente → 409 |

```bash
TOKEN=<id token de ANA Admin>
curl -H "Authorization: Bearer $TOKEN" https://ana-dev.pernexium.com.mx/admin/campaigns/prueba/roster
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"agents":[{"username":"ana.lopez","enabled":false}]}' \
  https://ana-dev.pernexium.com.mx/admin/campaigns/prueba/roster/agents
```

### Renombrado de campañas al catálogo de v4

`scripts/rename-campaigns.ts` copia todos los prefijos de una campaña v3 fuera
del catálogo al nombre del catálogo (mapeo `campaign-renames.json` revisado por
una persona). Dry-run por defecto; `--apply`; `--delete-source` solo si la
verificación no encuentra diferencias. Correr **después** de
`scripts/migrate-campaign-case.ts`.

```bash
npx tsx scripts/rename-campaigns.ts --bucket ana-backend-storage-prod --profile pernexium \
  --mapping campaign-renames.json --catalog catalog.json          # dry-run + inventario
npx tsx scripts/rename-campaigns.ts ... --apply                   # primera pasada
npx tsx scripts/rename-campaigns.ts ... --apply --delete-source   # tras el modo estricto del CLI
```

### Retiro de `X-Admin-Key`

`/supervisors/*`, `/agents/{agent}/{campaign}/contacts` y `POST /templates`
siguen con llave hasta que ANA Admin cubra carga de contactos, revisión y
plantillas, `setup-campaign.sh` deje de usarse y los logs muestren 30 días sin
llamadas con llave; entonces una change dedicada las retira. `/credentials/*`
las retira `migrate-cli-to-cognito-login`.

### Carga de contactos desde ANA Admin (vía principal)

| Método | Ruta | Permisos | Descripción |
|---|---|---|---|
| POST | `/admin/campaigns/{campaign}/contacts` | `ana:contacts:list:upload` + `ana:contacts:list:distribute` | `{"uploadId","fileName","mode":"distribute"\|"single","message"?,"files":[{"agent","csv"}]}` (1–200 archivos, body ≤ 5 500 000 bytes → si no, 413) |
| GET | `/admin/campaigns/{campaign}/uploads` | los mismos | 50 cargas más recientes (manifiestos sin `message`) |

- Cada agente debe estar **habilitado** (regla efectiva del roster); si no, 409
  `Agentes no habilitados` sin escribir nada.
- Escribe `agents/{campaign}/{agent}-contacts-{ts}.csv` (lo consume el CLI con
  `GET /get/chats`) y una copia idéntica en `historic/agents/...`, con el mismo
  `{ts}`; **no** usa `assignments/`. La columna `message` se procesa igual que en
  la carga de supervisor (`src/lib/contactsCsv.ts`) y los saltos de línea del
  mensaje se convierten a `\n` literal.
- Manifiesto `uploads/{campaign}/{uploadId}.json`
  (`schemaVersion:1`, `status` `completed`/`failed`, `perAgent` con llaves).
  Reintentar el mismo `uploadId` devuelve el manifiesto `completed` sin
  duplicar archivos; un `failed` se reprocesa.
- Fallo a mitad de la carga: se borran los `agents/...` ya escritos, el
  manifiesto queda `failed` y la respuesta 500 lista `written` y `rolledBack`.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"uploadId":"20261026T100000-abcdef12","fileName":"cartera.csv","mode":"single","message":"Hola {first_name}","files":[{"agent":"ana.lopez","csv":"contact_phone,first_name\n5215500000001,Ana"}]}' \
  https://ana-dev.pernexium.com.mx/admin/campaigns/prueba/contacts
curl -H "Authorization: Bearer $TOKEN" https://ana-dev.pernexium.com.mx/admin/campaigns/prueba/uploads
```

La ruta de supervisor con `X-Admin-Key` (`/supervisors/agents/{agent}/{campaign}/contacts`)
queda como respaldo hasta el retiro de la llave.

### Configuración remota del CLI (`config/cli-settings.json`)

Documento global `{"schemaVersion":1,"settings":{...},"updatedAt","updatedBy"}`
en el bucket de almacenamiento (`src/lib/cliSettings.ts`). Catálogo cerrado:

| Llave | Tipo | Por defecto | Uso |
|---|---|---|---|
| `noWhatsappConsultRegistration` | boolean | `false` | La ventana manual ofrece registrar "Consulta No Whatsapp" en el CRM |

Configuración efectiva = defaults del catálogo + valores guardados válidos
(un `"true"` en texto o una llave desconocida se ignoran). Objeto inexistente =
defaults; ilegible u otra versión = error (no se inventan valores). Borrar el
objeto devuelve todo a los valores por defecto.

| Método | Ruta | Quién | Descripción |
|---|---|---|---|
| GET | `/admin/cli-settings` | solo rol **Developer** (de v4 `GET /me`; admin/líder no bastan → 403 `Solo Developer`) | `{settings, catalog, updatedAt, updatedBy}` |
| POST | `/admin/cli-settings` | ídem | `{"settings":{"noWhatsappConsultRegistration":true}}` (parcial); llave desconocida → 400 `Configuración desconocida: <llave>`; conflicto tras 3 intentos → 409 |
| GET | `/agent/settings` | CLI con ID token (autenticación de `migrate-cli-to-cognito-login`; se registra con su authorizer de agentes) | `{settings, updatedAt}`; objeto ilegible → 500 `{"error":"Configuración no disponible"}` |

```bash
curl -H "Authorization: Bearer $TOKEN" https://ana-dev.pernexium.com.mx/admin/cli-settings
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"settings":{"noWhatsappConsultRegistration":true}}' https://ana-dev.pernexium.com.mx/admin/cli-settings
```

Se edita desde ANA Admin → **Configuración**.

### Historial legado de chats (solo lectura)

Respaldos de `agent_id` anteriores al login Cognito, movidos por
`migrate-cli-to-cognito-login` a `legacy/backups/{campaign}/{agent}/{phone}/chat_backup.json`
y `legacy/media/{campaign}/{agent}/{filename}`. Ninguna ruta escribe en `legacy/`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/admin/campaigns/{campaign}/legacy-chats?agent=&phone=&from=&to=&page=` | búsqueda en `legacy/index/{campaign}.json` (teléfono por dígitos contenidos; `from`/`to` `YYYY-MM-DD` sobre el último mensaje; 50 por página) |
| GET | `/admin/campaigns/{campaign}/legacy-chats/{agent}/{phone}` | mensajes `{id,timestamp,from,body,media}`; media con URL prefirmada de 5 min (no imagen/audio/video → descarga); 404 `{"error":"not_found"}` |
| GET | `/admin/campaigns/{campaign}/legacy-agents` | `{campaign, agents, extractedAt}` desde `legacy/agents/{campaign}.json` |

Acceso: `isAdmin` en cualquier campaña; `isLeader` solo en sus campañas (o
`*`), según v4 `GET /me`; v4 caído → 503. Cada consulta registra
`{"evt":"legacy_chat_access","user","campaign","agent","phone","route","status"}`
sin contenido.

Regenerar el índice (idempotente; repetir tras cualquier movimiento nuevo a `legacy/`):

```bash
npx tsx scripts/build-legacy-chat-index.ts --bucket ana-backend-storage-dev --profile pernexium            # dry-run
npx tsx scripts/build-legacy-chat-index.ts --bucket ana-backend-storage-prod --profile pernexium --apply   # escribe legacy/index/*.json
npx tsx scripts/build-legacy-chat-index.ts --bucket ... --campaign prueba --apply                        # una campaña
```

### Contactos por revisar (vínculo con la carga)

- La carga de administración agrega a cada fila de `agents/` e `historic/` la
  **columna reservada `ana_upload_id`** (última columna) con el `uploadId`. Un CSV
  que ya la traiga (sin distinguir mayúsculas) → 400 `<agente>: columna reservada ana_upload_id`.
  El CLI la conserva en la fila original, así que las filas que reporta
  `report-pending-progress` en `review/{campaign}/{agent}/{assignmentId}.csv`
  llevan su `uploadId`. `resultados.csv` y el mensaje no cambian.
- `source` opcional en `POST /admin/campaigns/{c}/contacts`
  (`{"type":"review","fromUploadId","items":[{"agent","assignmentId","phone"}]}`, solo con `mode:"single"`)
  se guarda en el manifiesto de la carga de reasignación.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/admin/campaigns/{campaign}/review-items?uploadId=<id>\|none` | filas de `review/` de esa carga (o sin columna con `none`) con estado `pending`/`reassigned`/`discarded` |
| POST | `/admin/campaigns/{campaign}/review-items/resolve` | `{"action":"discard"\|"reassign","items":[...],"reassignUploadId"?}`; `reassign` exige un manifiesto `completed` cuyo `source.items` incluya los items; ya resuelto → 409 (salvo mismo `reassignUploadId`, idempotente) |

Permisos: admin o `ana:contacts:list:upload` + `ana:contacts:list:distribute`
con la campaña. Los estados viven en `review-state/{campaign}/{agent}/{assignmentId}.json`
(escritura condicional); **ninguna ruta escribe en `review/`**.
`GET /supervisors/review/{campaign}` (`X-Admin-Key`) queda como respaldo de
solo lectura hasta el retiro de la llave.

```bash
curl -H "Authorization: Bearer $TOKEN" "https://ana-dev.pernexium.com.mx/admin/campaigns/prueba/review-items?uploadId=20261026T1530-ab12cd34"
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"discard","items":[{"agent":"ana.lopez","assignmentId":"20261026T1600-deadbeef","phone":"5215500000001"}]}' \
  https://ana-dev.pernexium.com.mx/admin/campaigns/prueba/review-items/resolve
```
