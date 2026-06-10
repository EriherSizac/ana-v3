# SSO entre apps vía cookie de dominio compartido (Cognito + Amplify v6)

Guía de onboarding para conectar una app Next.js (App Router) al mismo inicio de
sesión que las demás apps del mismo apex, compartiendo los tokens de Cognito.

## Por qué

Amplify v6 guarda los tokens de Cognito en `localStorage` por defecto.
`localStorage` está **aislado por origen**: `imery.pernexium.com.mx` y
`bimery.pernexium.com.mx` no ven el storage del otro, así que no hay SSO. La
solución es cambiar el storage del token provider a **`CookieStorage` con
`domain` = el apex común** (con punto adelante, `.pernexium.com.mx`). Una cookie
de dominio apex viaja a todos los
subdominios → sesión compartida, sin Identity Pool ni federación.

No metemos tokens en URL ni query params. No usamos Identity Pool.

## La regla de oro

`NEXT_PUBLIC_COOKIE_DOMAIN` debe ser el **apex común** de los subdominios que
comparten sesión, con punto adelante:

- `imery.pernexium.com.mx` + `bimery.pernexium.com.mx` → `NEXT_PUBLIC_COOKIE_DOMAIN=.pernexium.com.mx`
- En local: `NEXT_PUBLIC_COOKIE_DOMAIN=localhost`

Y `NEXT_PUBLIC_COGNITO_USER_POOL_ID` debe ser **idéntico** en todas las apps que
comparten pool. La config de `CookieStorage` (path, sameSite, expires) debe ser
**igual** en todas para que lean/escriban la misma cookie.

## Checklist de env vars (por proyecto)

Todas son `NEXT_PUBLIC_*` (se evalúan en build, no hardcodear en código):

- [ ] `NEXT_PUBLIC_COGNITO_USER_POOL_ID` — mismo pool en todas las apps que comparten sesión.
- [ ] `NEXT_PUBLIC_COGNITO_CLIENT_ID` — App Client de Cognito de esta app.
- [ ] `NEXT_PUBLIC_COOKIE_DOMAIN` — apex común con punto (`.pernexium.com.mx`); `localhost` en dev.

## Checklist de implementación (por proyecto)

- [ ] `npm install aws-amplify@^6`.
- [ ] `lib/amplify.ts` + `AmplifyProvider` montado en el root layout.
- [ ] Flujo de auth sobre `aws-amplify/auth` (no localStorage manual).
- [ ] **La página de login valida la sesión/cookies al montar** y redirige a `/`
      si ya hay sesión (paso 6). Sin esto, un usuario ya autenticado por SSO se
      queda viendo el formulario.
- [ ] El gate de rutas protegidas resuelve la sesión con `fetchAuthSession()`.

## Cómo replicarlo en otra app

1. `npm install aws-amplify@^6`
2. Crea dos archivos (genéricos, sin valores hardcodeados):

   **`src/lib/amplify.ts`** — `configureAmplify()`: llama `Amplify.configure(...)`
   y registra `CookieStorage` vía `cognitoUserPoolsTokenProvider.setKeyValueStorage`.

   ```ts
   'use client';

   import { Amplify } from 'aws-amplify';
   import { CookieStorage } from 'aws-amplify/utils';
   import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';

   const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
   const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
   // Apex común con punto en prod (".pernexium.com.mx"); "localhost" en dev.
   const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;

   const isProd = process.env.NODE_ENV === 'production';

   let configured = false;

   /** Idempotente. Seguro llamarla desde el provider y lazy desde helpers de auth. */
   export const configureAmplify = (): void => {
     if (configured) return;
     if (typeof window === 'undefined') return;
     if (!userPoolId || !userPoolClientId) {
       console.error(
         '[amplify] NEXT_PUBLIC_COGNITO_USER_POOL_ID / NEXT_PUBLIC_COGNITO_CLIENT_ID missing',
       );
       return;
     }

     Amplify.configure({
       Auth: {
         Cognito: {
           userPoolId,
           userPoolClientId,
         },
       },
     });

     // Un domain con punto solo funciona sobre https; en localhost hay que omitir
     // el domain y secure o la cookie se ignora en silencio.
     const useApexDomain = isProd && !!cookieDomain && cookieDomain !== 'localhost';

     cognitoUserPoolsTokenProvider.setKeyValueStorage(
       new CookieStorage({
         ...(useApexDomain ? { domain: cookieDomain } : {}),
         path: '/',
         expires: 1, // días
         // 'lax' funciona entre subdominios same-site; 'strict' puede romper
         // navegación cross-subdominio.
         sameSite: 'lax',
         secure: isProd,
       }),
     );

     configured = true;
   };
   ```

   **`src/components/system/AmplifyProvider.tsx`** — Client Component que ejecuta
   `configureAmplify()` una sola vez en cliente.

   ```tsx
   'use client';

   import { useRef } from 'react';
   import { configureAmplify } from '@/lib/amplify';

   export function AmplifyProvider() {
     // El cuerpo de useRef corre en render (cliente), antes de effects/llamadas
     // de auth de los hijos, y solo una vez por montaje.
     const done = useRef(false);
     if (!done.current) {
       configureAmplify();
       done.current = true;
     }
     return null;
   }
   ```

