# ana v4 — Arquitectura y flujos

> Estado al 2026-06-10 (incluye: aprobación de asignación, envío directo, registro CRM, compat CSV v3, reparto/reasignación por agente). Complementa `ARCHITECTURE.md` y `CONTEXT.md`; este documento describe **cómo fluye todo de punta a punta**. Diagramas en Mermaid.

---

## 1. Topología general

Híbrido: WhatsApp vive **local** en la PC del agente (la sesión de Chromium no sobrevive Lambdas); AWS solo guarda datos, permisos y orquesta trabajo.

```mermaid
flowchart LR
  subgraph PC["PC del agente (Electron)"]
    direction TB
    subgraph MAIN["main process (Node)"]
      WA["WaClient<br/>whatsapp-web.js + Chromium headless"]
      POLLER["JobPoller<br/>GET /jobs/poll cada ~5s"]
      RUNJOB["runJob<br/>envía + reporta CRM"]
      UPD["auto-update<br/>electron-updater"]
    end
    subgraph REND["renderer (React + Vite)"]
      LOGIN["Login (Cognito PKCE)"]
      CHATS["Chats (manual)"]
      ASIG["Mi asignación<br/>(aprobar envíos)"]
      CAMP["Campañas (subir CSV)"]
      TEAM["Vista de equipo"]
      ADMIN["Admin (permisos)"]
    end
    MAIN <-->|IPC| REND
  end

  subgraph AWS["AWS us-east-2"]
    COG["Cognito User Pool<br/>JWT id token"]
    APIGW["HTTP API Gateway<br/>njpfef2qna"]
    LAPI["λ api<br/>conversaciones, presign, roles, media"]
    LPOLL["λ jobsPoll<br/>poll/ack"]
    LADMIN["λ jobsAdmin<br/>summary/reassign"]
    LINT["λ interactions<br/>registro CRM"]
    LSEND["λ directSend<br/>POST /send (X-Api-Key)"]
    LAGENTS["λ agents<br/>heartbeat/roster"]
    LCSV["λ csvTrigger<br/>evento S3"]
    DDB[("DynamoDB<br/>conversations · messages · jobs+GSI<br/>roleperms · agents · accesscache")]
    S3CSV[("S3 csv-uploads/")]
    S3MEDIA[("S3 media/")]
    PG[("PostgreSQL RDS<br/>tabla campaigns")]
  end

  EXT["APIs externas<br/>Roles · Dashboard imery · CRM interactions"]
  WAWEB["WhatsApp Web"]

  REND -->|HTTPS + JWT| APIGW
  MAIN -->|HTTPS + JWT| APIGW
  LOGIN --> COG
  APIGW --> LAPI & LPOLL & LADMIN & LINT & LAGENTS
  APIGW -->|X-Api-Key| LSEND
  S3CSV -. "ObjectCreated" .-> LCSV
  LAPI --> DDB & S3CSV & S3MEDIA & PG
  LCSV --> DDB
  LPOLL --> DDB
  LADMIN --> DDB
  LSEND --> DDB & PG
  LINT --> DDB & EXT
  LAPI --> EXT
  WA <--> WAWEB
  UPD -.->|feed releases| S3MEDIA
```

## 2. Identidad y permisos

1. Login: Cognito hosted UI + PKCE loopback → **id token** (el authorizer valida `aud`, solo presente en id tokens). Claim `cognito:username` = `operatorId` = partición de TODOS los datos del agente.
2. `GET /me` → `resolveUserAccess()`: roles de la API externa → permisos `ana:*` locales (tabla `roleperms`) → unión de grants/denies + defaults (chats view/reply). Caché L1 memoria 15s, L2 DynamoDB 15 min.
3. Especiales: superadmin `erick.silva` (todo); rol con nombre ~ `/l[ií]der/` → upload, distribute, team view, jobs view/manage automáticos.
4. **Hard checks** (no dependen del flag `PERMISSIONS_ENFORCED`): consola admin, subir CSV (solo líder/admin/grant explícito), summary/reassign de jobs.

