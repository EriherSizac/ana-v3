# Diferencias entre ANA v3 y ANA v4

> Documento comparativo generado el 2026-06-10. v4 es una **reescritura completa**, no una evolución incremental de v3.

---

## Resumen ejecutivo

| Aspecto | v3 | v4 |
|---|---|---|
| **Concepto** | Plataforma de mensajería masiva WhatsApp (web + CLI) | App de escritorio WhatsApp para cobranza (Pernexium, MX) |
| **Cliente** | Next.js web app + CLI Node.js empaquetado como `.exe` | App Electron (React 19 + Vite) con instalador NSIS |
| **Motor WhatsApp** | Playwright (Chromium) automatizando WhatsApp Web | `whatsapp-web.js` v1.34 (Puppeteer) embebido en Electron |
| **Backend** | Lambda + S3 (sin base de datos) | Lambda + DynamoDB + S3 + PostgreSQL (RDS) |
| **Autenticación** | Credenciales por campaña en S3, password diario regenerado | AWS Cognito User Pool (JWT id token, PKCE, MFA) |
| **Multi-tenant** | Por carpetas de campaña en S3 | Aislamiento por `operatorId` (claim del JWT, PK de DynamoDB) |
| **Roles/permisos** | No existe (solo supervisor vs agente implícito) | Catálogo local `ana:*` en DynamoDB + roles de API externa |
| **Distribución** | `pkg` + esbuild → `ANA-Setup.exe` portable | Electron Builder → NSIS + auto-update obligatorio vía S3 |
| **Persistencia de chats** | Backups CSV/archivos en S3 | Conversaciones y mensajes en DynamoDB, restauración en UI |

---

## 1. Arquitectura

### v3 — Tres piezas independientes
- **Web UI (Next.js 14)**: interfaz local en `localhost:3000` con API routes propias (`/api/whatsapp/connect`, `/send`, `/status`). Pensada para campañas pequeñas de un solo usuario.
- **CLI (`cli-whatsapp/`)**: herramienta standalone con sistema de **dos ventanas** (ventana de automatización que envía y se cierra + ventana manual persistente para responder). Empaquetada como `.exe`.
- **Backend (`ana-backend/`)**: Lambdas que orquestan contactos, credenciales, backups y plantillas sobre **S3 puro** — sin base de datos. Patrón "consume-once": el agente descarga contactos y se borran de S3.

### v4 — Monolito híbrido escritorio + serverless
- **Desktop (Electron)**: proceso main de Node corre `whatsapp-web.js` + poller de jobs (~4s) + auto-update; renderer React con login Cognito, chats, campañas, consola admin y vista de equipo. Puente IPC entre ambos.
- **Backend (Serverless Framework v4)**: Lambdas `api`, `agents`, `jobsPoll`, `csvTrigger`. 6 tablas DynamoDB (`conversations`, `messages`, `jobs`, `roleperms`, `agents`, `accesscache`), 2 buckets S3 (`csv-uploads`, `media-backup`), PostgreSQL para campañas.
- **Decisión clave**: WhatsApp vive local (la sesión de Chromium no sobrevive cold starts de Lambda); AWS solo maneja datos, permisos y orquestación.

---

## 2. Stack tecnológico

| Componente | v3 | v4 |
|---|---|---|
| Frontend | Next.js 14.2, React 18.3, Tailwind 3.4 | Electron 38, React 19, Vite 6, Tailwind 3.4 |
| Automatización WA | Playwright 1.48 (chromium) | whatsapp-web.js 1.34 (Puppeteer) |
| Backend runtime | Node 20.x, Serverless Framework | Node TS, Serverless Framework v4 |
| Almacenamiento | Solo S3 (archivos CSV/JSON) | DynamoDB + S3 + PostgreSQL (`pg` 8.13) |
| Auth | Credenciales propias en S3 | AWS Amplify v6 + Cognito (PKCE, TOTP/SMS MFA) |
| Empaquetado | `pkg` + esbuild → exe portable | Electron Builder 26 → instalador NSIS |
| Auto-update | Self-update casero en CLI | `electron-updater` 6.3 con feed S3, **obligatorio al arrancar** |
| Testing | Playwright E2E | (no se observó suite formal) |

---

## 3. Flujo de envío masivo

### v3
1. Supervisor sube CSV a S3 vía Lambda (`supervisors.ts`).
2. Agente (CLI o web) descarga contactos (consume-once, se borran de S3).
3. Plantilla con variables `{{first_name}}`, `{{credit}}` — soporta **expresiones matemáticas** (`{{credit*0.9}}`).
4. Playwright navega WhatsApp Web, escribe y envía con delay configurable (5+ seg).
5. Backups de chats se suben a S3 como archivos.

### v4
1. UI pide presign (`POST /uploads/presign`) con la config firmada en metadata.
2. Renderer sube CSV a S3 (`csv-uploads/`).
3. Evento S3 dispara Lambda `csvTrigger`: parsea CSV → escribe jobs en tabla `jobs` (PK=`operatorId`, con TTL y sistema de lease).
4. Proceso main hace `GET /jobs/poll` cada ~4s, toma hasta 10 jobs en lease.
5. Por job: normaliza teléfono → interpola plantilla (ej. `{amount}` en MXN) → `WaClient.sendMessage` con ritmo humano (**máx 7 msgs/20 min, typing de 2–9s**).
6. `PUT /messages` a DynamoDB + `POST /jobs/ack` borra el job.

