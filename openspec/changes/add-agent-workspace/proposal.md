# Proposal

## Why

Con `add-supervisor-contact-access` las cargas v3 de ANA Admin quedan en las asignaciones pendientes del agente (`assignments/agents/{c}/{agent}-contacts-{ts}.csv`) sin mensaje, pero ningún sistema vigente permite al agente revisarlas, escribir su mensaje y entregarlas al CLI: el portal anterior (`chatbot-v2-front`, `AgentsManager`) lo hacía con la "palabra del día" y rutas sin token (`/supervisors/...`, `/agents/{agent}/{campaign}/contacts`). Los agentes ya inician sesión con Cognito en el CLI; falta su vista web con el mismo login.

## What Changes

- **"Mi asignación" en ANA Admin** (`/mi-asignacion`): el agente (o supervisor) con `ana:campaign:message:send`, habilitado en el roster v3, entra con SSO, elige una de sus campañas, ve sus asignaciones pendientes, carga y combina varios CSV, elige una o varias columnas de teléfono, escribe el mensaje con `{{variable}}`, `{variable}` y expresiones matemáticas (semántica del CLI v3), ve la vista previa por fila, selecciona filas y publica con confirmación; ve el historial de sus publicaciones. Sin palabra del día.
- **Entrada a la consola**: `ana:campaign:message:send` se agrega a los permisos de entrada; la navegación muestra solo las secciones permitidas (un agente solo ve "Mi asignación").
- **v3 backend**: rutas nuevas `GET /agent/assignments/{campaign}`, `GET /agent/assignments/{campaign}/file`, `POST /agent/assignments/{campaign}/publish` y `GET /agent/assignments/{campaign}/publications` con la autenticación de agente existente (authorizer `cognitoAgentJwt` + token + roster). El agente solo ve y publica lo suyo. La publicación lee los pendientes elegidos, renderiza el mensaje por fila en el servidor, escribe `agents/{c}/{agent}-contacts-{ts}.csv` (lo que consume el CLI) con la columna `message` ya renderizada y `ana_upload_id` por fila, más copia en `historic/`, consume las filas publicadas de los pendientes (reescribe el resto o borra el archivo) y registra un manifiesto.

Fuera de alcance: agentes v4 (siguen en el desktop), plantillas guardadas de campaña (`/templates`), retirar las rutas `/supervisors/assignments*` y `/agents/{agent}/{campaign}/contacts` con `X-Admin-Key`, cambios al CLI.

## Capabilities

### New Capabilities

- `v3/agent-workspace`: consulta de asignaciones pendientes del agente, publicación con mensaje renderizado al layout del CLI y su historial.
- `admin-web/agent-workspace`: vista "Mi asignación" de ANA Admin.

### Modified Capabilities

- `admin-web/access-control` (de `add-admin-web-foundation`): permisos de entrada incluyen `ana:campaign:message:send`.

## Impact

- v3 backend: `src/handlers/agentAssignments.ts`, `src/lib/assignmentCsv.ts`, `src/lib/templateRender.ts`, `serverless.yml` (4 funciones con `cognitoAgentJwt`, timeout 29 s para publicar), pruebas vitest con equivalencia contra `v3/cli-whatsapp/template-utils.js` y `assignment-csv.js`. Datos nuevos: `agent-publications/{campaign}/{agent}/{publishId}.json`.
- admin-web: sección y página `/mi-asignacion`, rutas BFF `/api/agent/*`, `src/lib/workspace/`, pruebas.
- CLI v3: sin cambios; consume el archivo publicado con `GET /get/chats` como hoy.
- Depende de `add-supervisor-contact-access` (cargas a pendientes, supervisores habilitados) y de `migrate-cli-to-cognito-login` (`requireAgentToken`, authorizer `cognitoAgentJwt`; ANA Admin y el CLI comparten el App Client `1r6niimhkl2fmias6kk85n4ou4`).
