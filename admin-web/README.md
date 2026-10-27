# ANA Admin (`admin-web/`)

Consola web de administración de ANA (Pernexium). Next.js 15 (App Router) +
TypeScript estricto + Tailwind 3, pensada para `https://ana-admin.pernexium.com.mx`.

## Arquitectura

```
navegador ──(id token en Authorization)──▶ BFF (route handlers /api/*) ──(mismo id token)──▶ v3 / v4
     │                                         │
     └─ Amplify v6 + CookieStorage (.pernexium.com.mx)   └─ verifica JWT (aws-jwt-verify) → acceso vía v4 GET /me
```

- **SSO** (`src/lib/amplify.ts`, `src/components/system/AmplifyProvider.tsx`):
  réplica de `docs/sso-cognito-cookie-storage.md`. Los tokens de Cognito
  (pool `us-east-2_UepfOyKpd`) se guardan en cookie del apex común
  (`domain=.pernexium.com.mx`, `secure`) solo en producción; en desarrollo sin
  `domain` ni `secure`. ANA Admin usa el **mismo App Client** que v4
  (`1r6niimhkl2fmias6kk85n4ou4`): Amplify nombra las cookies por client id, así
  que un client distinto no vería la sesión de las demás apps.
- **Login** (`/login`): fondo azul, campo *Usuario* (username, nunca correo),
  challenges del pool (TOTP, SMS, selección de MFA, alta de TOTP, nueva
  contraseña). Al montar comprueba la sesión y redirige a `next` (solo rutas
  internas, `src/lib/safe-next.ts`).
- **Gate** (`src/app/(console)/layout.tsx` → `ConsoleGate`): Skeleton mientras
  resuelve la sesión, redirect a `/login?next=` sin sesión, carga `GET /api/me`
  y muestra "Sin acceso" si el usuario no puede entrar o no tiene la sección.
- **Cliente HTTP** (`src/lib/api-client.ts`): manda el id token en
  `Authorization` (no cookie → sin superficie CSRF); ante 401 fuerza
  `fetchAuthSession({ forceRefresh: true })`, reintenta una vez y si falla
  redirige al login.
- **BFF** (`src/app/api/**/route.ts`, `src/server/`):
  - `auth/verifyIdToken.ts`: firma (JWKS del pool), emisor, `token_use=id`,
    expiración y `aud` ∈ `COGNITO_ALLOWED_CLIENT_IDS`. Identidad = `cognito:username`.
  - `access/resolveAccess.ts`: acceso efectivo = v4 `GET /me` con el token del
    usuario (timeout 5 s, caché 60 s por usuario, errores no se cachean → 503).
    `isDeveloper` se deriva de `roleNames` (sin mayúsculas ni acentos).
  - `access/withAccess.ts`: `withAccess(handler, { permission, campaignFrom })`
    aplica gate de entrada, permiso de la ruta y alcance de campaña (admin y
    `*` pasan) antes de llamar a cualquier backend.
  - `errors.ts`: errores uniformes `{"error":{"code","message"}}`.
  - Los backends reciben el **id token del usuario**; nunca `X-Admin-Key`.
    Solo las lecturas de directorio (Cognito `ListUsers`, API de Roles) usan
    credenciales de servidor, y siempre después de autorizar.
- **Entrada a la consola**: `isAdmin`, rol Developer, o permiso
  `ana:admin:agents:manage` / `ana:contacts:list:upload` / `ana:campaign:message:send`
  (agentes y supervisores: solo ven "Mi asignación"; las demás rutas BFF exigen su
  propio permiso y les responden 403).
- **Secciones**: `src/lib/sections.ts` registra `{href, label, description, isAllowed(access)}`;
  la navegación y el gate por URL usan ese registro.

## Variables de entorno

Ver `.env.example`. Las `NEXT_PUBLIC_*` van al bundle del navegador (solo
identificadores públicos); el resto solo existe en el servidor y
`src/instrumentation.ts` hace fallar el arranque si falta alguna.