```mermaid
flowchart LR
  U["Usuario"] --> HUI["Cognito hosted UI<br/>PKCE + MFA"] --> TOK["id token<br/>operatorId = cognito:username"]
  TOK --> ME["GET /me"]
  ME --> RA["resolveUserAccess()"]
  RA --> ROLES["API externa de Roles<br/>GET /users/username"]
  RA --> RP[("roleperms<br/>grants/denies ana:*")]
  RA --> CACHE[("accesscache L2 15min<br/>+ L1 memoria 15s")]
  RA --> OUT["permisos efectivos<br/>isAdmin · isLeader · campañas"]
```

## 3. Flujo: campaña masiva (CSV → asignación → envío)

### 3.1 Subida y trigger (líder, tab Campañas)

- La **config viaja firmada** en la metadata del objeto S3 (`x-amz-meta-*`): el cliente no puede alterarla después del presign.
- Validaciones del presign: solo líder/admin sube; `distribute` requiere permiso; la campaña debe ser propia **y existir** en la DB (si no → `400 la campaña "X" no existe`).
- `eligibleAgents` en la respuesta = preview del reparto (misma fuente que usará el trigger).

```mermaid
sequenceDiagram
  participant L as Líder (renderer)
  participant API as λ api
  participant S3 as S3 csv-uploads/
  participant TRG as λ csvTrigger
  participant DASH as Dashboard (imery)
  participant J as DynamoDB jobs

  L->>API: POST /uploads/presign<br/>(template, phoneColumn, campaign, distribute, assignments?)
  API->>API: valida líder/admin + campaña existe (PG)
  API-->>L: presigned URL + metadata firmada + eligibleAgents
  L->>S3: PUT CSV → csv-uploads/usuario/ts_archivo.csv
  S3--)TRG: evento ObjectCreated
  TRG->>TRG: parsea CSV (máx 10MB / 50k filas)<br/>normalizeContactRow() ← alias v3↔v4
  alt assignments (pesos explícitos)
    TRG->>TRG: reparto ponderado
  else distribute=1
    TRG->>DASH: agentes activos de la campaña
    TRG->>TRG: round-robin
  else default
    TRG->>TRG: todo al uploader
  end
  TRG->>J: BatchWrite: 1 SendJob por fila<br/>PK=operatorId · campaign (GSI) · TTL 7d
```

### 3.2 Poll, aprobación y envío (agente)

- **Nada se envía sin aprobación** (excepto los directos `auto:true`, §4). Lo no seleccionado queda pendiente y reaparece en cada poll.
- La vista "Mi asignación" se hidrata al montar (`jobs:get-assignment`), no espera al siguiente poll.
- CSV de S3 se borra solo cuando **no quedan jobs** de ese archivo.

```mermaid
sequenceDiagram
  participant P as JobPoller (main)
  participant JP as λ jobsPoll
  participant J as DynamoDB jobs
  participant R as Renderer (Mi asignación)
  participant WA as WaClient → WhatsApp
  participant API as λ api
  participant INT as λ interactions

  loop cada ~5s
    P->>JP: GET /jobs/poll
    JP->>J: Query PK=operatorId
    JP-->>P: jobs pendientes
    P->>P: separa auto:true (van solos)
    P--)R: IPC jobs:assignment (resto)
  end
  R->>R: agente selecciona contactos<br/>+ edita plantilla (preview en vivo)
  R->>P: IPC jobs:approve(jobIds, template?)
  loop por job aprobado (agrupado por archivo)
    P->>P: rateLimitWait()<br/>7 msgs/20min · gap ≥2min
    P->>WA: resolveJid(phone) ¿tiene WhatsApp?
    P->>P: interpolate(plantilla, row)
    P->>WA: sendText (typing 2–9s)
    P->>API: PUT /messages (respaldo)
    P->>JP: POST /jobs/ack (borra job)
    P--)INT: POST /interactions/report (CRM)
    P--)R: IPC wa:progress (barra)
  end
  P->>API: POST /uploads/delete (si no quedan jobs del archivo)
```

## 4. Flujo: envío directo (sistema-a-sistema)

Ver `ENVIO_DIRECTO.md` para la guía de integración. Único camino que envía **sin aprobación**; las campañas del líder siempre pasan por Mi asignación.

