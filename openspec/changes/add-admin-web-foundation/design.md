# Design

## Context

- Ver proposal.md (Why). El repo no tiene app web de administración ni `.github/`; `v3/app` es una app Next.js 14 local de uso secundario ligada al flujo viejo, y `v4/desktop` es Electron.
- v4 ya resuelve el acceso ANA en `v4/backend/src/lib/access.ts` (`resolveUserAccess`): roles de la API de Roles (`GET /users/{username}`, permisos inline `permission_name`), almacén local rol→permisos en DynamoDB (`roleperms`, admite denies `-perm`), defaults (`chats view/reply`), líder por regex `/lider/` sobre `role_name` (añade upload/distribute/team), admin por `ana:admin:console:manage`, superadmin `erick.silva`, caché L2 en DynamoDB. `GET /me` devuelve `{access}` con `username, roleIds, roleNames, campaigns, permissions, isAdmin, isLeader`. El authorizer JWT de v4 valida `aud` contra un único client id (`1r6niimhkl2fmias6kk85n4ou4` por defecto) y el desktop usa el id token.
- v4 prod: `https://njpfef2qna.execute-api.us-east-2.amazonaws.com` (`v4/CONTEXT.md`). `GET /agents/campaigns` devuelve catálogo PostgreSQL ∩ campañas del usuario.
- Reglas obligatorias: `docs/design-system.md` §11 y `docs/sso-cognito-cookie-storage.md`.

## Goals / Non-Goals

**Goals:**
- Una base reutilizable (auth, acceso, shell, componentes, BFF, CI) para que las changes de agentes, contactos y configuración del CLI solo agreguen páginas y rutas.
- Cero secretos en el navegador y autorización siempre en servidor.

**Non-Goals:**
- Paquete compartido de design system entre productos (se implementa local en `admin-web/src/components/ui/`; extraerlo es otra iniciativa).
- Renderizado en servidor de datos protegidos (las páginas son Client Components que llaman al BFF).
- Pruebas E2E con navegador real (se dejan para cuando haya entorno de staging con usuarios de prueba).

## Decisions

### D1. App nueva en `admin-web/` (Next.js App Router + TS + Tailwind)
Raíz del repo, independiente de `v3/` y `v4/` porque opera contra ambos backends. Estructura: `src/app/(auth)/login`, `src/app/(console)/...` con layout del shell, `src/app/api/**/route.ts` (BFF), `src/components/ui`, `src/components/system`, `src/lib/{amplify,auth-client,api-client}.ts`, `src/server/{auth,access,errors,backends}/`.
- Alternativa: extender `v3/app` (Next 14, acoplada al flujo de credenciales y a S3 directo) — descartada.
- Alternativa: pantallas dentro de `v4/desktop` — descartada: los supervisores de v3 no usan el desktop y el SSO por cookie es solo web.

### D2. SSO con Amplify v6 + `CookieStorage` en el apex
Se replica literal `lib/amplify.ts` y `AmplifyProvider` del doc SSO. Para que el SSO funcione de verdad, ANA Admin MUST usar el **mismo App Client** que las otras apps web Pernexium: Amplify nombra las cookies `CognitoIdentityServiceProvider.<clientId>.<username>.*`, así que un client distinto no ve la sesión de las demás aunque el pool sea el mismo (el doc SSO solo cubre la parte de validación por allowlist). Si se decide un client propio, la app funciona igual pero sin SSO automático.
- Alternativa: Hosted UI/OAuth con redirect — descartada: las demás apps usan login propio por SRP y no hay Hosted UI configurada.

### D3. BFF en route handlers de Next.js
El navegador solo habla con `/api/*` de la propia app. El BFF:
1. Verifica el id token con `aws-jwt-verify` (`CognitoJwtVerifier`, `tokenUse: "id"`, `clientId: COGNITO_ALLOWED_CLIENT_IDS.split(",")`), JWKS cacheado.
2. Resuelve acceso (D5) y aplica permiso + alcance de campaña por ruta con un helper `withAccess(handler, { permission, campaignFrom })`.
3. Llama a v3/v4 con el mismo id token (fetch server-side, timeout 5–10 s) y traduce errores al formato uniforme.
- Alternativa: el navegador llama directo a v3/v4 — descartada: `ListUsers` y la API de Roles necesitan secretos de servidor, v3 restringe CORS y se duplicaría la lógica de alcance en el cliente.
- Alternativa: Lambda BFF aparte — descartada: más infraestructura sin beneficio para el volumen esperado (decenas de supervisores).

### D4. Token del navegador al BFF por header, no por cookie
El cliente obtiene el id token con `fetchAuthSession()` y lo envía en `Authorization`. El BFF no usa la cookie como credencial, así que no hay superficie CSRF (un sitio ajeno no puede fijar el header). Ante 401 el cliente hace `fetchAuthSession({ forceRefresh: true })` y reintenta una vez.
- Alternativa: leer la cookie de Amplify en el servidor con `@aws-amplify/adapter-nextjs` — descartada por ahora: obliga a tokens anti-CSRF y no aporta, porque las páginas no se renderizan con datos en servidor.

