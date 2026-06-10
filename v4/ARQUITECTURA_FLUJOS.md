# ana v4 — Arquitectura y flujos

> Estado al 2026-06-10 (incluye: aprobación de asignación, envío directo, registro CRM, compat CSV v3, reparto/reasignación por agente). Complementa `ARCHITECTURE.md` y `CONTEXT.md`; este documento describe **cómo fluye todo de punta a punta**.

---

## 1. Topología general

Híbrido: WhatsApp vive **local** en la PC del agente (la sesión de Chromium no sobrevive Lambdas); AWS solo guarda datos, permisos y orquesta trabajo.

```
┌────────────────────── PC del agente ──────────────────────┐      ┌───────────────── AWS us-east-2 ─────────────────┐
│ Electron                                                  │      │                                                  │
│ ├─ main process (Node)                                    │      │ Cognito User Pool (Pernexium)                    │
│ │   ├─ WaClient: whatsapp-web.js + Chromium headless      │      │   └─ JWT id token (aud) → authorizer             │
│ │   ├─ JobPoller: GET /jobs/poll cada ~5s                 │ HTTPS│                                                  │
│ │   ├─ runJob: envía + reporta CRM                        │◀────▶│ HTTP API Gateway (njpfef2qna)                    │
│ │   ├─ auto-update (electron-updater ← S3)                │      │   ├─ Lambda api          (conversaciones, presign│
│ │   └─ IPC ◀──▶ renderer                                  │      │   │                       roles, media)          │
│ └─ renderer (React + Vite)                                │      │   ├─ Lambda jobsPoll     (poll/ack de jobs)      │
│     ├─ Login (Cognito PKCE)                               │      │   ├─ Lambda jobsAdmin    (summary/reassign)      │
│     ├─ Chats (manual, tiempo real)                        │      │   ├─ Lambda interactions (registro CRM)          │
│     ├─ Mi asignación (aprobar envíos)                     │      │   ├─ Lambda directSend   (POST /send, X-Api-Key) │
│     ├─ Campañas (subir CSV, líder)                        │      │   ├─ Lambda agents       (heartbeat/roster)      │
│     ├─ Vista de equipo (líder/admin)                      │      │   └─ Lambda csvTrigger   (evento S3, no HTTP)    │
│     └─ Admin (permisos por rol)                           │      │                                                  │
└───────────────────────────────────────────────────────────┘      │ DynamoDB: conversations, messages, jobs(+GSI),   │
                                                                   │           roleperms, agents, accesscache         │
        WhatsApp Web (web.whatsapp.com)                            │ S3: ana-backend-csv-* (csv-uploads/)             │
                ▲ sesión LocalAuth                                 │     ana-backend-media-* (media/)                 │
                └── Chromium headless del main                     │ PostgreSQL (RDS): tabla campaigns                │
                                                                   │ APIs externas: Roles, Dashboard (imery), CRM     │
                                                                   └──────────────────────────────────────────────────┘
```

## 2. Identidad y permisos

1. Login: Cognito hosted UI + PKCE loopback → **id token** (el authorizer valida `aud`, solo presente en id tokens). Claim `cognito:username` = `operatorId` = partición de TODOS los datos del agente.
2. `GET /me` → `resolveUserAccess()`: roles de la API externa → permisos `ana:*` locales (tabla `roleperms`) → unión de grants/denies + defaults (chats view/reply). Caché L1 memoria 15s, L2 DynamoDB 15 min.
3. Especiales: superadmin `erick.silva` (todo); rol con nombre ~ `/l[ií]der/` → upload, distribute, team view, jobs view/manage automáticos.
4. **Hard checks** (no dependen del flag `PERMISSIONS_ENFORCED`): consola admin, subir CSV (solo líder/admin/grant explícito), summary/reassign de jobs.

## 3. Flujo: campaña masiva (CSV → asignación → envío)

### 3.1 Subida (líder, tab Campañas)

