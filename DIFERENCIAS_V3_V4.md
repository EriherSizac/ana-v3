# Diferencias entre ANA v3 y ANA v4

> Documento comparativo. Actualizado 2026-06-10, tras portar a v4 la segmentación por agente y el registro de interacciones CRM de v3 (commit `72dfda1`). v4 es una **reescritura completa**, no una evolución incremental de v3.

---

## Resumen ejecutivo

| Aspecto | v3 | v4 |
|---|---|---|
| **Concepto** | Plataforma de mensajería masiva WhatsApp (web + CLI) | App de escritorio WhatsApp para cobranza (Pernexium, MX) |
| **Cliente** | Next.js web app + CLI Node.js empaquetado como `.exe` | App Electron (React 19 + Vite) con instalador NSIS |
| **Motor WhatsApp** | Playwright (Chromium visible) automatizando el DOM de WhatsApp Web | `whatsapp-web.js` v1.34 (Puppeteer headless) embebido en Electron |
| **Backend** | Lambda + S3 (sin base de datos) | Lambda + DynamoDB + S3 + PostgreSQL (RDS) |
| **Autenticación** | Credenciales por campaña en S3, password diario regenerado | AWS Cognito User Pool (JWT id token, PKCE, MFA) |
| **Multi-tenant** | Por carpetas de campaña en S3 | Aislamiento por `operatorId` (claim del JWT, PK de DynamoDB) |
| **Roles/permisos** | No existe (solo supervisor vs agente implícito) | Catálogo local `ana:*` en DynamoDB + roles de API externa |
| **Reparto de contactos** | Supervisor sube CSV por agente a S3 (consume-once) | Round-robin automático, pesos explícitos, o al propio uploader; reasignación de pendientes en vivo |
| **Interacciones CRM** | El CLI llama directo al API (key hardcodeada en el exe) | Lambda `POST /interactions/report` (key en `.env` del backend) |
| **Distribución** | `pkg` + esbuild → `ANA-Setup.exe` portable | Electron Builder → NSIS + auto-update obligatorio vía S3 |
| **Persistencia de chats** | Backups CSV/archivos en S3 | Conversaciones y mensajes en DynamoDB, restauración en UI |

---

## 1. Arquitectura

### v3 — Tres piezas independientes
- **Web UI (Next.js 14)**: interfaz local en `localhost:3000` con API routes propias (`/api/whatsapp/connect`, `/send`, `/status`). Pensada para campañas pequeñas de un solo usuario.
- **CLI (`cli-whatsapp/`)**: herramienta standalone con sistema de **dos ventanas** (ver §4). Empaquetada como `.exe`.
- **Backend (`ana-backend/`)**: Lambdas que orquestan contactos, credenciales, backups y plantillas sobre **S3 puro** — sin base de datos. Patrón "consume-once": el agente descarga contactos y se borran de S3.

### v4 — Monolito híbrido escritorio + serverless
- **Desktop (Electron)**: proceso main de Node corre `whatsapp-web.js` + poller de jobs (~5s) + auto-update; renderer React con login Cognito, chats, campañas, consola admin y vista de equipo. Puente IPC entre ambos.
- **Backend (Serverless Framework v4)**: Lambdas `api`, `agents`, `jobsPoll`, `jobsAdmin`, `interactions`, `csvTrigger`. 6 tablas DynamoDB (`conversations`, `messages`, `jobs` + GSI `campaign-index`, `roleperms`, `agents`, `accesscache`), 2 buckets S3 (`csv-uploads`, `media-backup`), PostgreSQL para campañas.
- **Decisión clave**: WhatsApp vive local (la sesión de Chromium no sobrevive cold starts de Lambda); AWS solo maneja datos, permisos y orquestación.

---

## 2. Stack tecnológico

| Componente | v3 | v4 |
|---|---|---|
| Frontend | Next.js 14.2, React 18.3, Tailwind 3.4 | Electron 38, React 19, Vite 6, Tailwind 3.4 |
| Automatización WA | Playwright 1.48 (chromium visible) | whatsapp-web.js 1.34 (Puppeteer headless) |
| Backend runtime | Node 20.x, Serverless Framework | Node TS, Serverless Framework v4 |
| Almacenamiento | Solo S3 (archivos CSV/JSON) | DynamoDB + S3 + PostgreSQL (`pg` 8.13) |
| Auth | Credenciales propias en S3 | AWS Amplify v6 + Cognito (PKCE, TOTP/SMS MFA) |
| Empaquetado | `pkg` + esbuild → exe portable | Electron Builder 26 → instalador NSIS |
| Auto-update | Self-update casero en CLI | `electron-updater` 6.3 con feed S3, **obligatorio al arrancar** |
| Testing | Playwright E2E | (sin suite formal) |

---

## 3. Flujo de envío masivo

