# Proposal

## Why

En v3 el supervisor parte a mano el CSV maestro en un archivo por agente y lo sube con `POST /supervisors/agents/{agent}/{campaign}/contacts` (llave compartida `X-Admin-Key`); además esa ruta escribe por defecto en `assignments/agents/...`, que ningún proceso promueve a `agents/...`, la ruta que el CLI realmente consume (`GET /get/chats`), así que solo funciona con `direct=true`. En v4 la carga existe (presign + `csvTrigger`) pero solo desde el desktop. Falta una consola web que, con el roster de agentes habilitados (`add-agent-roster-management`), reparta y entregue contactos en ambas flotas con vista previa y deje historial.

## What Changes

- Nueva sección "Contactos" en ANA Admin: elegir campaña, flota (v3/v4) y modo (repartir entre los agentes habilitados de la campaña o asignar todo a un agente habilitado), cargar el CSV, validarlo en el navegador (columna de teléfono, filas inválidas, duplicados, límites de tamaño), definir mensaje/plantilla, ver la vista previa por agente (conteos y primeras filas) y confirmar; el BFF recalcula el reparto y rechaza si el roster cambió desde la vista previa.
- Historial de cargas por campaña y flota (fecha, autor, archivo, modo, filas válidas/totales y conteo por agente).
- v3 (`v3/ana-backend`): nueva ruta `POST /admin/campaigns/{campaign}/contacts` (JWT de ANA Admin + permisos) que recibe los archivos por agente ya repartidos, valida que cada agente esté habilitado en el roster y escribe directamente en `agents/{campaign}/{agent}-contacts-{ts}.csv` (lo que consume el CLI) más copia en `historic/`, con manifiesto `uploads/{campaign}/{uploadId}.json` idempotente por `uploadId`; nueva ruta `GET /admin/campaigns/{campaign}/uploads` para el historial.
- v4 (`v4/backend`): ANA Admin usa el flujo existente `POST /uploads/presign` con `distribute` y `assignments` (peso 1 por agente, en el orden del plan) con el token del usuario; `csvTrigger` registra cada carga procesada en una tabla nueva de historial y se agrega `GET /uploads/history?campaign=`.

Fuera de alcance: retirar `POST /supervisors/agents/{agent}/{campaign}/contacts` y la carpeta `assignments/` (siguen igual hasta el retiro de `X-Admin-Key`, ver design de `add-agent-roster-management`), reasignar pendientes ya entregados, editar plantillas de campaña (`/templates`), deduplicar contra cargas anteriores.

## Capabilities

### New Capabilities

- `admin-web/contact-upload`: carga, validación, vista previa del reparto, confirmación y historial de contactos desde ANA Admin para v3 y v4.
- `v4/contact-uploads`: registro del historial de cargas CSV procesadas por `csvTrigger` y su consulta por campaña.

### Modified Capabilities

- `v3/agent-assignments`: se agregan la carga de contactos de administración (autenticada con Cognito, validada contra el roster y escrita en el layout que consume el CLI), su manifiesto y la consulta del historial.

## Impact

- Depende de `add-admin-web-foundation` y de `add-agent-roster-management` (roster v3/v4, authorizer `cognitoAdminJwt` y autorización `/admin/*`).
- admin-web: páginas `/contactos` y `/contactos/historial`, rutas BFF `/api/campaigns/{campaign}/uploads*`; parser CSV en el cliente (`papaparse`).
- v3 backend: `src/handlers/adminContacts.ts`, reutilización del procesamiento de la columna `message` de `supervisors.ts` (extraído a `src/lib/`), funciones nuevas en `serverless.yml` con `cognitoAdminJwt`; límite de body por payload de Lambda (~6 MB).
- v4 backend: `src/handlers/csvTrigger.ts`, nuevo `src/lib/uploads.ts`, nueva ruta en `api.ts`, tabla `ana-backend-uploads-{stage}` en `serverless.yml`.
- Datos: objetos nuevos `uploads/{campaign}/*.json` en `ana-backend-storage-prod`; la carga web de v3 genera archivos `agents/...` y `historic/...` con el mismo formato que la carga directa actual.
- CLI v3: sin cambios; consume los archivos igual que hoy (`GET /get/chats`).
