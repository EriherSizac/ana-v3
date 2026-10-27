# ana — Arquitectura

App de envío/gestión de WhatsApp para cobranza (Pernexium). Reescritura completa.

## Decisiones fijas

| Tema | Decisión | Por qué |
|------|----------|---------|
| Motor WhatsApp | `whatsapp-web.js` (Puppeteer + Chromium) | Gratis, sin verificación Meta. Corre **local** (Lambda no puede sostener sesión persistente). |
| App | **Electron desktop** (React + Vite + TS) | La sesión WA debe vivir en una máquina persistente. UI + motor en una sola pieza. |
| Backend | **Serverless** AWS (Lambda + DynamoDB + S3 + SQS) | Datos/orquestación sin EC2. Nunca toca WhatsApp. |
| Auth | **Cognito hosted UI / PKCE** contra el User Pool de Pernexium | Mismas cuentas/permisos que el resto de apps. **No** hay SSO por cookie (Electron no vive en `*.pernexium.com.mx`); login explícito en la app. |
| Trigger nube→local | **Polling a tabla DynamoDB de jobs** (PK=operatorId, sin lease: estados) | Lambda no puede push a la PC local (sin IP pública). SQS compartido no aísla por operador → tabla jobs por operatorId. Intervalo corto (~4s), no long-poll. |
| Enmascarado números | **Solo visual en UI** | Número plano en DynamoDB; la UI muestra `***1234`. |
| Storage | DynamoDB (conversaciones/mensajes), S3 (CSV + media backup) | Resuelve concurrencia, escala, fuente de verdad para restore. |

## Topología

```
┌─────────────────────────────────────┐        ┌────────────────────────────────────┐
│  ELECTRON (PC del operador)          │        │  AWS  (backend/serverless.yml)       │
│                                      │        │                                      │
│  Main process (Node):               │        │  Cognito User Pool (Pernexium)       │
│   · whatsapp-web.js + Chromium       │        │  API Gateway (HTTP API, JWT auth)    │
│   · envía / recibe real              │◄──────►│  Lambda:                             │
│   · jobs poller (~4s)                │ HTTPS  │    · api      (conversaciones CRUD)  │
│   · token de Amplify (renderer)      │ +token │    · csvTrigger (S3 → tabla jobs)    │
│                                      │        │    · jobsPoll  (poll/ack por op.)    │
│  Renderer (React + Vite):           │        │  DynamoDB: conversations, messages,  │
│   · login (username, fondo azul)     │        │            jobs (PK operatorId)      │
│   · chats / restore desde Dynamo     │        │  S3: csv-uploads, media-backup       │
│   · sube CSV → S3                    │        │                                      │
└─────────────────────────────────────┘        └────────────────────────────────────┘
```

## Flujos

### Envío masivo vía bucket
1. UI pide presign a `api` (config de campaña fijada en metadata firmada) y sube CSV a S3 (`csv-uploads/`).
2. Evento S3 dispara `csvTrigger` → parsea filas → escribe N jobs en la tabla `jobs` (PK=operatorId del presign). El identificador de carga (`campaignid`) lo genera el servidor (key sin `csv-uploads/`); el `campaignId` del cliente viaja como `label`. `jobId = <campaignid>#<índice>`, así dos cargas nunca se pisan. Un marcador `UPLOAD#<srcKey>` evita reprocesar eventos S3 duplicados; al escribir todos los jobs se borra el CSV.
3. Main process pollea `GET /jobs/poll` (~5s) → backend devuelve los jobs del propio operador sin lease: primero los pendientes (hasta 2000, orden de `jobId`) y los 300 procesados más recientes; `truncated`/`pendingTotal` avisan si quedaron pendientes fuera. El agente aprueba qué enviar.
4. Por cada job: normaliza teléfono, interpola plantilla, `client.sendMessage`.
5. Reporta resultado → `PUT /messages` → DynamoDB. `POST /jobs/ack` marca cada job `sent`/`no_whatsapp`/`error` (no lo borra; queda como historial hasta el TTL de 7 días) y responde `{acked, notFound, invalid}`.

