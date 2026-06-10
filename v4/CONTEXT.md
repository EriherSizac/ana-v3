# ana — Documento de contexto

Contexto completo del proyecto para onboarding (humano o LLM). Resumen vivo de
qué es, por qué así, estado actual y cómo opera. Detalle por área en
[ARCHITECTURE.md](./ARCHITECTURE.md) · [STRUCTURE.md](./STRUCTURE.md) ·
[README.md](./README.md) · [design-system.md](./design-system.md) ·
[sso-cognito-cookie-storage.md](./sso-cognito-cookie-storage.md) ·
[Implementar_roles_locales.md](./Implementar_roles_locales.md).

---

## 1. Qué es

App de **WhatsApp para cobranza** (Pernexium). Un operador conecta su WhatsApp,
sube un CSV de contactos y la app envía mensajes con plantilla (`{campo}`,
saldos en MXN), además de un chat manual con respaldo de conversaciones.

**Híbrida**: cliente de escritorio (Electron) que corre `whatsapp-web.js` local
+ backend serverless en AWS para datos, roles y orquestación.

---

## 2. Por qué híbrida (decisión raíz)

`whatsapp-web.js` necesita un Chromium con sesión persistente 24/7 → **no corre
en Lambda** (efímero). Vive en la PC del operador (Electron). El backend
serverless **nunca toca WhatsApp**: solo guarda datos, resuelve permisos y
reparte trabajos de envío. WhatsApp se controla siempre desde el cliente local.

---

## 3. Topología

```
PC operador (Electron)                         AWS (serverless v4, us-east-2)
├─ main (Node)                                 ├─ Cognito User Pool (Pernexium)
│   · whatsapp-web.js + Chromium               ├─ API Gateway HTTP API (JWT)
│   · poller de jobs (1 archivo/vez, rate)     ├─ Lambda: api · agents · jobsPoll · csvTrigger
│   · auto-update (electron-updater + S3)      ├─ DynamoDB: conversations, messages, jobs,
│   · auto-reconexión de sesión WA             │            roleperms, agents, accesscache
└─ renderer (React + Vite + Tailwind)          ├─ S3: csv (uploads), media (backup)
    · login (username + MFA TOTP)              ├─ PostgreSQL (RDS): campañas
    · chats, campañas, admin, team viewer      └─ Roles API externa (X-Api-Key)
```

---

## 4. Decisiones clave (el porqué)

| Tema | Decisión | Por qué |
|------|----------|---------|
| Motor WhatsApp | `whatsapp-web.js` local | Gratis, sin verificación Meta; sesión persistente no cabe en Lambda |
| App | Electron + Vite + React | UI + motor en una pieza, en máquina persistente |
| Backend | Serverless v4 (TS nativo) + prune-plugin | Sin EC2; v4 compila TS sin esbuild |
| Auth | Cognito **id token** (no access) | El authorizer valida `aud`, presente solo en id tokens; trae `cognito:username` (=operatorId). **Sin** SSO cookie (Electron no vive en `*.pernexium.com.mx`) → login propio username+MFA |
| Multi-tenant | `operatorId` (claim JWT) en PK de las tablas | Aísla datos por operador; nunca del body |
| Cola de envíos | Tabla DynamoDB `jobs` (no SQS) | SQS compartido no filtra pull por tenant |
| Reparto del líder | Round-robin entre agentes de la campaña | No hay endpoint role→usuarios; se usa roster de agentes |
| Campañas | PostgreSQL (RDS) | Fuente de verdad de campañas del negocio |
| Enmascarado tel | Solo visual en UI | Dato plano en Dynamo; UI muestra `***1234` |

---

## 5. Modelo de datos (DynamoDB, aislado por operatorId)

| Tabla | PK / SK | Para qué |
|-------|---------|----------|
| `conversations` | `operatorId` / `chatId` | Resumen por chat (último msg, no-leídos) |
| `messages` | `convKey`=`operatorId#chatId` / `sk`=`ts#msgId` | Historial; `mediaKey` apunta a S3 |
| `jobs` | `operatorId` / `jobId`; TTL | Cola de envíos; `srcKey`=CSV en S3 |
| `roleperms` | `ROLEPERMS` / `ROLE#<roleId>` | Permisos `ana:*` por rol (grants y denies `-perm`) |
| `agents` | `campaign` / `operatorId` | Roster de agentes (heartbeat, `lastSeen`) |
| `accesscache` | `username`; TTL | Caché L2 de acceso resuelto + tombstones |

S3: `csv` (`csv-uploads/<user>/…`, dispara `csvTrigger`) · `media` (`media/<user>/…`).
PostgreSQL: tabla de campañas (default `campaigns.name`, configurable por env).

---

## 6. Endpoints (API Gateway, JWT Cognito)

| Método | Ruta | Hace |
|--------|------|------|
| GET | `/me` | Acceso efectivo (roles, permisos, isAdmin/isLeader) |
| GET | `/conversations` `?operatorId=` | Conversaciones (self/admin/líder de su campaña) |
| GET | `/conversations/{chatId}/messages` `?operatorId=` | Historial |
| PUT | `/messages` | Persiste mensaje (whitelist; pointers de media) |
| POST | `/uploads/presign` | URL firmada para subir CSV (config en metadata firmada) |
| POST | `/uploads/delete` | Borra el CSV (solo dueño) |
| POST | `/media/presign` | Subir media (nonce + allowlist content-type) |
| GET | `/media/url?key=` | Ver media (autz como conversación) |
| GET | `/jobs/poll` | Todos los jobs pendientes del operador |
| POST | `/jobs/ack` | Borra jobs procesados |
| POST | `/agents/heartbeat` | Agente activo en su campaña |
| GET | `/agents?campaign=` | Roster (admin/líder) |
| GET | `/agents/campaigns` | Campañas (PostgreSQL; admin todas, resto las suyas) |
| GET | `/admin/roles` | Lista de roles (jerarquía de Roles API) — admin |
| GET/PUT | `/admin/role-permissions/{roleId}` | Lee/asigna permisos del rol — admin |