3. Monta `<AmplifyProvider />` alto en el **root layout** (`app/layout.tsx`),
   antes de cualquier llamada de auth. Debe correr en cliente (`"use client"`),
   nunca en server components.
4. Usa `aws-amplify/auth` (`signIn`, `confirmSignIn`, `fetchAuthSession`,
   `getCurrentUser`, `signOut`) para el flujo de auth. No leas/escribas tokens a
   mano.
5. Define las 3 env vars (ver checklist) en el `.env` del proyecto.
6. En la **página de login**, chequea la sesión **al montar** y redirige si ya
   existe (auto sign-in). Con la sesión en cookie compartida, un usuario que ya
   inició sesión en otra app del apex llega aquí ya autenticado; sin este check
   se quedaría viendo el formulario.

   ```tsx
   // app/login/page.tsx (Client Component)
   useEffect(() => {
     let cancelled = false;
     // hasSession() = (await fetchAuthSession()).tokens?.idToken != null
     void hasSession().then((ok) => {
       if (ok && !cancelled) router.replace('/');
     });
     return () => {
       cancelled = true;
     };
   }, [router]);
   ```

   El gate de las rutas protegidas también debe resolver la sesión con
   `fetchAuthSession()` al montar (no asumir localStorage).

## Gotcha de localhost

Con un `domain` con punto (`.pernexium.com.mx`) **y** `secure: true`, las cookies **no
se setean** en `http://localhost`. En dev:

- `NEXT_PUBLIC_COOKIE_DOMAIN=localhost` (o sin domain), y
- `secure: false`.

En `lib/amplify.ts` esto se resuelve condicionando por `NODE_ENV`: solo se aplica
el `domain` apex y `secure` en producción; en dev se omite el `domain` y
`secure` queda en `false`.

## Si una app usa un App Client distinto

El SSO por cookie funciona aunque cada app tenga su propio `clientId`, **siempre
que compartan el mismo User Pool** (los tokens los emite el pool). Pero el `aud`
(claim `client_id` / `aud`) del JWT será el del client que hizo login.

Si la app receptora valida el JWT contra **un solo** `client_id`, rechazará
tokens emitidos por el client de otra app. En ese caso, la app receptora debe
validar contra una **allowlist** de `client_id`/`aud` (varios valores
permitidos), no uno solo. Si todas las apps comparten el mismo App Client, no
aplica.

## Design system

Las reglas visuales (login con fondo azul, login por username no email,
searchable dropdowns, etc.) viven en su propio doc:
[`design-system.md`](./design-system.md). Lo único relevante aquí: el campo de
login es un **username**, no un correo — no forzar formato email en ese input
(detalle en el design system).

## Notas

- Cambios de Cognito en AWS (callback URLs, allowed origins, flows del App
  Client) se coordinan aparte; esta guía solo cubre el storage del cliente.
- `sameSite: 'lax'` funciona entre subdominios same-site; `'strict'` puede romper
  navegación cross-subdominio.

## ⚠️ Resolver permisos del usuario (forma de `GET /users/{username}`)

Gotcha que ya costó caro: al gatear acceso por permisos, **NO** se llama
`/roles/{id}/permissions` por cada rol. `GET /users/{username}` (Roles API) ya
trae los roles **con los permisos inline**, y los campos NO se llaman `id`/`name`
sino **`role_id`/`role_name`**, y cada permiso es **`permission_name`** (no
`name`). Forma real:

```json
{
  "username": "erick.silva",
  "roles": [
    {
      "role_id": "c288ee3e-…",
      "role_name": "Developer",
      "campaign_name": "*",
      "permissions": [
        { "permission_id": "00ccfb2e-…", "permission_name": "imery:chat:group:create" }
      ]
    }
  ]
}
```

Para resolver los permisos efectivos: **una sola** llamada a `/users/{username}`,
luego unir `roles[].permissions[].permission_name`. NO mapear `.id`/`.name` (son
`undefined`) ni hacer N llamadas a `/roles/{id}/permissions`.

```ts
const data = await getJson(`/users/${username}`);            // X-Api-Key
const permissions = new Set(
  (data.roles ?? []).flatMap((r) =>
    (r.permissions ?? []).map((p) => p.permission_name),
  ),
);
const allowed = permissions.has("access:admin:console:manage");
```

Síntoma cuando se hace mal: `/me` devuelve `permissions: []` y el gate niega el
acceso aunque el permiso SÍ esté asignado al rol (porque se leyó `r.id`
undefined → `/roles/undefined/permissions` → vacío). Ver `accesos/api`.