### Envíos interrumpidos (por revisar)
Estados de un job: `pending` (o sin estado / `leased` heredado) → `sending` → `sent`/`no_whatsapp`/`error`; o `sending` → `review` → `discarded` (con o sin reencolado).
1. Ya cumplido el ritmo, el desktop reserva el job con `POST /jobs/claim {jobId}` (`pending` → `sending`, `claimedAt`, `attempts` + 1). 409 → no lo envía (reasignado o ya tomado); error de red → no lo envía y sigue con el siguiente.
2. Tras enviar, `POST /jobs/ack` con hasta 3 reintentos (1 s, 5 s, 30 s). El acuse se acepta desde `pending`, `sending` o `review` (el resultado real gana); desde `discarded` u otro final distinto va a `invalid`.
3. Un `sending` con `claimedAt` de **más de 10 minutos** pasa a `review` (`reviewReason: "interrupted"`, `reviewAt`) cuando lo leen `GET /jobs/poll` del dueño, `GET /jobs/summary` o `GET /jobs/review` (paso perezoso, sin proceso programado). Nunca vuelve solo a `pending`.
4. El desktop muestra `sending`/`review` en "Por revisar" (solo lectura); el líder ve "N por revisar" en el panel de pendientes y resuelve desde ANA Admin: `GET /jobs/review?campaign=&srcKey=` y `POST /jobs/review/resolve {campaign, items:[{operatorId,jobId}], action:"discard"|"requeue", to?}` (1–100 items). `requeue` deja el original `discarded` con `resolution:"requeued"` y crea `<jobId>~r<epochMs>` `pending` en `to` (o el mismo agente).

### Recepción
1. `client.on('message')` en main. Si trae media → `downloadMedia` → `POST /media/presign` → PUT a `MediaBucket` (`media/<op>/`).
2. `PUT /messages` → DynamoDB guarda el **puntero** (`mediaKey`), nunca los bytes. Renderer escucha evento IPC → actualiza vista.

### Sesión, presencia y actualización (desktop)
- **Token**: el renderer (Amplify) entrega el **ID token** al main y lo renueva 5 min antes de `exp` (`fetchAuthSession({ forceRefresh: true })`). El main (`electron/auth/tokenBroker.ts`) pide uno nuevo (`auth:token-request`, espera 10 s) si al suyo le quedan < 2 min, y ante un 401 invalida, pide otro y reintenta una vez (backend, poller y respaldo de sesión WhatsApp). Si la sesión no se puede renovar, la app vuelve al login con "Tu sesión expiró. Vuelve a iniciar sesión."; el main detiene poller y heartbeat **sin** borrar la sesión local de WhatsApp.
- **Poller**: un 401/500/error de red no publica una asignación vacía; se conserva la última.
- **Heartbeat**: `POST /agents/heartbeat` solo con WhatsApp `connected` (no en QR/autenticando): al registrar campaña, al conectar y cada 5 min.
- **Actualización**: listeners/intervalo del updater se registran una vez por proceso (`electron/update/updaterCore.ts`); sin bypass "continuar sin actualizar" (error → Reintentar + reintento cada 60 s; salida solo con contraseña maestra de Sistemas, ver README). Al descargar, el poller deja de iniciar jobs y se espera el job en curso (máx 3 min) antes de cerrar WhatsApp e instalar.

### Restore conversaciones
- UI pide `GET /conversations` y `GET /conversations/{chatId}/messages` → DynamoDB es la fuente de verdad. Local es solo caché de sesión viva.
- **Paginación** (`backend/src/lib/conversations.ts`): `GET /conversations?limit=&nextToken=` consulta el GSI `operator-recent-index` (`operatorId` + `lastMessageTime`, más reciente primero; `limit` default 100, máx. 200). `GET /conversations/{chatId}/messages?limit=&nextToken=` devuelve los `limit` más recientes (default 200, máx. 500) en orden ascendente; `nextToken` (base64url de `LastEvaluatedKey`) trae la página siguiente/anterior; un token inválido o de otra partición → 400 `{"error":"nextToken inválido"}`. El desktop muestra "Cargar más" y "Ver mensajes anteriores".
- **Resumen**: `PUT /messages` solo actualiza la conversación si el mensaje es nuevo; `lastMessage`/`lastMessageTime` solo si es igual o más reciente; `unreadCount` +1 solo para entrantes. `POST /conversations/{chatId}/read` pone `unreadCount = 0` en la conversación propia (no la crea); el desktop la llama al abrir un chat propio.
- **Mensajes propios de otros dispositivos**: el cliente escucha `message_create` con `fromMe` y los respalda igual que los entrantes. Los enviados por la app usan el `timestamp` de WhatsApp, así ambos caminos producen la misma `sk` y el mensaje queda una sola vez.