| Variable | Ámbito | Uso |
|---|---|---|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | público | `us-east-2_UepfOyKpd` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | público | App Client compartido `1r6niimhkl2fmias6kk85n4ou4` |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | público | `.pernexium.com.mx` en prod, `localhost` en dev |
| `NEXT_PUBLIC_REALTIME_URL` | público | URL `wss://…execute-api…/<stage>` del canal realtime (`RealtimeWsUrl` de v4); vacía = sin canal |
| `NEXT_PUBLIC_REALTIME_ENABLED` | público | `false` apaga el canal (por defecto encendido si hay URL) |
| `COGNITO_ALLOWED_CLIENT_IDS` | servidor | allowlist de `aud` (separada por comas) |
| `ANA_V4_API_BASE` | servidor | backend v4 (`GET /me`, `GET /agents/campaigns`) |
| `ANA_V3_API_BASE` | servidor | backend v3 (rutas `/admin/*`) |
| `ROLES_API_BASE`, `ROLES_API_KEY` | servidor | API de Roles (directorio) |

## Correr en local

```bash
cd admin-web
npm ci
cp .env.example .env.local     # completa ANA_V3_API_BASE, ROLES_API_* ; deja NEXT_PUBLIC_COOKIE_DOMAIN=localhost
npm run dev                    # http://localhost:3000
```

Con `NEXT_PUBLIC_COOKIE_DOMAIN=localhost` y `NODE_ENV=development` la cookie se
escribe sin `domain` ni `secure` (una cookie con dominio apex no se setea en
`http://localhost`). El SSO con otras apps solo se puede probar en el dominio
real.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | build de producción |
| `npm run lint` | ESLint (incluye las reglas del sistema de diseño) |
| `npm run check:design` | sin colores hex en `.tsx` ni clases de la paleta Tailwind por defecto |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest + Testing Library |
| `npm run check:bundle` | tras un build con `.env.test` cargado, falla si `ROLES_API_KEY`/`AWS_*` aparecen en `.next/static` |

## Sistema de diseño

Implementación local de `docs/design-system.md` (paquete compartido entre
productos = otra iniciativa).

- **Tokens** (`tailwind.config.ts`): `theme.colors` se **reemplaza** con
  `primary`, `secondary`, `error`, `neutral`, `text` y variantes, más solo
  `red/green 50/700` para mensajes inline (§7.5). `bg-blue-500`, `text-gray-700`,
  etc. no generan CSS. Extras: `shadow-card`, `text-2xs`, keyframes §6.
- **Utilidades** (`src/app/globals.css`): `pernexium-card`,
  `pernexium-gradient`, `.jost`, keyframes `fadeIn/enter/leave/shimmer/pulse/glow/sweep/gradientAnimation/spin`.
  Jost (Google Fonts) para encabezados, Inter (`next/font/google`) para el cuerpo.
- **Componentes** (`src/components/ui/`):
  `Button` (`default|outline|destructive|ghost|inverse`, `sm|default|lg|icon`, `loading`),
  `Input`/`Textarea`/`Label`, `Card*`, `Badge`, `Skeleton`/`SkeletonRows`,
  `Dialog`, `ConfirmDialog` (obligatorio para toda confirmación; Escape,
  backdrop y Cancelar cierran; deshabilitado con `loading`), `ToastProvider`/`useToast`,
  `InlineMessage`, `FilterPill`, `SearchableSelect` (un valor) y
  `SearchableMultiselect` (varios; solo aceptan opciones de la lista),
  `PageContainer`/`PageHeader`/`TableContainer`.
- **Reglas verificadas en CI**:
  - `npm run lint`: `no-alert`, `no-restricted-globals` (`alert`/`confirm`/`prompt`),
    `no-restricted-properties` (`window.alert/confirm/prompt`) y
    `no-restricted-syntax` para JSX `<select>`.
  - `npm run check:design`: hex en `.tsx` y clases de paleta por defecto.
  - Pruebas en `test/design/` con fixtures que demuestran que cada regla falla.

## Sección Agentes (`/agentes`)

Requiere `isAdmin` o `ana:admin:agents:manage` (alcance: campañas del usuario o `*`).

- **Directorio** (`src/server/directory/`): `cognito.ts` hace `ListUsers`
  paginado (60 por página) sobre `us-east-2_UepfOyKpd`; `rolesApi.ts` lee la API
  de Roles con `X-Api-Key` (`GET /users` normalizado `id/name/campaign` →
  `role_id/role_name/campaign_name`; `GET /users/{username}` con permisos
  inline para el detalle; nunca `/roles/{id}/permissions`). Ambos con caché de
  5 min; el botón **Actualizar** (`?refresh=1`) la invalida. Si la API de Roles
  falla, la tabla se muestra con "Roles no disponibles".
