# Design

## Context

ANA Admin ya cumple los requisitos de base del login central: mismo pool (`us-east-2_UepfOyKpd`) y App Client (`1r6niimhkl2fmias6kk85n4ou4`), Amplify v6 con `CookieStorage` (sin `ssr: true`), gate de rutas que conserva la ruta en `/login?next=`, cliente del BFF que ante 401 renueva y redirige a `/login?next=`, y BFF que valida el id token con `aws-jwt-verify` y allowlist de `aud`.

Lo que cambia es la página `/login` (hoy formulario con challenges de Cognito), el cierre de sesión y dos detalles de la cookie que hoy difieren del login central: expiración de 1 día (el central usa 30) y `domain` tomado de `NEXT_PUBLIC_COOKIE_DOMAIN` en producción (el central lo decide por host). ANA Admin está fuera del monorepo del login central, así que no hay `@shared/ui`: se replican las piezas del caso B de la guía de integración.

## Goals / Non-Goals

**Goals:**
- Un solo punto de entrada de credenciales: `/login` nunca muestra formulario.
- Misma cookie que el login central (nombre, alcance, duración), para que ninguna app reescriba la sesión con otros atributos.
- Conservar el enlace profundo de ida y vuelta.

**Non-Goals:**
- Formulario de respaldo si el login central no responde (decisión explícita del usuario).
- Comprobar la disponibilidad del login central antes de redirigir.
- Cambios en el BFF, en `v4/desktop` o en el CLI de v3.

## Decisions

### D1. `/login` como redirector, `next` sigue siendo relativo
`/login` conserva el contrato actual `?next=<ruta interna>` saneado con `safeNext`, de modo que el gate (`ConsoleGate`) y el cliente del BFF (`api-client`) no cambian. Solo `/login` construye la URL absoluta `window.location.origin + next` y la pasa como `redirect` al login central con `window.location.replace` (no deja `/login` en el historial).
- *Alternativa*: que el gate y el cliente redirijan directo al login central. Se descarta: duplica la lógica de redirección en tres lugares y pierde el punto único donde aplicar el tope anti-bucle.

### D2. Módulo `src/lib/central-login.ts`
Funciones puras `centralLoginUrl(redirect)`, `centralLogoutUrl(redirect)` y la constante `LOGIN_URL` (`NEXT_PUBLIC_LOGIN_URL` ?? por `NODE_ENV`). Se pasa `NODE_ENV`/env como parámetros con valores por defecto, igual que `cookieConfig`, para probarlas sin `stubEnv`. No se valida el `redirect` aquí: el login central ya aplica su allowlist (`*.pernexium.com.mx` por https, localhost solo en desarrollo) y el origen siempre es el propio.

### D3. Tope anti-bucle en `sessionStorage`
Clave `ana-admin:login-hops` con la lista de marcas de tiempo de las idas al login central; se descartan las de más de 30 s y, si quedan 4 o más, no se redirige y se muestra el aviso con "Reintentar" (que borra la clave). `sessionStorage` es por pestaña, sobrevive a la navegación de ida y vuelta y no afecta a otras pestañas. Acceso envuelto en `try/catch`: sin storage, se redirige sin tope (el central igual regresa).
- *Alternativa*: parámetro en la URL de vuelta. Se descarta: el login central podría no preservarlo y ensucia el enlace profundo.

### D4. Cookie decidida por host, 30 días
`cookieConfig(location)` recibe `hostname` y `protocol`: `domain: '.pernexium.com.mx'` solo si el host es el apex o termina en `.pernexium.com.mx` y el protocolo es https; `secure` = https; `expires: 30`. Se elimina `NEXT_PUBLIC_COOKIE_DOMAIN`. El apex queda fijo en el código porque es la identidad del SSO de Pernexium, no configuración por entorno (lo mismo hace el login central).
- *Alternativa*: mantener la variable. Se descarta: si falta en producción, la app escribe cookies host-only con el mismo nombre que las del apex, el caso que produce "Refresh Token has expired" tras un login correcto.

### D5. Cierre de sesión
`LogoutDialog` mantiene el aviso y el cierre del canal realtime, llama `signOut()` (borra las cookies del apex) y luego `window.location.assign(centralLogoutUrl(window.location.origin))`. El `/logout` del central también limpia su estado y deja al usuario en el formulario con `redirect` hacia ANA Admin.

### D6. Limpieza de `auth-client`
Se eliminan `login`, `confirmLogin`, `mapStep`, `LoginStep`, `loginErrorMessage` y el estado `pendingUsername`. Se quedan `currentIdToken`, `hasSession` y `logout`. `LoginView` se reduce a `LoginShell` + estado "redirigiendo" + aviso del tope.

## Risks / Trade-offs

- [El login central cae → nadie entra a ANA Admin] → Aceptado por decisión del usuario; el aviso del tope evita un rebote infinito y "Reintentar" permite volver a intentar sin recargar a mano.
- [Previews `*.amplifyapp.com` sin SSO] → Las previews terminan en el aviso del tope; probar en `ana-admin.pernexium.com.mx`.
- [Desarrollo local depende del login central en `localhost:3100`] → Documentado en README; `NEXT_PUBLIC_LOGIN_URL` permite apuntar a otro puerto.
- [Cookies host-only antiguas de 1 día en `ana-admin.pernexium.com.mx`] → Hoy en producción ya se escriben con `domain` del apex (la variable está puesta), así que no hay duplicados que purgar; si apareciera "Refresh Token has expired", basta borrar cookies del host. No se agrega purga automática.

## Migration Plan

1. Merge y despliegue de admin-web en Amplify Hosting (rama de producción).
2. En la app de Amplify: retirar `NEXT_PUBLIC_COOKIE_DOMAIN` (queda inerte si se deja); no hace falta `NEXT_PUBLIC_LOGIN_URL` en producción.
3. Verificar en producción: abrir `https://ana-admin.pernexium.com.mx/agentes` sin sesión → login central → vuelve a `/agentes`; cerrar sesión → `/logout` del central.
4. Rollback: revertir el commit y redesplegar; la cookie del apex sigue siendo válida para la versión anterior.
5. Fuera de este repo: agregar ANA Admin a `PERNEXIUM_APPS` del login central.