## Identidad y llaves (`backend/src/lib/identity.ts`)

- **operatorId canónico**: `cognito:username` (o `sub`) sin espacios laterales y en minúsculas (`Ana.Lopez` → `ana.lopez`). Lo aplican `claimUser`, `resolveUserAccess` (superadmin, caché, roles), los destinatarios del reparto (Dashboard y `assignments`, deduplicados y con pesos sumados) y el desktop (`usernameFromJwt`, `.ana-last-operator`).
- **Segmento de operador en S3** (`media/<seg>/`, `wa-sessions/<seg>/session.zip`, `csv-uploads/<seg>/`): `encodeKeySegment` conserva `[a-z0-9._-]` y escribe cualquier otro byte UTF-8 como `~` + 2 hex (`a@b` → `a~40b`, `~` → `~7e`, `.`/`..` → `~2e`/`~2e~2e`). Es inyectiva: `a@b` y `a_b` ya no comparten prefijo ni sesión de WhatsApp. `GET /media/url` decodifica el dueño (`decodeKeySegment`; inválido → 400 `key inválida`). Durante la transición, `MEDIA_LEGACY_OWNER=true` acepta además el segmento saneado anterior del propio usuario.
- **Campañas**: se comparan sin espacios laterales ni mayúsculas (`sameCampaign`) y se guardan/envían al CRM con la grafía del catálogo de PostgreSQL (`resolveCatalogCampaign`); `campaigns` de `/me` queda deduplicado y con esa grafía.
- **Migración**: `backend/scripts/migrate-canonical-ids.ts` (dry-run por defecto, `--apply`, `--delete-source`); ver su encabezado.

## Roles & permisos

Sigue `Implementar_roles_locales.md` (patrón local recomendado):

- **Identidad** = API externa de Roles (`GET /users/{username}` → roles + campaña).
- **Permisos del producto** = almacén local `RolePermsTable` (PK=`ROLEPERMS`, SK=`ROLE#<roleId>`), por **nombre** (`ana:*`), no UUIDs.
- `resolveUserAccess(username)` (backend/src/lib/access.ts): une permisos locales de todos los roles del usuario.
- **Superadmin**: `erick.silva` → acceso total (bypass).
- **Líder**: rol cuyo `role_name` ~ `/l[ií]der/` → obtiene `contacts:upload` + `contacts:distribute` aunque su almacén esté vacío.
- **Enforcement** detrás del flag `PERMISSIONS_ENFORCED` (`false` default, `report`, `true`; ver abajo). El permiso **admin siempre es fail-closed** (no depende del flag).
- **Caché** de `resolveUserAccess` (guía §6): L1 memoria 15 s + L2 `AccessCacheTable` 15 min. Al cambiar permisos de un rol → `invalidateByRole` borra del caché a los usuarios con ese rol. Lookups vacíos (posible outage de la API externa) no se cachean.
- **UI admin** (`AdminRolePerms.tsx`): `GET`/`PUT /admin/role-permissions/{roleId}` para asignar permisos por rol.

Catálogo (`ana:*`): `admin:console:manage`, `admin:agents:manage`, `contacts:list:upload`,
`contacts:list:distribute`, `chats:conversation:view`, `chats:team:view`, `chats:message:reply`,
`campaign:message:send`, `team:jobs:view`, `team:jobs:manage`.

### Aplicación de permisos en ana v4 (v4-enforce-permissions)

**Flag `PERMISSIONS_ENFORCED`** (parámetro de despliegue `permissionsEnforced`):

| Valor | Efecto en los chequeos normales |
|---|---|
| `false` (default) | permite; sin registro |
| `report` | permite y registra `{"evt":"perm_would_deny","route","username","perm"}` |
| `true` | aplica: 403 `{"error":"sin permiso"}` |