- **Estado por flota** (`src/server/backends/rosters.ts`): v3
  `GET/POST /admin/campaigns/{c}/roster[/agents]` y v4
  `GET/POST /admin/agent-roster`, en paralelo y con el id token del usuario.
- **BFF**: `GET /api/users?search=&page=&campaign=&filter=v3:agent`,
  `GET /api/users/{username}` y `POST /api/campaigns/{campaign}/agents`
  (`{fleet:"v3"|"v4", agents:[{username, enabled}]}`, 1–100).
- ANA Admin **no** crea, edita ni borra usuarios, no resetea contraseñas ni
  asigna roles.

### IAM del hosting (rol de cómputo de Amplify Hosting)

El BFF necesita **solo** `cognito-idp:ListUsers` sobre el pool:

```json
{
  "Effect": "Allow",
  "Action": "cognito-idp:ListUsers",
  "Resource": "arn:aws:cognito-idp:us-east-2:<account-id>:userpool/us-east-2_UepfOyKpd"
}
```

Sin esa política `/api/users` responde 503 ("No se pudo leer el directorio de usuarios").

## Sección Contactos (`/contactos`, `/contactos/historial`)

Requiere `isAdmin` o **ambos** permisos `ana:contacts:list:upload` y
`ana:contacts:list:distribute` (líderes y **supervisores**: v4 los da a todo rol
cuyo nombre contiene "supervisor", sin `ana:admin:agents:manage`). Para leer los
destinatarios habilitados el BFF usa los rosters de `/admin/*` de cada flota, que
aceptan `ana:admin:agents:manage` **o** carga + reparto para leer (las
escrituras siguen exigiendo `ana:admin:agents:manage`).

### Flujo

1. **Destino**: campaña, flota (`v3` CLI, **preseleccionada** / `v4` desktop) y modo
   ("Repartir entre agentes habilitados" o "Asignar a un agente"). Sin
   habilitados en esa flota no se puede cargar archivo. El toggle
   **"Incluir supervisores"** (apagado por defecto) suma a los supervisores
   habilitados de la campaña (`kind:"supervisor"` en la lista derivada) al
   reparto y al selector, etiquetados "Supervisor".
2. **Archivo**: se lee y valida **en el navegador** (`src/lib/contacts/`, el
   mismo código que usa el BFF); nada sale del navegador hasta confirmar. v4
   pide además el código de país (default `52`).
3. **Sin mensaje**: quien carga ya no escribe mensaje ni plantilla. En v3 cada
   agente escribe el suyo en **Mi asignación** (`/mi-asignacion`); en v4, en
   "Mi asignación" del desktop (la plantilla por defecto `{mensaje}` aparece
   vacía si el CSV no trae columna `mensaje`).
4. **Vista previa**: fila válida *i* → destinatario `i mod n` de los habilitados
   ordenados por username (código de punto); en "Asignar", todas al elegido.
   Muestra conteo y primeras 5 filas (teléfono y nombre) por destinatario.
5. **Confirmar** (`ConfirmDialog`): el BFF vuelve a parsear, relee el roster y
   compara agentes, conteos y hash SHA-256 del plan; si difiere responde 409
   ("El roster cambió; revisa la nueva vista previa").
   - **v3**: un CSV por agente a `POST /admin/campaigns/{c}/contacts` con un
     `uploadId` (`{ts}-{8 hex}`); un reintento con el mismo `uploadId` ante error
     de red. Los archivos quedan en los **pendientes del agente**
     (`assignments/agents/`) + `historic/`; el agente los publica al CLI desde
     Mi asignación.
   - **v4**: `POST /uploads/presign` con `distribute:true` y `assignments`
     (peso 1 por agente en el orden del plan, máx. 1500 caracteres) y `PUT` a la
     URL firmada con **solo las filas válidas**; la página consulta el historial
     v4 por `srcKey` hasta 60 s ("Procesando").
6. **Historial**: `/contactos/historial` por campaña y flota.

### Límites y formato de CSV

| | v3 | v4 |
|---|---|---|
| Tamaño máximo | 4 MB | 10 MB |
| Filas máximas | 20 000 | 50 000 |
| Columna de teléfono | `phone_number`, `contact_phone`, `contact_pho` o `phone` | las de v3, `telefono` o la que elijas |