---

## 7. Roles & permisos

Patrón local (`Implementar_roles_locales.md`): identidad en la Roles API externa
(`GET /users/{username}`), permisos del producto en `roleperms` (DynamoDB) por
nombre `ana:*`. `resolveUserAccess(username)` une todo (caché L1 mem 15s + L2
Dynamo 15min; invalidación por rol con tombstones).

- **Superadmin**: `erick.silva` → todo (bypass).
- **Líder**: `role_name` ~ `/l[ií]der/` → `contacts:upload`+`distribute`+`chats:view`+`chats:team:view`.
- **Default ON** para todo rol: `chats:conversation:view`, `chats:message:reply` (se pueden desactivar con deny `-perm`).
- **Admin** (`ana:admin:console:manage`) → todo; su endpoint es **fail-closed** (no depende del flag).
- **Flag** `PERMISSIONS_ENFORCED` (default `false`): no bloquea rutas normales hasta validar (admin siempre se exige).

Catálogo: `ana:admin:console:manage`, `ana:contacts:list:upload`,
`ana:contacts:list:distribute`, `ana:chats:conversation:view`,
`ana:chats:team:view`, `ana:chats:message:reply`, `ana:campaign:message:send`.

---

## 8. Flujos

### Envío masivo
1. Campañas: subir CSV (+plantilla, columna tel, lada, opción repartir).
2. Presign → S3 (`csv-uploads/`); `csvTrigger` parsea → jobs en DynamoDB
   (al uploader, o round-robin a agentes de la campaña si reparte).
3. `poller` (main) trae todos los pendientes, **agrupa por archivo y procesa uno a la vez**.
4. **Rate limit humano**: máx 7 msgs/20 min, ≥2 min entre cada uno. Simula
   "escribiendo…" 2–9s antes de enviar.
5. Cada envío → `PUT /messages` + `ack`. Al terminar el archivo → borra el CSV de S3.
6. Barra de progreso en Campañas (hecho/total, enviados/fallidos, cuenta regresiva).

### Chat manual
- Responder texto (typing en vivo mientras compones), enviar imagen/archivo
  (respaldo a S3 + pointer), ver media (imagen a pantalla completa).
- Entrante: se descarga media → S3; el hilo abierto se refresca en vivo.

### Team view (líder/admin)
- Selector "Ver como": admin elige campaña→agente; líder elige agente de su campaña.
- Conversaciones del agente en **solo lectura** (responder exige la sesión WA del dueño).

---

## 9. Auth (login)

Amplify v6 contra el User Pool. Login por **username** (regla design-system,
fondo azul). Maneja challenges MFA: **TOTP** (código en cajas, auto-submit), SMS,
selección MFA, setup TOTP, cambio de contraseña forzado. El renderer usa el **id
token**; lo pasa al main para el poller/backend.

---

## 10. Distribución (Electron)

- **Instalador NSIS oneClick** (sin wizard).
- **Auto-update obligatorio** desde S3 (`electron-updater`): al abrir, si hay
  versión nueva bloquea, descarga, reinstala y reinicia. Offline → continuar.
- **Sesión WA persistente**: `userData/wwebjs_auth`; auto-reconecta al abrir sin
  re-escanear QR. Botón "Limpiar sesión y reconectar" para sesión muerta.

---

## 11. Deploy & entorno

**Backend** (`backend/`): serverless v4, región `us-east-2`, perfil `pernexium`.
```bash
cd backend && npm install
serverless login
serverless deploy --stage prod \
  --param="issuer=https://cognito-idp.us-east-2.amazonaws.com/<POOL_ID>" \
  --param="clientId=<APP_CLIENT_ID>"
```
Secretos en `backend/.env` (no se commitean): `ROLES_API_KEY`, `DASHBOARD_API_KEY`,
`DATABASE_URL`, `PGSSL_CA`/`PGSSL_NO_VERIFY`.

**Desktop** (`desktop/`): `npm install` → `npm run electron:dev` (dev) /
`npm run publish` (build + sube release a S3). Config en `desktop/.env`
(`VITE_COGNITO_*`, `VITE_API_BASE`).

Backend prod actual: `https://njpfef2qna.execute-api.us-east-2.amazonaws.com`
(Cognito pool `us-east-2_UepfOyKpd`, client `1r6niimhkl2fmias6kk85n4ou4`).

---

## 12. Estado / pendientes

- **Funciona**: login+MFA, conexión WA, envío masivo con rate limit/typing,
  chat manual + media (enviar/ver/respaldar), roles+admin UI, team view,
  auto-update, campañas desde PostgreSQL.
- **Requiere datos de infra**:
  - `DATABASE_URL` + esquema real de campañas (tabla/columna) en deploy.
  - Si RDS es **privado** → falta `vpc:` en `serverless.yml` (subnets + SG).
  - `PERMISSIONS_ENFORCED=true` cuando se validen permisos.
- **Notas**: el "escribiendo…" se ve en el teléfono del contacto (no en ana);
  enviar a números sin WhatsApp marca "No tiene WhatsApp".