**Mapa ruta → permiso** (chequeos normales, `ROUTE_PERMISSIONS` en `backend/src/lib/permissions.ts`):

| Ruta | Permiso |
|---|---|
| `GET /conversations`, `GET /conversations/{chatId}/messages`, `GET /media/url` | `ana:chats:conversation:view` |
| `GET /jobs/poll`, `POST /jobs/ack`, `POST /jobs/claim`, `POST /interactions/report` | `ana:campaign:message:send` |
| `POST /interactions/open`, `POST /interactions/manual` | `ana:chats:message:reply` |

**Chequeos explícitos** (no dependen del flag): consola admin (`ana:admin:console:manage`);
presign de CSV (admin, líder o `ana:contacts:list:upload`); "ver como" de conversaciones,
mensajes y media (admin, o `ana:chats:team:view` con el agente en el roster v4 o en la
lista derivada de una campaña propia); `GET /jobs/summary` y `GET /jobs/review` (admin,
o líder / `ana:team:jobs:view` en campaña propia); `POST /jobs/reassign` y
`POST /jobs/review/resolve` (admin, o líder / `ana:team:jobs:manage` en campaña propia);
`GET /agents` (admin o `*`; si no, líder, `ana:chats:team:view` o `ana:team:jobs:view`).

**Líder** (`role_name` con "lider"): siempre upload, distribute, chats view, chats team view,
team jobs view/manage, `ana:campaign:message:send` y `ana:admin:agents:manage`.

**Superadmin por rol**: además de `erick.silva` (fijo, sin consultar la API de Roles),
cualquier usuario con un rol cuyo nombre, sin acentos, en minúsculas y sin espacios,
guiones ni guiones bajos contiene "superadmin" ("Superadmin", "Súper Admin", "super-admin")
recibe acceso total (`campaigns: ["*"]`, todos los permisos, `isAdmin`/`isLeader`) con
sus roles reales. Lo asigna quien administra la API de Roles de Pernexium (fuera de ANA);
se retira quitando el rol allí y surte efecto al vencer la caché de acceso (≤ 15 min) o al
invalidar el rol (`PUT /admin/role-permissions/{roleId}` invalida a sus usuarios). Cada
resolución por rol registra `{"evt":"superadmin_role","username","role"}`.

**Desktop**: pestañas según permisos ("Chats" con `chats:conversation:view`, "Mi asignación"
con `campaign:message:send`, "Campañas" admin/líder/`contacts:list:upload`, "Admin" solo admin);
"Ver como" con `chats:team:view`; "Envíos pendientes" con `team:jobs:view` y "Mover" con
`team:jobs:manage`; sin `chats:message:reply` el main rechaza envíos manuales
("sin permiso para responder"). El editor de roles muestra los 9 permisos y conserva al
guardar los valores que no muestra.

**Activación**: (1) deploy con `permissionsEnforced=report` en dev y prod; (2) release del
desktop; (3) revisar `perm_would_deny` en CloudWatch ≥ 5 días hábiles y dar grants
explícitos (p. ej. `ana:campaign:message:send`) a los roles que deban operar; (4) deploy
con `permissionsEnforced=true` en dev, probar con usuarios de cada tipo, luego prod.
Rollback: redeploy con `report`.

### Reparto de contactos del líder
Un líder sube CSV con "repartir" → presign marca `distribute=1` + `campaign` en
metadata firmada (solo si tiene el permiso). `csvTrigger` lista los **agentes
activos** de esa campaña (`AgentsTable`, registrados por heartbeat al conectar
WhatsApp) y reparte las filas **round-robin** entre sus particiones de jobs. Sin
agentes activos → los jobs quedan para el uploader.

> No hay endpoint role→usuarios en la API externa; por eso el destino del reparto
> se resuelve con el registro de agentes por campaña (heartbeat), no por jerarquía.

### Vista de conversaciones de agentes (líder / admin)
`AgentsTable` es un **roster persistente** (no TTL; `lastSeen` marca activo). Las
rutas `GET /conversations` y `.../messages` aceptan `?operatorId=`:
- **self** siempre; **admin** cualquier operador; **líder** (`chats:team:view`)
  solo operadores que sean agentes de **sus** campañas (`isAgentInCampaigns`).