```
Renderer ──POST /uploads/presign {filename, template, phoneColumn, campaign, distribute, assignments?}──▶ Lambda api
   ◀── { url (presigned PUT), key, metadata, eligibleAgents? }
Renderer ──PUT CSV──▶ S3 csv-uploads/<usuario>/<ts>_<archivo>.csv
```

- La **config viaja firmada** en la metadata del objeto S3 (`x-amz-meta-*`): el cliente no puede alterarla después del presign.
- Validaciones del presign: solo líder/admin puede subir; `distribute` requiere permiso; campaña debe ser propia **y existir** en la DB de campañas (si no → `400 la campaña "X" no existe`).
- `eligibleAgents` en la respuesta = preview de a quiénes se repartiría (misma fuente que usará el trigger).

### 3.2 Trigger (S3 → jobs)

```
S3 ObjectCreated(csv-uploads/*.csv) ──▶ Lambda csvTrigger
  1. lee objeto + metadata firmada
  2. parsea CSV (máx 10 MB / 50,000 filas)
  3. normalizeContactRow() por fila  ← alias estándar v3 ↔ español v4
     (phone_number↔telefono, total_balance↔saldo, message↔mensaje, …)
  4. destinatarios:
     · default: el propio uploader
     · distribute=1: round-robin entre agentes activos (API dashboard imery)
     · assignments={op:peso}: reparto ponderado explícito
  5. un SendJob por fila → BatchWrite a tabla jobs
     PK=operatorId (aísla por agente), SK=jobId=`<campaignId>#<i>`
     atributos: campaign (GSI), phone, template, row, srcKey, ttl 7 días
```

### 3.3 Poll y aprobación (agente, tab Mi asignación)

```
main JobPoller (cada ~5s, con token):
  GET /jobs/poll ──▶ Lambda jobsPoll ──▶ Query jobs WHERE operatorId = <yo>
  ◀── todos mis jobs pendientes
  ├─ jobs auto:true (envío directo §4)  → se procesan SOLOS
  └─ resto → IPC 'jobs:assignment' → renderer (vista Mi asignación)
```

- **Nada se envía sin aprobación**: el agente ve la tabla (nombre, teléfono enmascarado, archivo), selecciona contactos, opcionalmente cambia la plantilla (editor con preview usando el mismo motor) y pulsa Enviar → IPC `jobs:approve(jobIds, template?)`.
- Lo no seleccionado queda pendiente en DynamoDB y reaparece en cada poll.
- La vista se hidrata al montar con `jobs:get-assignment` (no espera al siguiente poll).

### 3.4 Envío (main process)

Por cada job aprobado, agrupado por archivo (`srcKey`), uno a la vez:

```
rateLimitWait()      máx 7 msgs/20 min + gap ≥2 min (countdown a la UI)
resolveJid(phone)    getNumberId → ¿tiene WhatsApp? (normaliza lada MX)
interpolate()        plantilla {campo}/{{campo}}, expresiones {saldo*0.9},
                     modificadores :dinero/:num, segunda pasada si la
                     plantilla es {message} (columna por contacto de v3)