**Diferencia clave**: v3 reparte trabajo por descarga de archivos; v4 usa una cola de jobs propia en DynamoDB (eligieron tabla en vez de SQS para aislar por tenant).

---

## 4. Mensajes entrantes y media

| | v3 | v4 |
|---|---|---|
| Respuestas | Ventana manual del CLI (interacción humana directa) | Chat manual integrado en la app con eventos IPC en tiempo real |
| Media entrante | No gestionada formalmente | Descarga → presign → S3 `media-backup/`; DynamoDB guarda solo el puntero `mediaKey` |
| Historial | Backup de chats individuales a S3 (`chat-backup.js`, `chatBackups.ts`) | Conversaciones/mensajes persistidos en DynamoDB y restaurados al abrir sesión |

---

## 5. Identidad, roles y permisos

### v3
- Credenciales por campaña guardadas en S3; password **regenerado diariamente** por Lambda.
- Sin concepto de roles: endpoints de supervisor vs flujo de agente, nada más.

### v4
- **Cognito User Pool** compartido de Pernexium; login con hosted UI + PKCE loopback; soporta MFA TOTP/SMS y cambio forzado de password. Se usa el **id token** (no access token) porque el authorizer valida `aud`.
- Identidad de roles viene de **API externa** (`GET /users/{username}`); los permisos `ana:*` se almacenan localmente en tabla `roleperms` (patrón documentado en `Implementar_roles_locales.md`).
- `resolveUserAccess()`: unión de grants/denies de todos los roles; caché L1 en memoria (15s) y L2 en DynamoDB (15min).
- Casos especiales: superadmin `erick.silva` bypass total; regex `/l[ií]der/` otorga permisos de líder automáticamente.
- **Vista de equipo**: líder/admin ve conversaciones de sus agentes (solo lectura).
- Consola admin para asignar permisos por rol.

---

## 6. Campañas y distribución de contactos

- **v3**: campañas = carpetas en S3 (`agents/{campaign}/`); plantillas por campaña con CRUD (commit reciente `cf6215d`).
- **v4**: campañas viven en **PostgreSQL (RDS)**; los contactos se asignan **round-robin** entre agentes activos usando el roster con heartbeat de la tabla `agents` (documentado en `api-agentes.md` para el canal `telefonomanual`).

---

## 7. Distribución e instalación

| | v3 | v4 |
|---|---|---|
| Artefacto | `ANA-Setup.exe` portable (pkg, no requiere Node) | Instalador NSIS one-click (Windows) |
| Updates | Self-update casero | electron-updater contra S3; **bloqueante y obligatorio** al lanzar |
| Despliegue masivo | Manual | Pensado para GPO/Intune |
| Backend deploy | `serverless deploy` clásico | Serverless v4 (requiere login/key) |

---

## 8. Documentación

- **v3**: docs orientadas a uso y soporte — `README.md`, `CHANGELOG.md`, `TROUBLESHOOTING.md`, `DIAGNOSTICO_RAPIDO.md`, `SOLUCION_INMEDIATA.md`, `INSTRUCCIONES_USO.md`, `TEMPLATE_GUIDE.md`, más guías del CLI (instalador, límites de mensajes).
- **v4**: docs orientadas a arquitectura y onboarding — `ARCHITECTURE.md` (decisiones y flujos), `STRUCTURE.md` (mapa de archivos), `CONTEXT.md` (onboarding completo), `design-system.md` (tokens visuales Pernexium: navy #145CB3, Jost/Inter, cero emojis decorativos), `sso-cognito-cookie-storage.md` (SSO por cookie, **no aplica** a Electron), `api-agentes.md`, `Implementar_roles_locales.md`.

---

## 9. Qué se ganó y qué se perdió en v4

**Ganancias**
- Datos estructurados y consultables (DynamoDB) en vez de archivos sueltos en S3.
- Auth real (Cognito + MFA) y aislamiento multi-tenant por `operatorId`.
- Sistema de roles/permisos granular con consola de administración.
- Rate limiting anti-bloqueo más sofisticado (7 msgs/20 min, typing simulado).
- Auto-update obligatorio → flota siempre en la misma versión.
- Vista de equipo para líderes; restauración de conversaciones.
- Media entrante respaldada en S3 con punteros en DB.

**Pérdidas / pendientes respecto a v3**
- Ya no hay web UI ligera para uso casual (todo requiere instalar Electron).
- Se pierde el sistema de dos ventanas del CLI (automatización + manual separadas) — en v4 todo vive en una app.
- v3 soportaba expresiones matemáticas en plantillas (`{{credit*0.9}}`); confirmar si v4 las migró.
- Sin suite E2E observable en v4 (v3 tenía Playwright tests).
- Pendientes documentados en v4: configuración de RDS y flag `PERMISSIONS_ENFORCED` aún no activado.

---

## 10. Estructura de carpetas (referencia rápida)

```
v3/                          v4/
├── app/          (Next.js)  ├── backend/   (Lambda+DDB+S3+PG)
├── lib/          (core)     ├── desktop/   (Electron main+renderer)
├── cli-whatsapp/ (CLI exe)  ├── demo/      (referencia)
├── ana-backend/  (Lambda+S3)└── *.md       (arquitectura/onboarding)
└── *.md          (uso/soporte)
```