- Picker: `GET /agents/campaigns` (admin: todas; líder: las suyas) + `GET /agents?campaign=`.
- La vista es **solo lectura** desde otra cuenta: responder requiere la sesión
  WhatsApp del agente dueño, que vive en la máquina de ese agente.

## Configuración remota del desktop (`backend/src/lib/desktopSettings.ts`)

Catálogo cerrado (cualquier otra llave → 400 `configuración desconocida: <llave>`):

| Llave | Tipo | Límites | Por defecto |
|---|---|---|---|
| `sendMinGapSeconds` | entero | 60–600 | 120 |
| `sendMaxPerWindow` | entero | 1–20 | 7 |
| `sendWindowMinutes` | entero | 5–60 | 20 |
| `openChatInteraction` | booleano | — | `false` |

- Guardado en `RolePermsTable` (`PK=CONFIG`, `SK=DESKTOP_SETTINGS`) con `version` y auditoría por llave (`updatedBy`, `updatedAt`). Un valor guardado fuera de tipo o límites se ignora (se usa el por defecto).
- `GET /settings`: valores efectivos, cualquier usuario autenticado. `GET`/`PUT /admin/desktop-settings`: solo rol **Developer** (nombre de rol con "developer", sin mayúsculas ni acentos; `isDeveloper` en `GET /me`), hard check; `PUT {version, values}` con versión condicional (409 `la configuración cambió`).
- Desktop: el main (`electron/settings/remoteSettings.ts`) lee `GET /settings` tras el login y cada 5 min, conserva el último valor y usa los por defecto si nunca la leyó. El poller aplica el ritmo en cada cálculo de espera; `Chats` notifica `POST /interactions/open` solo con `openChatInteraction`. **Propagación ≤ 5 min.**
- Se edita desde ANA Admin → "Configuración" → sección "Desktop v4" (solo Developer).

## Canal realtime (`backend/src/lib/realtime.ts`, add-realtime-gateway)

API WebSocket de API Gateway en el stack v4 (us-east-2), una por stage, para los tres clientes (desktop v4, CLI v3, ANA Admin). Solo **avisos** sin datos: el cliente vuelve a leer por REST, que conserva toda la autorización. El polling queda como respaldo.

- **URL**: la de execute-api por defecto, sin dominio propio: salida `RealtimeWsUrl` del stack (`wss://<apiId>.execute-api.us-east-2.amazonaws.com/<stage>`). Cada cliente la recibe como configuración (`ANA_REALTIME_URL` del desktop y del CLI, `NEXT_PUBLIC_REALTIME_URL` de ANA Admin); sin URL no se conecta y conserva su polling actual. dev: `<RealtimeWsUrl de dev, tras el deploy>`; prod: `<RealtimeWsUrl de prod, tras el deploy>`.
- **Handshake**: `?client=desktop|cli|admin&v=<versión>` y subprotocolo `Sec-WebSocket-Protocol: ana.v1, <ID token>` (nunca en el query string). Authorizer `realtimeAuthorizer` (`aws-jwt-verify`, `tokenUse: id`, App Clients de `realtimeClientIds`); si llega `Origin` debe estar en `REALTIME_ALLOWED_ORIGINS` y `client=admin` lo exige. `$connect` responde `Sec-WebSocket-Protocol: ana.v1`. Sin subprotocolo → 401 de API Gateway; cualquier otro rechazo → 403.
- **Temas** (tabla `ana-backend-realtime-<stage>`, `PK=<tema>, SK=<connectionId>` + `PK=conn#<id>, SK=meta`, TTL 3 h): `u#<username>`, `k#<client>`, `c#<campaña>` (solo `admin`, eventos de campaña; `c#*` con todas), `m#<campaña>` y `r#<roleId>` (todos, para la actualización forzada; `r#unknown` si el acceso no se resolvió). El alcance se calcula en `$connect` con `resolveUserAccess`.
- **Rutas**: `ping` → `{"type":"pong","at","exp"}`; cualquier otra acción → `{"type":"error","code":"unknown_action"}`.
- **Catálogo v1** (sobre `{"v":1,"type","id","at","campaign"?,"ref"?}`, ≤ 1 KB, `ref` solo `uploadId`/`srcKey`/`scope`/`source`/`reason`):

