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
  `ana:admin:agents:manage` / `ana:contacts:list:upload`.
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
`ana:contacts:list:distribute`. Para leer los agentes habilitados el BFF usa los
rosters de `/admin/*` de cada flota (que exigen `ana:admin:agents:manage`; los
líderes y admins lo tienen).

### Flujo

1. **Destino**: campaña, flota (`v3` CLI / `v4` desktop) y modo
   ("Repartir entre agentes habilitados" o "Asignar a un agente"). Sin
   habilitados en esa flota no se puede cargar archivo.
2. **Archivo**: se lee y valida **en el navegador** (`src/lib/contacts/`, el
   mismo código que usa el BFF); nada sale del navegador hasta confirmar.
3. **Mensaje**: v3 exige un mensaje plantilla si el CSV no trae columna
   `message` (variables `{columna}`; los saltos de línea viajan como `\n`
   literal). v4 pide plantilla (default `{mensaje}`) y código de país (default `52`).
4. **Vista previa**: fila válida *i* → agente `i mod n` de los habilitados
   ordenados por username (código de punto); en "Asignar", todas al agente
   elegido. Muestra conteo y primeras 5 filas por agente.
5. **Confirmar** (`ConfirmDialog`): el BFF vuelve a parsear, relee el roster y
   compara agentes, conteos y hash SHA-256 del plan; si difiere responde 409
   ("El roster cambió; revisa la nueva vista previa").
   - **v3**: un CSV por agente a `POST /admin/campaigns/{c}/contacts` con un
     `uploadId` (`{ts}-{8 hex}`); un reintento con el mismo `uploadId` ante error
     de red. Los archivos quedan en `agents/` (los consume el CLI) + `historic/`.
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

## Sección Configuración (`/configuracion`)

Solo rol **Developer** (`isDeveloper`; admin o líder no bastan). Se arma desde
el catálogo que devuelve v3 `GET /admin/cli-settings` (vía `GET/POST /api/cli-settings`);
cada cambio pide `ConfirmDialog` y aplica a todos los CLIs v3 en ≤ 5 min.

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
- **Reasignar**: elige un agente habilitado v3 → la página arma un CSV con las
  filas originales **sin** `ana_upload_id`, calcula la vista previa con el mismo
  plan que la carga (modo "Asignar a un agente") y, tras el `ConfirmDialog` que
  pide confirmar en WhatsApp que el mensaje no salió, crea la carga nueva con
  `source` y marca los contactos (`resolve` `reassign` con el `uploadId` nuevo,
  un reintento). Si el marcado falla, "Reintentar marcado" no crea otra carga.
- La columna `ana_upload_id` está reservada en v3: un CSV que la traiga se
  rechaza y una variable `{x}` que solo resolvería contra ella (p. ej.
  `{upload}`) se marca "Variable desconocida".