### D5. Acceso efectivo = v4 `GET /me` (fuente de verdad)
El BFF llama a v4 `GET /me` con el token del usuario; caché en memoria del proceso por `username` hasta 60 s (nunca se cachean errores). `isDeveloper` se deriva en el BFF de `roleNames` con la misma normalización que `isLeaderRole` de v4 (NFD, sin diacríticos, minúsculas, `/developer/`).
- Alternativa: reimplementar `resolveUserAccess` en el BFF — descartada: duplica reglas (denies, líder, superadmin) y obliga a credenciales para la tabla `roleperms` de v4 en otra cuenta/región.
- Alternativa: solo API de Roles (permisos inline) — descartada: ignora el almacén local `roleperms` y las reglas de líder, y daría resultados distintos a v4.
- Consecuencia: el App Client de ANA Admin debe estar en `audience` del authorizer de v4 (si es el mismo client que ya usa v4, no hay cambio; si no, se agrega por parámetro de despliegue).

### D6. Gate de entrada y permisos
Entrada: `isAdmin || isDeveloper || permissions ∩ {ana:admin:agents:manage, ana:contacts:list:upload} ≠ ∅`. Se usan los arrays de `/me` directamente, no `can()` de v4, para no depender del flag `PERMISSIONS_ENFORCED` (que en v4 está en `false` y abriría todo). El permiso nuevo `ana:admin:agents:manage` se agrega al catálogo de v4 en `add-agent-roster-management`; hasta entonces solo llega por permisos inline de la API de Roles (v4 ya los consume si empiezan con `ana:`) o vía `isAdmin`.
- Alternativa: reutilizar `ana:admin:console:manage` para todo — descartada: es el permiso de superadministración (otorga todo) y los líderes no deben tenerlo.

### D7. Sistema de diseño verificado en CI
- `tailwind.config.ts` **reemplaza** `theme.colors` (no `extend`) con los tokens; así `bg-blue-500` no genera CSS. Se añaden solo `red.50/700` y `green.50/700` porque el propio design system (§7.5) los usa en mensajes inline.
- ESLint: `no-alert`, `no-restricted-globals` (`confirm`, `prompt`), `no-restricted-syntax` para JSX `<select>` y un script `scripts/check-design-tokens.mjs` que falla ante `#[0-9a-f]{3,8}` en `.tsx` y clases de paleta default.
- Fuentes: Jost por Google Fonts en `globals.css`, Inter con `next/font/google`.

### D8. Hosting y dominio
Propuesta: AWS Amplify Hosting (SSR de Next.js) en la cuenta de Pernexium, dominio `ana-admin.pernexium.com.mx`, con rol de cómputo IAM para `cognito-idp:ListUsers` (lo usa `add-agent-roster-management`); variables de servidor en la configuración del hosting. Los specs no dependen del proveedor: solo exigen HTTPS en un subdominio de `.pernexium.com.mx`.
- Alternativas: Vercel (credenciales AWS de larga vida fuera de la cuenta), OpenNext/SST sobre Lambda (más piezas a mantener).

### D9. Pruebas y CI
Vitest + Testing Library (jsdom) para componentes y helpers; los route handlers se prueban como funciones con `Request` sintéticos, JWKS de prueba y `fetch` mockeado. Workflow `.github/workflows/admin-web.yml` con `paths: admin-web/**`: `npm ci`, `lint`, `check:design`, `typecheck`, `test`, `build`.

### Variables de entorno

| Variable | Ámbito | Uso |
|---|---|---|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | público | `us-east-2_UepfOyKpd` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | público | App Client compartido (D2) |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | público | `.pernexium.com.mx` / `localhost` |
| `COGNITO_ALLOWED_CLIENT_IDS` | servidor | allowlist de `aud` |
| `ANA_V4_API_BASE` | servidor | backend v4 |
| `ANA_V3_API_BASE` | servidor | backend v3 (lo usan changes dependientes) |
| `ROLES_API_BASE`, `ROLES_API_KEY` | servidor | API de Roles (changes dependientes) |

## Risks / Trade-offs

- [Dependencia de v4 para autorizar] → fail-closed con 503 y mensaje claro; caché de 60 s amortigua picos; v4 ya está desplegado en prod.
- [App Client distinto rompe el SSO en silencio] → D2 fija usar el client compartido; prueba manual de SSO en el checklist de despliegue.
- [Cerrar sesión cierra todas las apps Pernexium del navegador] → advertencia en el `ConfirmDialog` de cierre de sesión.
- [Permisos cacheados hasta 60 s] → un permiso revocado puede seguir vigente hasta un minuto en el BFF; aceptable para una consola interna (v4 ya cachea ~15 min en su L2).
- [Superadmin fijo `erick.silva` en v4] → se hereda tal cual; no se replica en el BFF.

## Migration Plan

1. Crear el App Client/allowlist necesarios (o confirmar el client compartido) y, si aplica, desplegar v4 con el client id agregado a `audience`.
2. Desplegar `admin-web` en el hosting con las variables de entorno; registrar el dominio.
3. Probar SSO desde otra app Pernexium y el gate de entrada con un agente, un líder y un admin.
- Rollback: retirar el dominio/hosting; ningún backend cambia de comportamiento en esta change.

## Open Questions

- ¿Cuál es el client id del App Client web compartido por las apps Pernexium con SSO (y coincide con el `1r6niimhkl2fmias6kk85n4ou4` de v4)? Es un valor de despliegue; no cambia specs ni tareas.
- Confirmar Amplify Hosting como proveedor y quién administra el DNS de `pernexium.com.mx`.