| Tipo | Destino | Productor |
|---|---|---|
| `jobs.changed` | usuario | `csvTrigger`, `POST /send`, `jobs/reassign`, `jobs/review/resolve` |
| `assignment.pending` | usuario | puente v3 (`assignments/agents/…`) |
| `assignment.published` | usuario | puente v3 (`agents/{c}/{agent}-contacts-*.csv`) |
| `publications.changed` | usuario | puente v3 (`agent-publications/…`) |
| `uploads.changed` | campaña | `csvTrigger`, `jobs/ack` (≤ 1 por carga cada 10 s), puente v3 (`uploads/…`) |
| `review.changed` | campaña | `jobs/reassign`, `jobs/review/resolve`, puente v3 (`review/…`) |
| `roster.changed` | campaña | `POST /admin/agent-roster`, puente v3 (`rosters/{c}.json`) |
| `settings.changed` (`scope` `desktop`/`cli`) | ese tipo + `admin` | `PUT /admin/desktop-settings`, puente v3 (`config/cli-settings.json`) |
| `session.refresh` (`ref.reason`) | actualización forzada | ver abajo |

- **Reparto**: los handlers publican al bus `ana-realtime-<stage>` (`emitRealtime`/`forceRefresh`, timeout 1 s, nunca lanzan; `EmitFailed`). Las reglas `source: ana.v4` y `source: aws.s3` invocan `notify`, que hace `PostToConnection` (concurrencia 25), borra 410, cierra conexiones con token vencido hace > 5 min y descarta eventos de > 60 s. Entrega a lo más una vez, sin orden.
- **Puente v3**: el bucket `ana-backend-storage-<stage>` publica a EventBridge (us-east-1) y la regla `ana-backend-<stage>-realtime-bridge` reenvía los prefijos del puente al bus de v4 (`--param="realtimeBusArn=<RealtimeBusArn>"` al desplegar v3).
- **Actualización forzada** (`session.refresh` + `DeleteConnection`; API Gateway no permite elegir el código de cierre): automática al guardar permisos de un rol (`r#<roleId>` ∪ `r#unknown`), excepciones del roster v4 (`u#` de los agentes del cuerpo), roster v3 (`m#<campaña>`), configuración del desktop (`k#desktop`) o del CLI (`k#cli`); manual con `POST /admin/realtime/refresh` `{scope:"user",username}` | `{scope:"campaign",campaign}` (`m#<c>`, sin `m#*`) | `{scope:"all"}` (solo `isAdmin`: `ana:admin:console:manage` o superadmin; 202). El cliente cierra con 4001, relee su acceso (`/me` o `GET /agent/campaigns` en el CLI) y su estado, y reconecta tras 0–10 s sin crecer el backoff.
- **Contrato de los clientes**: `ping` al abrir y cada 5 min; activo tras el primer `pong` (timeout 30 s); backoff exponencial con jitter 1 s → 5 min (15 min tras 403 o 5 fallos); reconexión planeada a los 110 min o con token nuevo (make-before-break); lectura REST al confirmar cada conexión. Con canal activo, respaldo lento (desktop y CLI: 2 min jobs/asignaciones, 15 min configuración); sin canal, el polling de hoy (5 s / 30 s y 5 min).
- **Interruptor**: `--param="realtimeEnabled=false"` rechaza `$connect` (`disabled`), descarta eventos y `realtimeStats` (cada 5 min) cierra las conexiones abiertas; las rutas REST no cambian.
- **Observabilidad**: métricas `AnaRealtime` con dimensión `Stage` (`ConnectAccepted`, `ConnectRejected{reason}`, `ActiveConnections{client}`, `EventsEmitted{type}`, `PostOk`, `PostGone`, `PostFailed`, `EmitFailed`, `ForcedClosed{reason}`, `BridgeSkipped`); alarmas `…-realtime-post-failing` (> 5 % en 15 min), `…-realtime-notify-errors` y `…-realtime-authorizer-errors`. Access log del stage sin headers.