### v3
1. Supervisor sube CSV **por agente** a S3 vía Lambda (`supervisors.ts` → `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv`).
2. Agente (CLI) descarga su assignment (consume-once) y reporta pendientes con `updatePendingContacts`.
3. Plantilla con variables `{{first_name}}`, `{{credit}}` — soporta **expresiones matemáticas** (`{{credit*0.9}}`).
4. Playwright navega WhatsApp Web, teclea y envía con delay aleatorio 30–120s; pausa de 20 min cada N mensajes.
5. Backups de chats se suben a S3 como archivos.

### v4
1. UI pide presign (`POST /uploads/presign`) con la config **firmada en metadata** del objeto S3; si hay reparto, la respuesta incluye `eligibleAgents` como preview.
2. Renderer sube CSV a S3 (`csv-uploads/`).
3. Evento S3 dispara Lambda `csvTrigger`: parsea CSV → escribe un job por fila en tabla `jobs` (PK=`operatorId`, TTL 7 días). Destinatarios:
   - el propio uploader (default),
   - **round-robin** entre agentes activos de la campaña (`distribute=1`, roster del dashboard), o
   - **reparto explícito por pesos** (`assignments: {agente: peso}`, firmado en el presign).
4. Proceso main de cada agente hace `GET /jobs/poll` (~5s), agrupa por archivo y procesa uno a la vez.
5. Por job: normaliza teléfono → `getNumberId` (¿tiene WhatsApp?) → interpola plantilla → `sendMessage` con typing simulado 2–9s. Ritmo: **máx 7 msgs/20 min, gap ≥2 min** (goteo, no ráfaga).
6. `PUT /messages` a DynamoDB + `POST /jobs/ack` borra el job + **`POST /interactions/report` registra en el CRM** (ver §6).
7. **Supervisión en vivo**: `GET /jobs/summary?campaign=X` da pendientes por agente; `POST /jobs/reassign` mueve pendientes de un agente caído a otro (transaccional, respeta leases). Panel en la vista de equipo con botón "Mover".

**Diferencia clave**: v3 reparte trabajo por archivos estáticos en S3 (rígido: reasignar = re-subir CSV); v4 usa una cola de jobs viva en DynamoDB con visibilidad y reasignación en caliente.

---

## 4. Automatización + chat manual simultáneos

La diferencia estructural más importante en la experiencia del agente.

### v3 — dos ventanas Playwright
La automatización **tecleaba en el DOM real** de WhatsApp Web, así que el bot y el humano competían por la misma ventana. Solución: dos sesiones de navegador visibles:
- 🤖 **Ventana de automatización**: el bot navega, teclea y envía; overlay que bloquea mouse/teclado del usuario; se cierra al terminar la campaña.
- 💬 **Ventana manual**: persistente, para que el agente responda; con bloqueos de DevTools/menú contextual inyectados.
Más una tercera ventana monitor en algunos flujos. Frágil: dependía de selectores del DOM y de que el usuario no tocara la ventana equivocada.

### v4 — un solo cliente, dos caminos
Una única sesión `whatsapp-web.js` **headless** (Chromium invisible) en el main process. Los envíos van por la API interna de WhatsApp Web (`client.sendMessage`), no por el DOM, así que no hay ventana que disputarse:
- **Automatización**: `JobPoller` → `runJob` → `sendText` con typing simulado. Serial y rate-limited.
- **Manual**: el renderer React (UI propia de chats) → IPC `wa:send-reply` → `sendText` inmediato, sin delay; el "escribiendo…" se muestra en vivo con `wa:typing` mientras el agente teclea. **No cuenta** para el rate limit de campaña.
- **Entrantes**: evento `message` → media a S3 → DynamoDB → IPC al renderer en tiempo real.

Ambos caminos son llamadas async al mismo cliente; chats distintos = estados independientes, sin colisión. El agente puede responder mientras la campaña corre, sin overlays ni ventanas bloqueadas.

---

## 5. Identidad, roles y permisos

### v3
- Credenciales por campaña guardadas en S3; password **regenerado diariamente** por Lambda.
- Sin concepto de roles: endpoints de supervisor vs flujo de agente, nada más.

### v4
- **Cognito User Pool** compartido de Pernexium; login con hosted UI + PKCE loopback; MFA TOTP/SMS y cambio forzado de password. Se usa el **id token** (no access token) porque el authorizer valida `aud`.
- Identidad de roles viene de **API externa**; los permisos `ana:*` se almacenan localmente en tabla `roleperms`.
- `resolveUserAccess()`: unión de grants/denies de todos los roles; caché L1 memoria (15s) y L2 DynamoDB (15min).
- Catálogo actual: admin console, contacts upload/distribute, chats view/team-view/reply, campaign send, y **`ana:team:jobs:view` / `ana:team:jobs:manage`** (resumen y reasignación de envíos; los líderes los reciben automático).
- Casos especiales: superadmin `erick.silva` bypass; regex `/l[ií]der/` otorga capacidades de líder.
- Los endpoints de jobs de equipo son **fail-closed**: exigen admin o líder de la campaña aunque `PERMISSIONS_ENFORCED` siga apagado.

