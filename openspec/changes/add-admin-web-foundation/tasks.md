# Tasks

## 1. Scaffold de la app

- [ ] 1.1 Crear `admin-web/` con Next.js (App Router, TypeScript estricto, Tailwind, ESLint) y `src/` como raíz; verificar que `npm run dev` sirve `/` y `npm run build` termina sin errores
- [ ] 1.2 Agregar dependencias `aws-amplify@^6`, `aws-jwt-verify`, `lucide-react` y de desarrollo `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`; verificar `npm ci` limpio y que `npm test` corre (cero pruebas) sin error
- [ ] 1.3 Crear `admin-web/.env.example` con las variables de la tabla de design.md (sin valores secretos) y un validador de entorno en `src/server/env.ts` que falle al arrancar si falta una variable de servidor; verificar con una prueba unitaria del validador

## 2. Sistema de diseño

- [ ] 2.1 Definir en `tailwind.config.ts` los tokens de `docs/design-system.md` §2 reemplazando `theme.colors` (más `red/green 50/700`), `shadow-card`, tamaño `2xs`; y en `src/app/globals.css` `pernexium-card`, `pernexium-gradient`, keyframes §6 y fuentes Jost/Inter; verificar que `bg-blue-500` no produce CSS en el build
- [ ] 2.2 Implementar en `src/components/ui/` `Button` (variants/sizes), `Input`, `Card*`, `Badge`, `Skeleton`, `Dialog`, `ConfirmDialog`, `Toast`, `FilterPill`, `SearchableSelect` y `SearchableMultiselect`; verificar con pruebas de Testing Library: Escape/backdrop/cancelar cierran `ConfirmDialog`, botones deshabilitados con `loading`, el selector filtra por texto y no acepta valores fuera de la lista
- [ ] 2.3 Configurar ESLint (`no-alert`, `no-restricted-globals` para `confirm`/`prompt`, `no-restricted-syntax` para JSX `<select>`) y `scripts/check-design-tokens.mjs` (hex en `.tsx` y clases de paleta default); verificar con archivos fixture que cada regla falla y que el código real pasa (`npm run lint && npm run check:design`)
- [ ] 2.4 Documentar en `admin-web/README.md` (sección "Sistema de diseño") los componentes disponibles y las reglas verificadas en CI; verificar que los comandos citados existen en `package.json`

## 3. SSO Cognito en el cliente

- [ ] 3.1 Crear `src/lib/amplify.ts` y `src/components/system/AmplifyProvider.tsx` según `docs/sso-cognito-cookie-storage.md` (cookie apex solo en producción) y montarlo en el root layout; verificar con prueba unitaria que en `production` se usa `domain` del entorno y `secure`, y en desarrollo no
- [ ] 3.2 Implementar `src/lib/auth-client.ts` (`login`, `confirmLogin` con mapeo de pasos TOTP/SMS/selección MFA/alta TOTP/nueva contraseña, `logout`, `currentIdToken`, `hasSession`) reutilizando el patrón de `v4/desktop/src/lib/auth.ts`; verificar con pruebas que mockean `aws-amplify/auth` cada paso
- [ ] 3.3 Construir `/login` (fondo azul, campo Usuario sin validación de email, contraseña con mostrar/ocultar, pasos de challenge, mensajes inline) con chequeo de sesión al montar y sanitización de `next` (solo rutas relativas internas); verificar con pruebas de componente: redirección con sesión, `next` externo ignorado, error de credenciales inline
- [ ] 3.4 Implementar el gate de `(console)/layout.tsx` (Skeleton mientras resuelve, redirect a `/login?next=`) y el cliente `src/lib/api-client.ts` (header `Authorization`, un reintento con `forceRefresh` ante 401, redirect al fallar); verificar con pruebas de ambos flujos

## 4. BFF: autenticación y acceso

- [ ] 4.1 Implementar `src/server/auth/verifyIdToken.ts` con `aws-jwt-verify` (`tokenUse: id`, allowlist `COGNITO_ALLOWED_CLIENT_IDS`) y `src/server/errors.ts` (formato `{error:{code,message}}`); verificar con pruebas usando JWKS de prueba: token válido, `aud` fuera de allowlist, access token, expirado, sin header → 401
- [ ] 4.2 Implementar `src/server/access/resolveAccess.ts` (v4 `GET /me` con el token del usuario, timeout 5 s, caché 60 s sin cachear errores, `isDeveloper` por `roleNames` normalizados) y `withAccess(handler, { permission, campaignFrom })` con chequeo de entrada y alcance de campaña; verificar con pruebas: 503 cuando v4 falla, 403 por campaña ajena, admin y `*` pasan, `Developer`/`developer`/`Developér` detectados
- [ ] 4.3 Crear `GET /api/me` y `GET /api/campaigns` (proxy a v4 `GET /agents/campaigns`); verificar con pruebas de route handler y `fetch` mockeado que el token del usuario se propaga y no se envía ninguna llave
- [ ] 4.4 Verificar que ningún secreto llega al cliente: prueba que recorre `.next/static` tras `npm run build` y falla si encuentra el valor de `ROLES_API_KEY`/`AWS_` de un `.env.test`

## 5. Shell y páginas de sistema

- [ ] 5.1 Implementar header sticky con gradiente, marca/sub-marca "ANA Admin", `Nav` en pills filtrada por un registro de secciones `{href, label, isAllowed(access)}`, hamburguesa `< md` y menú de usuario con "Cerrar sesión" (con `ConfirmDialog` que advierte el cierre en otras apps); verificar con pruebas de componente por permisos y teclado
- [ ] 5.2 Crear página de inicio (resumen de secciones permitidas), "Sin acceso", `not-found.tsx` y `error.tsx` con el contenedor estándar; verificar con pruebas que un agente sin permisos ve "Sin acceso" y una URL inexistente muestra "No encontrado"
- [ ] 5.3 Documentar en `admin-web/README.md` arquitectura (BFF, SSO, acceso vía v4 `/me`), variables de entorno y cómo correr en local con `NEXT_PUBLIC_COOKIE_DOMAIN=localhost`; verificar siguiendo los pasos en una copia limpia

## 6. CI y despliegue

- [ ] 6.1 Crear `.github/workflows/admin-web.yml` (filtro `admin-web/**`, Node 20, `npm ci`, `lint`, `check:design`, `typecheck`, `test`, `build`); verificar con un PR de prueba que el workflow corre y falla si se introduce `alert()`
- [ ] 6.2 Configurar Amplify Hosting con dominio `ana-admin.pernexium.com.mx` y las variables (client `1r6niimhkl2fmias6kk85n4ou4` en `NEXT_PUBLIC_COGNITO_CLIENT_ID` y en `COGNITO_ALLOWED_CLIENT_IDS`); coordinar el registro DNS con quien administra `pernexium.com.mx`; verificar que el dominio sirve por HTTPS y que `GET /api/me` responde 200 en el entorno desplegado con un token de ese client
- [ ] 6.3 Prueba manual de aceptación: SSO desde otra app Pernexium del apex, login con MFA, gate con un agente (Sin acceso), un líder y un admin, cierre de sesión; registrar resultados en el PR