sendText(jid, body)  typing simulado 2–9s → client.sendMessage
PUT /messages        respaldo en DynamoDB (aparece en Chats y vista de equipo)
POST /jobs/ack       borra el job de la cola
POST /interactions/report   registro CRM (fire-and-forget, §6)
```

- CSV de S3 se borra (`POST /uploads/delete`) solo cuando **no quedan jobs** de ese archivo (aprobación parcial no borra nada).
- Progreso (`sending/waiting/fileDone`, enviados/fallidos, countdown) → IPC `wa:progress` → barra en Campañas y Mi asignación.

## 4. Flujo: envío directo (sistema-a-sistema)

Ver `ENVIO_DIRECTO.md` para la guía de integración completa.

```
CRM/automatización ──POST /send {message, username, phone, campaign} + X-Api-Key──▶ Lambda directSend
  1. valida key (SEND_API_KEY) y campos; campaña debe existir en la DB
  2. Put SendJob auto:true en la partición del agente (jobId direct#<ts>#<tel>)
Agente: el poller lo detecta en ≤5s y lo envía SIN aprobación manual
  (mismo rate limit, mismo registro CRM, visible en sus Chats)
```

Único camino que envía sin aprobación; las campañas del líder siempre pasan por Mi asignación.

## 5. Flujo: chat manual + entrantes (conviven con la automatización)

Una sola sesión `whatsapp-web.js` headless; el bot y el humano no compiten por ninguna ventana (envíos van por API interna, no por DOM como en v3):

- **Saliente manual**: renderer → IPC `wa:send-reply` → `sendText(jid, body, sinTyping)` (el "escribiendo…" ya se mostró en vivo con `wa:typing`). Inmediato, **no cuenta** al rate limit. `PUT /messages` lo respalda.
- **Media manual**: IPC `wa:send-media` → envía + sube bytes a S3 (`POST /media/presign` → PUT) + puntero `mediaKey` en DynamoDB.
- **Entrante**: evento `message` del WaClient → si trae media: descarga → presign → S3 `media/<op>/...` (DynamoDB guarda solo el puntero) → `PUT /messages` → IPC `wa:message` → la UI hace append en sitio (sin recargar/parpadear).
- **Lectura**: `GET /conversations` y `GET /conversations/{chatId}/messages` (partición del propio operador; líder/admin pueden pedir `?operatorId=` de un agente de sus campañas — solo lectura).

## 6. Flujo: registro CRM

```
desktop runJob ──POST /interactions/report {jobId, campaign, phone, status, row}──▶ Lambda interactions
  1. idempotencia: marcador (REPORT#<op>, jobId) en tabla jobs; repetido → no-op
  2. credit_id: columnas del CSV (credit/credito/credit_id/id_credito)
     o lookup /client-info por teléfono (retry sin +52)
  3. insert interacción outbound (subdictamen "Se envía WhatsApp" / "No tiene Whatsapp")
  4. status no_whatsapp → PATCH /phone (has_whatsapp=false)
```

- API key del CRM (`INTERACTIONS_API_KEY`) vive solo en el backend — el desktop nunca la toca.
- Fire-and-forget: CRM caído no frena el ritmo de envío.

## 7. Flujo: supervisión y reasignación (líder/admin)

```
Vista de equipo:
  GET /jobs/summary?campaign=X ──▶ Lambda jobsAdmin ──▶ Query GSI campaign-index
     ◀── pendientes / en-lease por operatorId (filtra TTL expirado)
  POST /jobs/reassign {campaign, from, to} ──▶ por cada job pendiente de `from`:
     TransactWrite [Delete(from) + Put(to)]  ← atómico, respeta leases activos
```

- Es el reemplazo del consume-once de v3: agente caído a media campaña → el líder mueve sus pendientes a otro sin re-subir CSVs.
- Panel en TeamViewer: pendientes por agente, refresh 30s, botón Mover.
- Heartbeat: el desktop hace `POST /agents/heartbeat` al conectar WA y cada 5 min → tabla `agents` (PK=campaign); activo = visto en <10 min.

## 8. Campañas (PostgreSQL)

- Fuente: `SELECT name FROM campaigns` en RDS; conexión por `DATABASE_URL` o campos sueltos `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` (estilo pgAdmin), TLS cifrado sin verificación de CA.
- **Caché de 10 min** en memoria del Lambda caliente; si la DB falla se sirve lo último (stale > vacío).
- Consumo: dropdowns buscables (`SearchableSelect`) en Campañas y Vista de equipo — solo se puede elegir una opción existente; el backend además valida existencia en presign y `POST /send`.

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

- Sesión LocalAuth en `userData/wwebjs_auth` → reconexión automática al abrir la app.
- Watchdog 60s al iniciar (sin señal → aviso de Chromium/red).
- `auth_failure` o `disconnected(LOGOUT)` = cierre remoto o **número bloqueado** → la UI lo explica y ofrece "Limpiar sesión y reconectar" (`wa:reset`: borra `wwebjs_auth` + relanza → QR nuevo). Las conversaciones no se pierden: viven en DynamoDB y se recargan solas.

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
