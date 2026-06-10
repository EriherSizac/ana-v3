# Estructura del proyecto

Mapa de carpetas y archivos de **ana**, qué hace cada pieza y cómo se conectan.
Para el *por qué* de las decisiones, ver [ARCHITECTURE.md](./ARCHITECTURE.md).

## Vista general

```
ana-front/
├── ARCHITECTURE.md              Decisiones de arquitectura + diagramas + flujos
├── README.md                    Quickstart (deploy backend, dev desktop)
├── STRUCTURE.md                 Este doc
├── design-system.md             Design system Pernexium (tokens, componentes, reglas)
├── sso-cognito-cookie-storage.md  Auth Cognito (referencia; SSO cookie NO aplica a Electron)
├── Implementar_roles_locales.md   Guía de roles & permisos (patrón local seguido)
├── backend/                     Serverless AWS (datos + orquestación)
└── desktop/                     Electron + Vite + React (whatsapp-web.js + UI)
```

Dos piezas independientes que hablan por HTTPS con token JWT de Cognito:
- **desktop** corre en la PC del operador, sostiene la sesión de WhatsApp, envía/recibe.
- **backend** vive en AWS, guarda datos y reparte jobs de envío. Nunca toca WhatsApp.

---

## backend/ — Serverless

```
backend/
├── serverless.yml               Infra: Lambda, DynamoDB, S3, IAM, HTTP API + JWT
├── package.json                 Deps AWS SDK v3 + serverless-esbuild
├── tsconfig.json
└── src/
    ├── lib/
    │   ├── dynamo.ts            Cliente DynamoDB + helpers de llaves (convKey, messageSk)
    │   ├── s3.ts               Cliente S3 + nombres de bucket
    │   ├── jobs.ts             Tipo SendJob + constantes de lease/TTL
    │   ├── http.ts             Respuestas JSON (ok/created/bad) + claimUser (JWT)
    │   ├── permissions.ts      Catálogo ana:* + superadmin + regex de líder
    │   ├── roles.ts            Cliente API externa de Roles (GET /users/{username})
    │   ├── rolePerms.ts        Almacén local rol→permisos (RolePermsTable)
    │   ├── access.ts           resolveUserAccess + can() (enforcement con flag) + caché
    │   ├── accessCache.ts      Caché L1 mem + L2 DynamoDB + invalidación por rol
    │   └── agents.ts           Roster de agentes por campaña + membresía
    └── handlers/
        ├── api.ts              /conversations, /messages, /uploads/presign, /me, /admin/role-permissions
        ├── agents.ts           POST /agents/heartbeat (registro de agente)
        ├── jobsPoll.ts         GET /jobs/poll (lease), POST /jobs/ack (delete)
        └── csvTrigger.ts       Evento S3 → parsea CSV → jobs (reparto round-robin si líder)
```

### Recursos AWS (serverless.yml)

| Recurso | Llaves / config | Para qué |
|---------|-----------------|----------|
| `ConversationsTable` | PK `operatorId`, SK `chatId` | Resumen por chat (último msg, no-leídos) |
| `MessagesTable` | PK `convKey`=`operatorId#chatId`, SK `sk`=`timestamp#msgId` | Historial completo, restore |
| `JobsTable` | PK `operatorId`, SK `jobId`; TTL `ttl` | Cola de envíos por operador (lease) |
| `RolePermsTable` | PK `ROLEPERMS`, SK `ROLE#<roleId>` | Permisos locales por rol (`ana:*`) |
| `AgentsTable` | PK `campaign`, SK `operatorId` | Roster de agentes por campaña (heartbeat) |
| `AccessCacheTable` | PK `username`; TTL | Caché L2 de acceso resuelto |
| `CsvBucket` | prefijo `csv-uploads/` | CSVs de contactos subidos por la UI |
| `MediaBucket` | prefijo `media/<op>/` | Backup de media entrante (bytes; Dynamo guarda el puntero) |
| HTTP API | authorizer JWT Cognito | Todas las rutas exigen token del pool |