- UTF-8 con encabezado; se quita el BOM, se recortan los campos y se saltan filas vacías.
- Fila inválida: menos columnas que el encabezado (v4 también más columnas),
  sin teléfono, teléfono con menos de 10 dígitos, teléfono repetido (solo
  dígitos) o, en v3, un campo con salto de línea. Solo las válidas se entregan.
- Ejemplos con datos falsos: `test/fixtures/contacts/*.example.csv`
  (`clean`, `dirty`, `espanol` para v4 y `newline`).

## Sección Mi asignación (`/mi-asignacion`)

Para usuarios con `ana:campaign:message:send` (rol "Agente <Campaña>", supervisores
y líderes). Reemplaza la vista de agentes del portal anterior, con SSO en lugar de
la palabra del día. Rutas BFF `/api/agent/*` → v3 `/agent/*` con el id token del
usuario (mismo App Client que el CLI; v3 decide el roster y la propiedad de cada
archivo).

1. **Campaña**: solo las campañas donde el usuario está habilitado en v3
   (`GET /api/agent/campaigns`); con una sola, queda preseleccionada.
2. **Asignaciones pendientes** (`assignments/agents/{c}/{agente}-contacts-*.csv`,
   lo que reparte Contactos para v3): se marca la más reciente; "Cargar
   seleccionados" lee cada archivo y los combina (unión de columnas en orden).
3. **Mensaje**: editor con "Insertar variable" (`{{columna}}`), `{columna}`,
   expresiones (`{{total_balance*0.8}}`) y `\n`, con la semántica del CLI
   (`src/lib/workspace/` ≡ `v3/cli-whatsapp/template-utils.js`); se precarga con la
   columna `message` si existe. Un marcador sin resolver ("Variable desconocida")
   bloquea publicar.
4. **Columnas de teléfono**: una o varias (máx. 5); por defecto la que usaría el
   CLI. Se genera un contacto por teléfono válido (≥ 10 dígitos, sin repetir).
5. **Contactos**: búsqueda, orden por columna, selección por fila o "Seleccionar
   todos los resultados" (sobre lo filtrado), teléfonos enmascarados y vista
   previa del mensaje por fila.
6. **Publicar** (`ConfirmDialog`): v3 relee los archivos (409 si cambiaron),
   renderiza el mensaje en el servidor, escribe `agents/{c}/{agente}-contacts-{ts}.csv`
   (lo consume el CLI) y quita de los pendientes las filas publicadas. El BFF
   genera el `publishId` y reintenta una vez con el mismo id.
7. **Historial de publicaciones**: fecha, contactos y archivos origen
   ("Reescrito" con pendientes restantes o "Consumido").

## Sección Configuración (`/configuracion`)

Solo rol **Developer** (`isDeveloper`; admin o líder no bastan). Se arma desde
el catálogo que devuelve v3 `GET /admin/cli-settings` (vía `GET/POST /api/cli-settings`);
cada cambio pide `ConfirmDialog` y aplica a todos los CLIs v3 en ≤ 5 min.
La sección **Desktop v4** de la misma página lee v4 `GET /admin/desktop-settings` (vía
`GET/PUT /api/v4/desktop-settings`, solo Developer): ritmo de envío (`sendMinGapSeconds`
60–600, `sendMaxPerWindow` 1–20, `sendWindowMinutes` 5–60) y `openChatInteraction`; cada
cambio pide `ConfirmDialog` con el valor anterior y el nuevo, envía solo esa llave con la
versión leída (409 → "La configuración cambió; recarga para ver el valor actual") y aplica
a todos los desktops v4 en ≤ 5 min.

## Sección Historial legacy (`/historial-legacy`)

Solo `isAdmin` o `isLeader` (líderes únicamente en sus campañas). Búsqueda de
solo lectura en el índice legado de v3 (`/api/campaigns/{c}/legacy-chats`,
`.../legacy-chats/{agent}/{phone}`, `.../legacy-agents`), sin caché. Los
mensajes se renderizan **solo como texto** (regla ESLint `react/no-danger`); la
multimedia usa URLs prefirmadas de 5 min y, si una vence, la conversación se
vuelve a pedir.

### Revisión y reasignación (`/contactos/historial/{uploadId}?campaign=`)

