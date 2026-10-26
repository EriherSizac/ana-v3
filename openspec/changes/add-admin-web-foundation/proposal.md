# Proposal

## Why

Hoy los supervisores de ANA administran agentes y contactos a mano: en v3 suben un `credentials.csv` por campaña con palabras del día y CSVs de contactos por agente con `curl`/`setup-campaign.sh` y la llave compartida `X-Admin-Key`; en v4 la carga vive dentro de la app de escritorio. No existe una consola web que use la identidad corporativa (pool de Cognito compartido de Pernexium, SSO por cookie de dominio) ni el sistema de diseño común. Esta change crea la base de esa consola, "ANA Admin", sobre la que se montan la gestión de agentes (`add-agent-roster-management`) y la carga de contactos (`add-contact-upload-console`).

## What Changes

- Nueva app Next.js (App Router, TypeScript, Tailwind) en `admin-web/` en la raíz del repo, sub-marca "ANA Admin", pensada para `ana-admin.pernexium.com.mx`.
- Sistema de diseño Pernexium (`docs/design-system.md`) implementado como tokens Tailwind, utilidades (`pernexium-card`, `pernexium-gradient`, keyframes) y componentes base (`Button`, `Input`, `Card`, `Dialog`, `ConfirmDialog`, `Skeleton`, `SearchableMultiselect`/`SearchableSelect`, `FilterPill`, `Badge`, `Toast`, `Nav`), con reglas obligatorias verificadas en CI (sin diálogos nativos, sin `<select>` nativo, sin colores Tailwind por defecto ni hex en JSX).
- SSO con Cognito (`docs/sso-cognito-cookie-storage.md`): Amplify v6 con `CookieStorage` en el apex `.pernexium.com.mx`, mismo pool `us-east-2_UepfOyKpd`, login azul por username (no email) con los challenges del pool (MFA TOTP/SMS, alta de TOTP, nueva contraseña obligatoria), chequeo de sesión al montar el login y gate de rutas protegidas.
- BFF en route handlers de Next.js: verifica el id token en servidor (firma, emisor, `token_use=id`, `aud` en allowlist de client ids), concentra los secretos (llave de la API de Roles, credenciales AWS) solo en servidor y propaga el id token del usuario a los backends v3/v4.
- Control de acceso: el acceso efectivo (`ana:*`, campañas, admin/líder) se toma de `GET /me` del backend v4 como fuente de verdad; la consola solo admite usuarios admin, con rol Developer (para la configuración del CLI de `add-cli-remote-settings`) o con `ana:admin:agents:manage` o `ana:contacts:list:upload`; navegación y acciones filtradas por permiso y por campañas en alcance.
- Shell de la app: header sticky con gradiente, navegación por permisos, menú de usuario con cierre de sesión, contenedor estándar, páginas de "Sin acceso" y error.
- CI básica para la app (lint, typecheck, pruebas unitarias, build) en GitHub Actions con filtro de ruta `admin-web/**`.

Fuera de alcance: gestión de agentes y carga de contactos (changes dependientes), alta de usuarios, reseteo de contraseñas y recuperación de contraseña (se hacen fuera de ANA), cambios al backend v3.

## Capabilities

### New Capabilities

- `admin-web/auth-sso`: inicio y cierre de sesión con Cognito compartiendo sesión por cookie de dominio, gate de rutas y verificación del id token en el BFF.
- `admin-web/access-control`: resolución del acceso efectivo vía v4 `GET /me`, permisos de entrada, alcance por campaña, propagación de identidad a backends y manejo de secretos/errores del BFF.
- `admin-web/ui-shell`: layout, navegación y reglas obligatorias del sistema de diseño Pernexium aplicadas a toda la app.

### Modified Capabilities

_Ninguna._

## Impact

- Código nuevo: `admin-web/` (app completa), `.github/workflows/admin-web.yml` (el repo no tiene `.github/` hoy).
- Dependencias nuevas (solo en `admin-web/`): `next`, `react`, `tailwindcss`, `aws-amplify@^6`, `aws-jwt-verify`, `lucide-react`, `vitest`, `@testing-library/react`.
- Infraestructura: hosting SSR de Next.js con dominio `ana-admin.pernexium.com.mx`; App Client de Cognito usado por la app debe estar en la allowlist de audiencias del authorizer de v4 (`v4/backend/serverless.yml`, parámetro `clientId`) para que `GET /me` acepte sus tokens; callback/orígenes del App Client se coordinan con quien administra el pool.
- Dependencia en tiempo de ejecución: backend v4 desplegado en `us-east-2` (`GET /me`, `GET /agents/campaigns`) y API de Roles de Pernexium.
- Changes dependientes: `add-agent-roster-management`, `add-contact-upload-console` y `add-cli-remote-settings` requieren esta base.