```mermaid
sequenceDiagram
  participant EXT as CRM / automatización
  participant DS as λ directSend
  participant PG as PostgreSQL campaigns
  participant J as DynamoDB jobs
  participant P as JobPoller (agente)
  participant WA as WhatsApp

  EXT->>DS: POST /send + X-Api-Key<br/>(message, username, phone, campaign)
  DS->>DS: valida SEND_API_KEY y campos
  DS->>PG: ¿campaña existe? (caché 10 min)
  alt campaña no existe
    DS-->>EXT: 400 la campaña no existe
  else OK
    DS->>J: Put SendJob auto:true<br/>PK=username · jobId=direct#ts#tel
    DS-->>EXT: 200 queued:true + jobId
    P->>J: poll (≤5s)
    P->>WA: envía SIN aprobación<br/>(mismo rate limit + registro CRM)
  end
```

## 5. Flujo: chat manual + entrantes (conviven con la automatización)

Una sola sesión `whatsapp-web.js` headless; bot y humano no compiten por ninguna ventana (envíos por API interna, no por DOM como en v3). Manual **no cuenta** al rate limit de campaña.

```mermaid
sequenceDiagram
  participant R as Renderer (Chats)
  participant M as main (WaClient)
  participant WA as WhatsApp
  participant API as λ api
  participant S3 as S3 media/
  participant D as DynamoDB

  Note over R,M: saliente manual
  R->>M: IPC wa:typing (escribiendo… en vivo)
  R->>M: IPC wa:send-reply(jid, texto)
  M->>WA: sendText sin delay
  M->>API: PUT /messages
  M-->>R: mensaje → append en sitio (sin parpadeo)

  Note over WA,D: entrante
  WA--)M: evento message (+media?)
  opt trae media
    M->>API: POST /media/presign
    M->>S3: PUT bytes
  end
  M->>API: PUT /messages (puntero mediaKey, no bytes)
  API->>D: persiste + actualiza conversación
  M--)R: IPC wa:message → append en vivo
```

Lectura: `GET /conversations` y `GET /conversations/{chatId}/messages` (partición propia; líder/admin pueden pedir `?operatorId=` de un agente de sus campañas — solo lectura).

## 6. Flujo: registro CRM

API key del CRM solo en backend; fire-and-forget (CRM caído no frena envíos).

```mermaid
sequenceDiagram
  participant P as desktop runJob
  participant INT as λ interactions
  participant J as DynamoDB jobs
  participant CRM as API CRM (interactions)

  P--)INT: POST /interactions/report<br/>(jobId, campaign, phone, status, row)
  INT->>J: marcador REPORT#op + jobId (condicional)
  alt ya reportado
    INT-->>P: no-op (idempotente)
  else primera vez
    alt credit_id en columnas del CSV
      INT->>INT: usa credit/credito/credit_id/id_credito
    else lookup
      INT->>CRM: POST /client-info por teléfono<br/>(retry sin +52)
    end
    INT->>CRM: POST /interactions (outbound,<br/>subdictamen según status)
    opt status = no_whatsapp
      INT->>CRM: PATCH /phone (has_whatsapp=false)
    end
  end
```

## 7. Flujo: supervisión y reasignación (líder/admin)

Reemplazo del consume-once de v3: agente caído a media campaña → el líder mueve sus pendientes sin re-subir CSVs. Panel en TeamViewer (refresh 30s). Heartbeat: el desktop avisa al conectar WA y cada 5 min → tabla `agents`; activo = visto en <10 min.

```mermaid
sequenceDiagram
  participant T as TeamViewer (líder/admin)
  participant JA as λ jobsAdmin
  participant J as DynamoDB jobs (GSI campaign-index)

  T->>JA: GET /jobs/summary?campaign=X
  JA->>J: Query GSI campaign=X
  JA-->>T: pendientes/en-lease por agente (filtra TTL)
  T->>JA: POST /jobs/reassign (campaign, from, to)
  loop por job pendiente de `from`
    JA->>J: TransactWrite [Delete(from) + Put(to)]<br/>atómico · respeta leases activos
  end
  JA-->>T: moved · skippedLeased
```

## 8. Campañas (PostgreSQL)

```mermaid
flowchart LR
  PG[("RDS PostgreSQL<br/>SELECT name FROM campaigns")] --> CACHE["caché 10 min<br/>en Lambda caliente<br/>(stale si DB cae)"]
  CACHE --> DD1["SearchableSelect<br/>tab Campañas"]
  CACHE --> DD2["SearchableSelect<br/>Vista de equipo"]
  CACHE --> V1["validación presign<br/>400 si no existe"]
  CACHE --> V2["validación POST /send<br/>400 si no existe"]
```