## Seguridad del desktop

- **Ventana**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; el renderer solo ve `window.ana` (preload).
- **Navegación**: `will-navigate`/`will-redirect` cancelan cualquier URL fuera de la app (`file://…/dist/index.html` empaquetado o el servidor de Vite en dev). `setWindowOpenHandler` siempre deniega; un enlace `https:` se abre en el navegador del sistema (`shell.openExternal`), otros esquemas se ignoran.
- **Teclado (build instalado)**: F12 siempre bloqueado; Ctrl/Cmd+Shift+I/J/C y Ctrl/Cmd+U solo sin Alt, para que AltGr (Ctrl+Alt en Windows) escriba `@`, `\`, `|` (`shouldBlockKey` en `electron/ipc/guard.ts`).
- **CSP** (meta inyectada por `vite.config.ts`, `src/lib/csp.ts`): `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src`/`media-src 'self' data: blob: https://*.amazonaws.com`; `font-src 'self' data:`; `connect-src 'self' <VITE_API_BASE> https://cognito-idp.us-east-2.amazonaws.com https://*.amazonaws.com`; `object-src 'none'`; `base-uri 'none'`; `form-action 'none'`. En `vite` (dev) se agregan el servidor de Vite y `ws:`. Fuentes Inter/Jost empaquetadas con `@fontsource` (sin Google Fonts).
- **Guard IPC** (`electron/ipc/guard.ts`): todo `ipcMain.handle` pasa por `handle(channel, validador, handler)` en `main.ts`. Rechaza con `{ok:false, error:"solicitud inválida"}` si el emisor no es el frame principal de la ventana con la URL de la app o si los argumentos no cumplen: JID `^\d{8,15}@c\.us$`, texto 1–4096, media ≤ 16 MB de tipo `image/*`, `audio/*`, `video/*` o `application/pdf` con nombre saneado, `jobIds` ≤ 5000 de ≤ 200, plantillas ≤ 4096, token JWT o `null`, campaña ≤ 100, contraseña de emergencia ≤ 256.

  | Canal | Argumentos validados |
  |---|---|
  | `auth:set-token` | token JWT o `null`, `{reason:'expired'}` opcional |
  | `auth:provide-token` | token JWT o `null` |
  | `agent:register` | campaña ≤ 100 o `null` |
  | `jobs:approve` | `jobIds`, plantillas por archivo |
  | `jobs:get-assignment`, `update:check`, `update:retry`, `update:bypass-status`, `wa:start`, `wa:stop`, `wa:reset`, `wa:get-state` | sin argumentos |
  | `update:bypass` | contraseña ≤ 256 |
  | `wa:send-reply` | JID, texto |
  | `wa:typing` | JID, booleano |
  | `wa:send-media` | JID, media |

- **WhatsApp (Chromium de whatsapp-web.js)**: se lanza con su sandbox activo (sin `--no-sandbox` ni `--disable-setuid-sandbox`); se conservan `--disable-dev-shm-usage` y `--disable-gpu`.

## Layout del repo

```
ana-front/
  ARCHITECTURE.md                 (este doc)
  design-system.md                (design system Pernexium — fuente de verdad UI)
  sso-cognito-cookie-storage.md   (auth — referencia)
  backend/
    serverless.yml
    package.json
    src/
      handlers/{api,csvTrigger,jobsPoll}.ts
      lib/{dynamo,sqs,s3,auth}.ts
  desktop/
    package.json
    electron/
      main.ts                     (proceso principal)
      preload.ts                  (puente IPC seguro)
      whatsapp/client.ts          (sesión WA, envío, recepción)
      whatsapp/phone.ts           (normaliza teléfono MX/521)
      auth/pkce.ts                (Cognito PKCE, loopback redirect)
      jobs/poller.ts              (SQS long-poll worker)
    src/                          (React + Vite UI)
      main.tsx, App.tsx
      lib/{api,tokens}.ts
      ui/                         (componentes design-system)
      routes/{login,chats,campaigns}.tsx
    tailwind.config.ts            (tokens Pernexium)
    vite.config.ts
```
