# Proposal

## Why

`add-cli-remote-settings` da al CLI v3 una configuración remota editable por el rol Developer desde ANA Admin. Para comparar ambas versiones en igualdad, v4 necesita la misma palanca: hoy cualquier ajuste operativo del desktop exige un release. Se decidió que **sí** tiene sentido en v4, con un catálogo propio, porque el flag de v3 (`noWhatsappConsultRegistration`) no aplica (v4 no tiene el modal "Números sin WhatsApp") pero v4 sí tiene valores fijos en código que operación necesita ajustar sin release:

- El ritmo anti-bloqueo (≥ 2 min entre mensajes, máx. 7 por 20 min) es el principal parámetro de riesgo de bloqueo de números y de productividad, y hoy es una constante del main.
- El registro "Atención WhatsApp" al abrir un chat es el análogo v4 del registro ruidoso que v3 desactiva por configuración. Negocio confirmó que **no lo usa**, así que queda apagado por defecto y solo un Developer puede activarlo.

## What Changes

- v4 backend: configuración global del desktop con catálogo cerrado y tipado (`sendMinGapSeconds` 60–600, por defecto 120; `sendMaxPerWindow` 1–20, por defecto 7; `sendWindowMinutes` 5–60, por defecto 20; `openChatInteraction`, por defecto `false`), guardada en DynamoDB con versión y auditoría por llave.
- Rutas de administración `GET /admin/desktop-settings` y `PUT /admin/desktop-settings` solo para usuarios con rol Developer (misma regla de nombre de rol que ANA Admin), con concurrencia optimista (409).
- Ruta de lectura `GET /settings` para cualquier usuario autenticado (valores efectivos).
- Desktop: el main lee la configuración tras el login y cada 5 minutos, conserva el último valor y usa los valores por defecto si nunca pudo leerla; el ritmo y el registro de apertura de chat usan esos valores.
- ANA Admin: sección "Desktop v4" en la página "Configuración" (`/configuracion`) existente.
- Despliegue del backend, release del desktop y despliegue de ANA Admin.

- **BREAKING** (comportamiento): desde el release, el desktop deja de registrar "Atención WhatsApp" al abrir chats mientras nadie active `openChatInteraction`; también si nunca pudo leer la configuración.

Fuera de alcance: valores por campaña o por agente (el esquema queda versionado), permitir saltar la actualización obligatoria por configuración, cambiar `PERMISSIONS_ENFORCED` desde la consola.

## Capabilities

### New Capabilities

- `v4/desktop-remote-settings`: catálogo, almacenamiento, rutas de administración y de lectura de la configuración remota del desktop v4, y su consumo por el desktop.

### Modified Capabilities

- `v4/job-processing`: "Ritmo anti-bloqueo" usa los valores configurados.
- `v4/desktop-chats`: "Registro de apertura de chat" depende de `openChatInteraction`.
- `admin-web/cli-settings` (creada por `add-cli-remote-settings`): se agrega la sección de configuración del desktop v4.

## Impact

- Depende de `add-admin-web-foundation` (shell, BFF, `isDeveloper`) y de `add-cli-remote-settings` (página `/configuracion`, que se extiende).
- Backend: nuevo `v4/backend/src/lib/desktopSettings.ts` (catálogo, validación, merge), nuevo `src/handlers/settings.ts`, `serverless.yml` (rutas), reutiliza `ana-backend-roleperms-<stage>` (item `PK=CONFIG`, `SK=DESKTOP_SETTINGS`), `src/lib/access.ts` (`isDeveloper`).
- Desktop: nuevo `electron/settings/remoteSettings.ts`, `electron/jobs/poller.ts` (ritmo parametrizable), `electron/main.ts` y `electron/preload.ts` (`getSettings`, `onSettings`), `src/routes/Chats.tsx`.
- admin-web: sección en `/configuracion`, rutas BFF `/api/v4/desktop-settings`.
