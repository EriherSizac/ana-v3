# Proposal

## Why

ANA Admin (`https://ana-admin.pernexium.com.mx`) mantiene su propio formulario de inicio de sesión (usuario, contraseña, MFA, alta de TOTP, nueva contraseña) duplicando lo que ya resuelve el login central de Pernexium en `https://login.pernexium.com.mx`. Mantener dos formularios sobre el mismo pool significa dos lugares donde corregir flujos de MFA, contraseña vencida o recuperación, y una experiencia distinta a la del resto de apps del apex. El login central ya maneja todos los pasos del pool y comparte la sesión por la misma cookie del apex que ANA Admin ya lee.

## What Changes

- **BREAKING (UX)**: `/login` deja de mostrar formulario. Sin sesión, manda al login central con `?redirect=<URL absoluta de vuelta>`; con sesión, entra directo al destino de `next` como hoy. No hay formulario de respaldo: si el login central no responde, nadie inicia sesión en ANA Admin.
- Se eliminan el formulario propio y los challenges de Cognito del cliente (`login`, `confirmLogin`, `mapStep`, `loginErrorMessage`); el login central es el único que habla `signIn` con el pool.
- Tope contra bucles: si `/login` manda al login central más de 4 veces en 30 s (la app no logra leer la cookie), se detiene y muestra un aviso con "Reintentar".
- Cerrar sesión cierra la sesión local y termina en `https://login.pernexium.com.mx/logout?redirect=<origen>`.
- Cookie de sesión alineada con el login central: expiración de 30 días (antes 1) y `domain=.pernexium.com.mx` decidido por el host (solo si el host está dentro del apex y es https), en lugar de la variable `NEXT_PUBLIC_COOKIE_DOMAIN`, que se elimina.
- Nueva variable pública opcional `NEXT_PUBLIC_LOGIN_URL` (por defecto `https://login.pernexium.com.mx` en producción y `http://localhost:3100` en desarrollo).

Fuera de alcance:
- `v4/desktop` (Electron) y `v3/cli-whatsapp`: no viven en `*.pernexium.com.mx`, la cookie no les llega; siguen con su login propio.
- BFF: ya valida firma, emisor, `token_use`, expiración y `aud` contra la allowlist; no cambia.
- Agregar ANA Admin al lanzador (`PERNEXIUM_APPS`) del login central: vive en otro repositorio.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `admin-web/auth-sso`: la sesión compartida pasa a 30 días con dominio por host; `/login` delega en el login central (sin formulario ni challenges propios) con tope contra bucles; el cierre de sesión termina en el `/logout` del login central.

## Impact

- `admin-web/src/app/(auth)/login/page.tsx`, `src/components/system/LoginView.tsx` (reemplazado por la redirección), `src/components/system/LogoutButton.tsx`.
- `admin-web/src/lib/auth-client.ts` (se quitan las funciones de inicio de sesión), `src/lib/amplify.ts` (cookie), nuevo módulo de URLs del login central.
- Pruebas: `test/client/login.test.tsx`, `test/client/auth-client.test.ts`, `test/client/amplify.test.ts`.
- Configuración: `.env.example`, `.env.test`, `README.md`, variables de Amplify Hosting (se retira `NEXT_PUBLIC_COOKIE_DOMAIN`, opcional `NEXT_PUBLIC_LOGIN_URL`).
- Operación: el desarrollo local necesita el login central corriendo en `http://localhost:3100`; las previews en `*.amplifyapp.com` no tendrán sesión.