---

## 6. Registro de interacciones CRM

| | v3 | v4 (desde `72dfda1`) |
|---|---|---|
| Quién llama al CRM | El CLI directo, con **API key hardcodeada en el exe** | Lambda `interactions`; el desktop solo manda el resultado con su JWT |
| Key | En el código (y en el historial de git) | `INTERACTIONS_API_KEY` en `backend/.env` (gitignored) |
| Flujo | Tras cada envío: lookup `credit_id` por teléfono (`/client-info`, retry sin `+52`), `insertInteractions`, `PATCH /phone` si no tiene WhatsApp | Igual semántica: `POST /interactions/report` resuelve `credit_id` (columnas CSV `credit/credito/credit_id/id_credito` o lookup), inserta interacción (mismo shape/subdictamen), PATCH si `no_whatsapp` |
| Detección "no tiene WhatsApp" | Inferida del DOM con Playwright | `client.getNumberId()` — respuesta directa de WhatsApp, más confiable |
| Duplicados | Posibles en retry | **Idempotente por `jobId`** (marcador condicional en DynamoDB) |
| Resiliencia | Solo log si falla | Fire-and-forget: CRM caído no frena el ritmo de envío |
| `user_id` del CRM | Constante en el código | `INTERACTIONS_USER_ID` en env (mapeo por operador: pendiente) |

---

## 7. Mensajes entrantes y media

| | v3 | v4 |
|---|---|---|
| Respuestas | Ventana manual del CLI | Chat manual integrado con IPC en tiempo real |
| Media entrante | No gestionada formalmente | Descarga → presign → S3 `media-backup/`; DynamoDB guarda solo el puntero `mediaKey` |
| Historial | Backup de chats individuales a S3 | Conversaciones/mensajes en DynamoDB, restaurados al abrir sesión |

---

## 8. Distribución e instalación

| | v3 | v4 |
|---|---|---|
| Artefacto | `ANA-Setup.exe` portable (pkg, no requiere Node) | Instalador NSIS one-click (Windows) |
| Updates | Self-update casero | electron-updater contra S3; **bloqueante y obligatorio** al lanzar |
| Despliegue masivo | Manual | Pensado para GPO/Intune |
| Backend deploy | `serverless deploy` clásico | Serverless v4 (requiere login/key) |
| Cambiar el ritmo de envío | Constantes en el exe → rebuild | Constantes en `poller.ts` → release (config remota: no implementada, descartado el modo ráfaga) |

---

## 9. Qué se ganó y qué se perdió en v4

**Ganancias**
- Datos estructurados y consultables (DynamoDB) en vez de archivos sueltos en S3.
- Auth real (Cognito + MFA) y aislamiento multi-tenant por `operatorId`.
- Roles/permisos granulares con consola de administración.
- Automatización y chat manual **simultáneos sin fricción** (un cliente headless vs dos ventanas frágiles, §4).
- Rate limiting anti-bloqueo por goteo (7 msgs/20 min, typing simulado).
- Reparto de contactos vivo: round-robin, pesos explícitos, resumen por agente y **reasignación en caliente** (v3 requería re-subir CSVs).
- Registro CRM idempotente y centralizado en backend, key fuera del cliente.
- Auto-update obligatorio → flota siempre en la misma versión.
- Vista de equipo para líderes; restauración de conversaciones; media respaldada en S3.

**Pérdidas / pendientes respecto a v3**
- Ya no hay web UI ligera para uso casual (todo requiere instalar Electron).
- v3 soportaba expresiones matemáticas en plantillas (`{{credit*0.9}}`); v4 no las migró aún.
- Sin suite E2E (v3 tenía Playwright tests).
- Pendientes documentados en v4: configuración de RDS, flag `PERMISSIONS_ENFORCED` apagado, mapeo `operatorId` → user del CRM, editor de pesos en la UI de upload (el backend ya lo soporta vía `assignments`).
- La API key de interactions sigue expuesta en el historial de git de v3 (`agent-config.js`); en v4 vive en `.env`.

---

## 10. Estructura de carpetas (referencia rápida)

```
v3/                          v4/
├── app/          (Next.js)  ├── backend/   (Lambda+DDB+S3+PG)
├── lib/          (core)     │   └── src/handlers: api, agents, jobsPoll,
├── cli-whatsapp/ (CLI exe)  │       jobsAdmin, interactions, csvTrigger
├── ana-backend/  (Lambda+S3)├── desktop/   (Electron main+renderer)
└── *.md          (uso/      ├── demo/      (referencia)
     soporte)                └── *.md       (arquitectura/onboarding)
```
