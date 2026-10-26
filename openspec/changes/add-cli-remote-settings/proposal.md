# Proposal

## Why

El CLI v3 registra en el CRM el subdictamen "Consulta No Whatsapp" desde el modal "Números sin WhatsApp" de la ventana manual, pero la operación ya no usa ese subdictamen: hoy solo genera registros que ensucian los reportes. Activarlo o desactivarlo exige un release del CLI porque no existe configuración remota. Se necesita una configuración del CLI administrada desde ANA Admin, editable solo por usuarios con rol Developer, que el CLI lea al arrancar y periódicamente, con valores seguros si no está disponible.

## What Changes

- v3 (`v3/ana-backend`): configuración global del CLI en S3 `config/cli-settings.json` con catálogo cerrado de flags tipados y valores por defecto; primer flag `noWhatsappConsultRegistration` (booleano, por defecto `false`).
- v3: rutas de administración `GET /admin/cli-settings` y `POST /admin/cli-settings` (authorizer `cognitoAdminJwt`, solo usuarios con rol Developer resuelto con v4 `GET /me`), con auditoría `updatedBy`/`updatedAt`.
- v3: ruta de agente `GET /agent/settings` que devuelve la configuración efectiva (valores guardados sobre los por defecto); su autenticación es la de las rutas `/agent/*` definida en `migrate-cli-to-cognito-login` (ID token del CLI siempre exigido).
- CLI (`v3/cli-whatsapp`): consulta `GET /agent/settings` tras el login y cada 5 minutos, mantiene el último valor obtenido en memoria y usa los valores por defecto si nunca pudo leerla; expone el valor vigente a sus ventanas. La ventana manual usará `noWhatsappConsultRegistration` para mostrar el botón de registro (lo define `fix-no-whatsapp-modal-duplicates`, no esta change).
- ANA Admin: página "Configuración" (`/configuracion`), visible solo para usuarios Developer, con el toggle "Registrar consulta de números sin WhatsApp" y espacio para futuros flags, confirmación y auditoría visible.

Fuera de alcance: overrides por campaña o por agente (el esquema queda versionado para agregarlos), configuración del backend v4/desktop, cambiar el payload de la interacción o la lógica del modal.

## Capabilities

### New Capabilities

- `v3/cli-remote-settings`: almacenamiento, catálogo, rutas de administración y de agente de la configuración remota del CLI v3, y su consumo por el CLI.
- `admin-web/cli-settings`: página de ANA Admin para ver y editar la configuración del CLI, restringida al rol Developer.

### Modified Capabilities

_Ninguna._ (La autenticación de `GET /agent/settings` ya está declarada por `migrate-cli-to-cognito-login` en `v3/backend-api-security`.)

## Impact

- Depende de `add-admin-web-foundation` (shell, BFF, `isDeveloper`) y de `add-agent-roster-management` (authorizer `cognitoAdminJwt` y `requireAdminAccess` en v3). La ruta `GET /agent/settings` depende de la autenticación de agente de `migrate-cli-to-cognito-login`; el consumo en el CLI sale en el mismo release que el login con Cognito o después.
- v3 backend: `src/handlers/cliSettings.ts`, `src/lib/cliSettings.ts` (catálogo y merge), funciones en `serverless.yml`.
- CLI: nuevo `remote-settings.js`, arranque en `index.js`; release por autoupdate.
- admin-web: página `/configuracion`, rutas BFF `/api/cli-settings`.
- Datos: objeto nuevo `config/cli-settings.json` en `ana-backend-storage-prod`.
- Coordinación: `fix-no-whatsapp-modal-duplicates` condiciona su botón de registro a `noWhatsappConsultRegistration`; mientras el CLI no tenga esta change, el valor efectivo es `false` (botón oculto).