**Aislamiento multi-operador**: `operatorId` (claim del JWT, nunca del body) es parte
de la PK de las 3 tablas → un operador solo puede Query/Delete su propia partición.

### Endpoints

| Método | Ruta | Handler | Hace |
|--------|------|---------|------|
| GET | `/conversations` | api | Lista conversaciones del operador |
| GET | `/conversations/{chatId}/messages` | api | Historial de un chat |
| PUT | `/messages` | api | Persiste un mensaje (whitelist de campos) |
| POST | `/uploads/presign` | api | URL firmada para subir CSV (config en metadata firmada) |
| GET | `/jobs/poll` | jobsPoll | Entrega+lease hasta 10 jobs propios |
| POST | `/jobs/ack` | jobsPoll | Borra jobs ya enviados |
| GET | `/me` | api | Acceso efectivo del usuario (roles, permisos, líder/admin) |
| GET | `/admin/role-permissions/{roleId}` | api | Lee permisos de un rol (solo admin) |
| PUT | `/admin/role-permissions/{roleId}` | api | Set permisos de un rol (solo admin) |
| POST | `/media/presign` | api | Presign PUT para subir media entrante a S3 |
| GET | `/media/url?key=` | api | Presign GET para ver media (autz como vista de conversación) |
| POST | `/agents/heartbeat` | agents | Agente se marca activo en su campaña |
| GET | `/agents?campaign=` | agents | Roster de agentes (admin: cualquiera; líder: propios) |
| GET | `/agents/campaigns` | agents | Campañas elegibles (admin: todas; líder: propias) |

`GET /conversations` y `.../messages` aceptan `?operatorId=` para que líder/admin
vean a un agente (autz: self / admin / líder de la campaña). Vista solo lectura.

---

## desktop/ — Electron + Vite + React

```
desktop/
├── package.json                 Electron + Vite + React + whatsapp-web.js + aws-amplify
├── vite.config.ts              Renderer: root=src/, salida dist/
├── tsconfig.json               Config del renderer (React)
├── tsconfig.electron.json      Config del main (CommonJS → dist-electron/)
├── tailwind.config.ts          Tokens del design-system Pernexium
├── postcss.config.js
├── .env.example                Cognito + API base (VITE_* renderer, ANA_* main)
│
├── electron/                    MAIN PROCESS (Node) — compila a dist-electron/
│   ├── main.ts                 Orquesta todo: ventana, IPC, eventos WA, runJobs
│   ├── preload.ts              contextBridge `window.ana` (IPC seguro)
│   ├── backend.ts              Cliente del backend (PUT /messages, media, heartbeat)
│   ├── updater.ts              Auto-update obligatorio (electron-updater + S3)
│   ├── whatsapp/
│   │   ├── client.ts           WaClient: sesión, QR, envío, recepción (EventEmitter)
│   │   ├── phone.ts            normalizeDigits (arregla 521 MX) + toJid
│   │   └── template.ts         interpolate {campo} + formatMoney MXN
│   └── jobs/
│       └── poller.ts           JobPoller: poll /jobs/poll (~4s) → onJobs → ack
│
└── src/                         RENDERER (React) — compila a dist/
    ├── index.html              Carga fuentes (Inter, Jost) + main.tsx
    ├── main.tsx                Bootstrap: configureAmplify() + render <App/>
    ├── index.css               Tailwind + utilidades pernexium-card/gradient
    ├── App.tsx                 Gate de sesión + nav (Chats / Campañas / Salir)
    ├── vite-env.d.ts
    ├── types/ana.d.ts          Tipos de window.ana (puente del preload)
    ├── lib/
    │   ├── amplify.ts          Config Cognito (sin SSO cookie en Electron)
    │   ├── auth.ts             login/logout/hasSession + pushTokenToMain
    │   ├── api.ts              fetch al backend + maskPhone + uploadCsv + getMe
    │   └── permissions.ts      Espejo del catálogo ana:* + can()
    ├── ui/
    │   ├── Button.tsx          Variantes design-system (default/outline/destructive/ghost)
    │   └── Skeleton.tsx        Loader (regla: nunca "Cargando…")
    └── routes/
        ├── Login.tsx           Fondo azul, login por username (regla design-system)
        ├── Chats.tsx           QR connect, lista enmascarada, hilo, reply
        ├── TeamViewer.tsx      Selector campaña/agente (líder/admin) — vista de equipo
        ├── Campaigns.tsx       Sube CSV → presign → S3, muestra ok/fallidos
        ├── AdminRolePerms.tsx  Admin: asigna permisos ana:* a un role_id
        └── UpdateGate.tsx      Pantalla bloqueante de auto-update obligatorio
```