- Conexión: `DATABASE_URL` o campos sueltos `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` (estilo pgAdmin); TLS cifrado sin verificación de CA.
- Dropdowns solo permiten **elegir** opciones existentes (escribir filtra, no setea).

## 9. Tablas DynamoDB

| Tabla | Keys | Contenido |
|---|---|---|
| `conversations` | PK=operatorId, SK=chatId | último mensaje, unreadCount |
| `messages` | PK=`<op>#<chatId>`, SK=`<ts>#<msgId>` | mensajes (punteros de media, no bytes) |
| `jobs` | PK=operatorId, SK=jobId · **GSI** `campaign-index` (campaign, operatorId) | cola de envío; TTL 7 días; `auto` para directos; marcadores `REPORT#` de idempotencia CRM |
| `roleperms` | PK/SK single-table | grants/denies `ana:*` por rol |
| `agents` | PK=campaign, SK=operatorId | roster con heartbeat (`lastSeen`) |
| `accesscache` | PK=username, TTL | caché L2 de acceso resuelto |

## 10. Sesión de WhatsApp y salud

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> qr: start() sin sesión guardada
  idle --> connected: sesión LocalAuth guardada<br/>(auto-reconexión)
  qr --> authenticated: escaneo
  authenticated --> connected: ready
  connected --> disconnected: red caída / NAVIGATION
  connected --> disconnected: LOGOUT (cierre remoto<br/>o número BLOQUEADO)
  disconnected --> qr: "Limpiar sesión y reconectar"<br/>borra wwebjs_auth → QR nuevo
  disconnected --> connected: reintento simple
```

- Watchdog 60s al iniciar (sin señal → aviso de Chromium/red).
- En `LOGOUT`/`auth_failure` la UI explica el posible bloqueo y ofrece el reset. Las conversaciones **no se pierden**: viven en DynamoDB y se recargan solas tras reescanear.

## 11. Distribución y updates

- Build: `npm run publish` → Electron Builder → instalador NSIS → release a S3.
- Al arrancar, `electron-updater` consulta el feed S3: update **obligatorio y bloqueante** (gate antes del login) → toda la flota corre la misma versión. Despliegue masivo vía GPO/Intune.
- Backend: `serverless deploy` (Serverless Framework v4; secretos en `backend/.env`, ver `.env.example`).

## 12. Secretos (backend/.env, gitignored)

| Variable | Uso |
|---|---|
| `ROLES_API_KEY` | API externa de Roles & Permisos |
| `DASHBOARD_API_KEY` | API de agentes (imery) para el reparto |
| `INTERACTIONS_API_KEY` / `INTERACTIONS_USER_ID` | registro CRM |
| `SEND_API_KEY` | autentica `POST /send` |
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` (o `DATABASE_URL`) | PostgreSQL de campañas |

## 13. Mapa de código

| Flujo | Archivos |
|---|---|
| Presign/upload CSV | `backend/src/handlers/api.ts` (presignCsv) · `desktop/src/routes/Campaigns.tsx` |
| Trigger CSV → jobs | `backend/src/handlers/csvTrigger.ts` · `backend/src/lib/contacts.ts` |
| Poll/ack | `backend/src/handlers/jobsPoll.ts` · `desktop/electron/jobs/poller.ts` |
| Aprobación | `desktop/src/routes/Assignment.tsx` · IPC en `desktop/electron/main.ts` |
| Envío + plantillas | `desktop/electron/main.ts` (runJob) · `desktop/electron/whatsapp/client.ts` · `whatsapp/template.ts` |
| Envío directo | `backend/src/handlers/directSend.ts` · `ENVIO_DIRECTO.md` |
| CRM | `backend/src/handlers/interactions.ts` · `backend/src/lib/interactions.ts` |
| Summary/reassign | `backend/src/handlers/jobsAdmin.ts` · `desktop/src/routes/TeamViewer.tsx` |
| Campañas (PG) | `backend/src/lib/db.ts` · `backend/src/lib/campaignsDb.ts` |
| Acceso/permisos | `backend/src/lib/access.ts` · `permissions.ts` · `rolePerms.ts` · `roles.ts` |
| Chat manual/entrantes | `desktop/src/routes/Chats.tsx` · `backend/src/handlers/api.ts` (messages/media) |
