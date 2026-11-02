# Tasks

## 1. Cookie de sesión alineada con el login central

- [x] 1.1 Cambiar `cookieConfig` en `admin-web/src/lib/amplify.ts` para decidir `domain`/`secure` por `hostname` y `protocol` (apex `pernexium.com.mx` + https) y `expires: 30`; quitar el uso de `NEXT_PUBLIC_COOKIE_DOMAIN` (D4). Verificar con `test/client/amplify.test.ts` actualizado: apex https → `domain` y `secure`; localhost http → sin `domain` ni `secure`; `*.amplifyapp.com` https → sin `domain`, `secure`.
- [x] 1.2 Retirar `NEXT_PUBLIC_COOKIE_DOMAIN` de `.env.example`, `.env.test` y `README.md`. Verificar con `grep -r NEXT_PUBLIC_COOKIE_DOMAIN admin-web --exclude-dir=node_modules` sin resultados.

## 2. URLs del login central

- [x] 2.1 Crear `admin-web/src/lib/central-login.ts` con `LOGIN_URL` (`NEXT_PUBLIC_LOGIN_URL` ?? producción `https://login.pernexium.com.mx` / resto `http://localhost:3100`), `centralLoginUrl(redirect)` y `centralLogoutUrl(redirect)` con `encodeURIComponent` (D2). Verificar con `test/client/central-login.test.ts`: URL por entorno, override por variable y codificación del redirect.
- [x] 2.2 Documentar `NEXT_PUBLIC_LOGIN_URL` en `.env.example` y en la tabla de variables y la sección de desarrollo local de `README.md` (login central en `localhost:3100`). Verificar leyendo ambos archivos.

## 3. `/login` como redirector con tope anti-bucle

- [x] 3.1 Reescribir `LoginView` (`admin-web/src/components/system/LoginView.tsx`): con sesión → `router.replace(next)`; sin sesión → registrar la ida en `sessionStorage` y `window.location.replace(centralLoginUrl(origin + next))`; con 4+ idas en 30 s → aviso inline y botón "Reintentar" que limpia el conteo y repite (D1, D3). Sin campos de usuario ni contraseña. Verificar con `test/client/login.test.tsx` reescrito: con sesión redirige a `next`; `next` externo → `/`; sin sesión llama `location.replace` con `https://…/?redirect=<origen>%2Fagentes`; quinta ida en 30 s muestra "Reintentar" y no redirige; "Reintentar" vuelve a redirigir; no existen los campos "Usuario"/"Contraseña".
- [x] 3.2 Quitar de `admin-web/src/lib/auth-client.ts` `login`, `confirmLogin`, `mapStep`, `LoginStep`, `loginErrorMessage` y `pendingUsername` (D6). Verificar con `test/client/auth-client.test.ts` reducido a `currentIdToken`/`hasSession`/`logout` y `npm run typecheck` sin errores.

## 4. Cierre de sesión por el login central

- [x] 4.1 En `LogoutDialog` (`admin-web/src/components/system/LogoutButton.tsx`), tras `logout()` hacer `window.location.assign(centralLogoutUrl(window.location.origin))` en lugar de `router.replace('/login')`, conservando el evento `LOGOUT_EVENT` y el aviso de sesión compartida (D5). Verificar con una prueba en `test/client/shell.test.tsx` (o nueva) que confirma el orden: evento realtime, `logout`, `location.assign` con la URL de `/logout`.

## 5. Integración

- [x] 5.1 Correr en `admin-web`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run check:design` y `npm run build && npm run check:bundle`. Verificar que todo pase.
- [ ] 5.2 Prueba manual local con el login central en `localhost:3100`: abrir `http://localhost:3000/agentes` sin sesión → login central → vuelve a `/agentes`; cerrar sesión → `/logout` del central. Verificar el recorrido completo.

## Workflow follow-up

- Desplegar admin-web en Amplify Hosting y retirar `NEXT_PUBLIC_COOKIE_DOMAIN` de las variables de la app.
- Verificar en producción el recorrido ruta profunda → login central → vuelta, y el cierre de sesión.
- Agregar ANA Admin a `PERNEXIUM_APPS` en el repositorio del login central.
- Archivar el cambio cuando la verificación en producción esté hecha.