### Dos procesos, una app

- **main** (Node, acceso total): único que importa `whatsapp-web.js`. Mantiene la
  sesión, escucha eventos, ejecuta los envíos. Corre el `JobPoller`. Llama al backend.
- **renderer** (React, sandbox): UI. No toca WhatsApp ni Node directo; habla con el
  main solo por `window.ana` (definido en `preload.ts`). Hace su propio fetch al
  backend para leer conversaciones/mensajes.

### Puente IPC (`window.ana`)

| Método | Dirección | Para qué |
|--------|-----------|----------|
| `setAuthToken(token)` | renderer→main | Tras login, pasa el JWT al poller/backend |
| `registerAgent(campaign)` | renderer→main | Campaña del agente para el heartbeat |
| `startWhatsApp()` / `stopWhatsApp()` | renderer→main | Arranca/para la sesión WA |
| `sendReply(jid, body)` | renderer→main | Respuesta manual desde un chat |
| `onWaEvent(cb)` | main→renderer | QR / status de conexión |
| `onWaMessage(cb)` | main→renderer | Mensaje entrante |
| `onWaSent(cb)` | main→renderer | Resultado de cada envío masivo |

---

## Flujo completo (extremo a extremo)

### Conectar WhatsApp
`Chats.tsx` botón → `window.ana.startWhatsApp()` → main `WaClient.start()` →
evento `qr` → `onWaEvent` → renderer pinta QR → escaneas → `status: connected`.

### Envío masivo
1. `Campaigns.tsx`: eliges CSV + plantilla → `api.uploadCsv()`.
2. `POST /uploads/presign` (api.ts) → URL firmada con config de campaña en metadata.
3. Renderer sube el CSV a S3 (`csv-uploads/`).
4. Evento S3 → `csvTrigger.ts` → parsea → escribe jobs en `JobsTable` (PK=operatorId).
5. main `JobPoller` → `GET /jobs/poll` → jobsPoll hace lease de jobs propios.
6. `runJobs` (main.ts): `resolveJid` → `interpolate` → `WaClient.sendText`.
7. `backend.putMessage` → `PUT /messages` → DynamoDB. `POST /jobs/ack` borra el job.
8. `onWaSent` → `Campaigns.tsx` actualiza contador ok/fallidos.

### Recepción + restore
- Entrante: `WaClient` emite `message` → main `putMessage` → DynamoDB + `onWaMessage`.
- Restore: `Chats.tsx` → `getConversations()` / `getMessages()` → DynamoDB (fuente de verdad).

---

## Convenciones

- **Nunca hardcodear hex** en JSX → tokens de `tailwind.config.ts` (design-system).
- **`operatorId` solo del JWT**, jamás del body del cliente (anti mass-assignment).
- **Números enmascarados** solo en la vista (`maskPhone`); en Dynamo van planos.
- Config de campaña va en **metadata firmada** del presign → el cliente no la altera.
- Errores del backend → mensaje genérico al cliente, detalle solo en logs.
```