- Cada carga v3 del historial enlaza a su detalle: por agente del manifiesto,
  los contactos "por revisar" de esa carga (`GET /api/campaigns/{c}/review-items?uploadId=`)
  con estado, autor y fecha. `/contactos/historial/none?campaign=` muestra los
  que no tienen carga asociada (cargas por `curl` o anteriores).
- **Descartar** (el mensaje sí salió): `ConfirmDialog` destructivo →
  `POST .../review-items/resolve` `discard`.
- **Reasignar** (sin mensaje: el agente destino lo escribe en Mi asignación):
  elige un agente habilitado v3 → la página arma un CSV con las
  filas originales **sin** `ana_upload_id`, calcula la vista previa con el mismo
  plan que la carga (modo "Asignar a un agente") y, tras el `ConfirmDialog` que
  pide confirmar en WhatsApp que el mensaje no salió, crea la carga nueva con
  `source` y marca los contactos (`resolve` `reassign` con el `uploadId` nuevo,
  un reintento). Si el marcado falla, "Reintentar marcado" no crea otra carga.
- La columna `ana_upload_id` está reservada en v3: un CSV que la traiga se
  rechaza y una variable `{x}` que solo resolvería contra ella (p. ej.
  `{upload}`) se marca "Variable desconocida".

### Por revisar v4 (`/contactos/historial/{srcKey}?campaign=&fleet=v4`)

- Cada carga v4 del historial enlaza a su detalle: los envíos interrumpidos
  (`review`) y ya resueltos (`discarded`) de esa carga, por agente, con nombre,
  crédito, teléfono enmascarado y momento de la interrupción
  (`GET /api/v4/campaigns/{c}/review?srcKey=` → v4 `GET /jobs/review`).
  `/contactos/historial/all?campaign=&fleet=v4` lista toda la campaña,
  incluidos los envíos directos (marcados "Envío directo").
- **Descartar** y **Reenviar a…** (agente habilitado del roster v4), con
  `ConfirmDialog`; el reenvío advierte "Este contacto pudo haber recibido el
  mensaje. Reenviarlo puede duplicarlo." → `POST /api/v4/campaigns/{c}/review/resolve`
  (→ v4 `POST /jobs/review/resolve`, 1–100 contactos, resultado por contacto).

## Actualización en vivo (add-realtime-admin-web)

Tras el login, cada pestaña abre **una** conexión WebSocket directa al canal
realtime de v4 (`client=admin`, ID token de Amplify como subprotocolo `ana.v1`;
el BFF no interviene). El encabezado muestra **En vivo** o **Sin actualizaciones
en vivo**. Los avisos no traen datos: cada sección vuelve a leer por el BFF.

| Sección | Eventos que la recargan |
|---|---|
| Historial de cargas | `uploads.changed`, `review.changed` (de su campaña) |
| Detalle de carga v3 | `uploads.changed`, `review.changed` |
| Por revisar v4 | `review.changed` |
| Contactos (asistente) | `uploads.changed`, `review.changed`, `roster.changed` (relee los destinatarios) |
| Agentes | `roster.changed` |
| Mi asignación | `assignment.pending` (pendientes), `publications.changed` (historial) |
| Configuración (CLI y desktop) | `settings.changed` |

- Recarga en ≤ 1 s, agrupando los eventos de ese segundo; los de otra campaña se
  ignoran. También recarga al reconectar y tras una actualización forzada.
- **Trabajo sin guardar** (archivos cargados o filas seleccionadas, un diálogo o
  una confirmación abiertos, un valor editado, una carga en curso en el
  asistente): no se recarga; aparece "Hay cambios nuevos · Actualizar".
- Sin canal (sin URL, `NEXT_PUBLIC_REALTIME_ENABLED=false` o
  `realtimeEnabled=false` en v4): se recarga la sección al volver a la pestaña
  (máximo una vez por minuto), sin polling. Pestaña oculta > 10 min: se cierra la
  conexión y al volver se reconecta y recarga una vez.
- **Actualización forzada** (`session.refresh`): la consola relee `/api/me` (navegación
  y permisos) sin recargar la página, recarga la sección visible y reconecta.
- **Forzar actualización** (Agentes, solo `ana:admin:console:manage` o superadmin):
  un usuario, una campaña o todos → `POST /api/realtime/refresh` → v4
  `POST /admin/realtime/refresh`. Las sesiones afectadas (consola, desktop, CLI)
  releen su acceso y se reconectan en segundos.
