# ana — Arquitectura

App de envío/gestión de WhatsApp para cobranza (Pernexium). Reescritura completa.

## Decisiones fijas

| Tema | Decisión | Por qué |
|------|----------|---------|
| Motor WhatsApp | `whatsapp-web.js` (Puppeteer + Chromium) | Gratis, sin verificación Meta. Corre **local** (Lambda no puede sostener sesión persistente). |
| App | **Electron desktop** (React + Vite + TS) | La sesión WA debe vivir en una máquina persistente. UI + motor en una sola pieza. |
| Backend | **Serverless** AWS (Lambda + DynamoDB + S3 + SQS) | Datos/orquestación sin EC2. Nunca toca WhatsApp. |
| Auth | **Cognito hosted UI / PKCE** contra el User Pool de Pernexium | Mismas cuentas/permisos que el resto de apps. **No** hay SSO por cookie (Electron no vive en `*.pernexium.com.mx`); login explícito en la app. |
| Trigger nube→local | **Polling a tabla DynamoDB de jobs** (PK=operatorId, lease) | Lambda no puede push a la PC local (sin IP pública). SQS compartido no aísla por operador → tabla jobs por operatorId. Intervalo corto (~4s), no long-poll. |
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
│                                      │        │    · jobsPoll  (lease/ack por op.)   │
│  Renderer (React + Vite):           │        │  DynamoDB: conversations, messages,  │
│   · login (username, fondo azul)     │        │            jobs (PK operatorId)      │
│   · chats / restore desde Dynamo     │        │  S3: csv-uploads, media-backup       │
│   · sube CSV → S3                    │        │                                      │
└─────────────────────────────────────┘        └────────────────────────────────────┘
```

## Flujos

### Envío masivo vía bucket
1. UI pide presign a `api` (config de campaña fijada en metadata firmada) y sube CSV a S3 (`csv-uploads/`).
2. Evento S3 dispara `csvTrigger` → parsea filas → escribe N jobs en la tabla `jobs` (PK=operatorId del presign).
3. Main process pollea `GET /jobs/poll` (~4s) → backend hace lease de hasta 10 jobs del propio operador.
4. Por cada job: normaliza teléfono, interpola plantilla, `client.sendMessage`.
5. Reporta resultado → `PUT /messages` → DynamoDB. `POST /jobs/ack` borra los jobs hechos.

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

## Roles & permisos

Sigue `Implementar_roles_locales.md` (patrón local recomendado):

- **Identidad** = API externa de Roles (`GET /users/{username}` → roles + campaña).
- **Permisos del producto** = almacén local `RolePermsTable` (PK=`ROLEPERMS`, SK=`ROLE#<roleId>`), por **nombre** (`ana:*`), no UUIDs.
- `resolveUserAccess(username)` (backend/src/lib/access.ts): une permisos locales de todos los roles del usuario.
- **Superadmin**: `erick.silva` → acceso total (bypass).
- **Líder**: rol cuyo `role_name` ~ `/l[ií]der/` → obtiene `contacts:upload` + `contacts:distribute` aunque su almacén esté vacío.
- **Enforcement** detrás del flag `PERMISSIONS_ENFORCED` (default `false` → no bloquea hasta validar; guía §8). El permiso **admin siempre es fail-closed** (no depende del flag).
- **Caché** de `resolveUserAccess` (guía §6): L1 memoria 15 s + L2 `AccessCacheTable` 15 min. Al cambiar permisos de un rol → `invalidateByRole` borra del caché a los usuarios con ese rol. Lookups vacíos (posible outage de la API externa) no se cachean.
- **UI admin** (`AdminRolePerms.tsx`): `GET`/`PUT /admin/role-permissions/{roleId}` para asignar permisos por rol.

Catálogo (`ana:*`): `admin:console:manage`, `contacts:list:upload`,
`contacts:list:distribute`, `chats:conversation:view`, `chats:message:reply`,
`campaign:message:send`.

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
