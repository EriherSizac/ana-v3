# Proposal

## Why

Con el login Cognito (`migrate-cli-to-cognito-login`) los usernames de los agentes no coinciden con los `agent_id` legados, y los respaldos de chat guardados bajo esos `agent_id` se mueven a `legacy/backups/` y `legacy/media/` para conservarlos como historial de cobranza. Sin una vista de consulta, ese historial solo es accesible con la consola de AWS, sin control por campaña ni registro de quién lo consulta. Los supervisores necesitan buscar conversaciones pasadas de un deudor (por campaña, agente legado, teléfono y fecha) desde ANA Admin, en solo lectura.

## What Changes

- v3 (`v3/ana-backend`): rutas de solo lectura `GET /admin/campaigns/{campaign}/legacy-chats` (búsqueda en un índice por campaña) y `GET /admin/campaigns/{campaign}/legacy-chats/{agent}/{phone}` (conversación), bajo el authorizer `cognitoAdminJwt` de `/admin/*` y con autorización vía v4 `GET /me`: admins en cualquier campaña y líderes solo en sus campañas.
- v3: la multimedia de una conversación se entrega con URLs prefirmadas de corta duración, solo para llaves bajo `legacy/media/{campaign}/`; ninguna ruta escribe ni borra en `legacy/`.
- v3: ruta `GET /admin/campaigns/{campaign}/legacy-agents` que expone la lista de agentes legados `legacy/agents/{campaign}.json` (solo usernames, extraída por la purga de `migrate-cli-to-cognito-login` antes de archivar `credentials.csv`) para el filtro de agente.
- v3: script único que construye el índice de búsqueda `legacy/index/{campaign}.json` a partir de los respaldos movidos (el archivo legado no cambia después del movimiento).
- ANA Admin: sección "Historial legacy" con selector de campaña, filtros por agente legado (selector con los nombres de `legacy/agents/`, etiquetados "Legacy", no activos ni habilitables), teléfono y rango de fechas, lista de conversaciones y vista de la conversación con el texto de los mensajes siempre como texto (nunca HTML) y la multimedia por URL prefirmada.
- Registro de acceso: cada consulta registra usuario, campaña, agente y teléfono, sin contenido de mensajes.

Fuera de alcance: los respaldos diarios del estado del agente (`legacy/backups/{campaign}/{YYYY-MM}/{agent}_{DD}.json`), que se conservan pero no se muestran; exportar o descargar conversaciones completas; editar o borrar el historial; los respaldos nuevos de usernames de Cognito (siguen en `backups/` con sus rutas actuales).

## Capabilities

### New Capabilities

- `v3/legacy-chat-archive`: contrato de almacenamiento del historial legado en `legacy/`, su índice y las rutas de administración de solo lectura con su autorización por campaña.
- `admin-web/legacy-chat-history`: sección de ANA Admin para buscar y leer conversaciones legadas con render seguro y control de acceso.

### Modified Capabilities

_Ninguna._ (Las rutas `/admin/*` ya quedan bajo el authorizer que define `add-agent-roster-management` en `v3/backend-api-security`.)

## Impact

- Depende de `add-admin-web-foundation` (shell, BFF, acceso vía v4 `GET /me`), de `add-agent-roster-management` (authorizer `cognitoAdminJwt`, `requireAdminAccess`, renombrado de campañas al catálogo) y del movimiento a `legacy/` de `migrate-cli-to-cognito-login` (design.md D12).
- v3 backend: `src/handlers/adminLegacyChats.ts`, `src/lib/legacyChats.ts`, `scripts/build-legacy-chat-index.ts`, funciones en `serverless.yml`, pruebas vitest.
- admin-web: página `/historial-legacy`, rutas BFF `/api/campaigns/{campaign}/legacy-chats`.
- Datos: objetos nuevos `legacy/index/{campaign}.json` en `ana-backend-storage-prod`; lectura de `legacy/backups/`, `legacy/media/` y `legacy/agents/`.
- Seguridad/privacidad: historial de cobranza con datos de deudores; acceso por campaña, URLs prefirmadas de 5 minutos y registro de consultas.
