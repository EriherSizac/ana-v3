# Proposal

## Why

El agente v3 no tiene forma de ver qué pasó con lo que publicó. Hoy existe el historial de publicaciones (`GET /agent/assignments/{campaign}/publications`, manifiestos en `agent-publications/`), pero el resultado de cada contacto (enviado, sin WhatsApp, error, por revisar) solo vive en el equipo del agente: `resultados.csv`, el registro local `assignment-journal-*.json` y las interacciones del CRM. Si el agente cambia de equipo o pregunta "¿a quién ya le llegó?", nadie puede responder desde ANA Admin, y el líder no tiene una vista de avance por agente.

## What Changes

- **CLI v3 (1.0.51)**: tras cada intento de envío, el CLI reporta el resultado a `POST /agent/results` (token del agente vía `backend-client.js`) desde una **bandeja de salida persistente** en el directorio de datos: reintentos con espera creciente, sobrevive al reinicio, deduplica por llave de idempotencia `assignmentId#rowIndex#attempt` y nunca bloquea ni retrasa el envío. Los contactos interrumpidos (`in_flight` → `por_revisar`) también se reportan.
- **Backend v3**:
  - `GET /get/chats` agrega la cabecera `X-Ana-Assignment-Key` con la llave del archivo entregado (aditivo; los CLI anteriores la ignoran). El CLI la guarda en su registro local para enlazar cada resultado con su publicación.
  - `POST /agent/results` (`cognitoAgentJwt` + token estricto + roster): valida el lote (máx. 100), toma el agente del token y escribe un objeto inmutable por lote y día MX en `results/{campaign}/{agent}/{YYYY-MM-DD}/{hash}.json`.
  - `GET /agent/results/{campaign}` (propio) y `GET /admin/campaigns/{campaign}/results` (líderes/supervisores/admin con permisos de Contactos y campaña en alcance, filtro `agent`): filas deduplicadas con filtros (fechas, estado, publicación, búsqueda), orden, cursor y agregados por publicación (publicados, enviados, sin WhatsApp, error, por revisar, pendientes).
  - Retención de 180 días con regla de ciclo de vida sobre `results/` en `StorageBucket`.
  - Puente realtime: prefijo `results/` en la regla; v4 traduce la creación de un lote a `results.changed` para el agente.
- **ANA Admin**: vista "Historial de envíos" para el agente (`/mi-asignacion/historial`, enlazada desde Mi asignación) con tarjetas por publicación, tabla por contacto (teléfono enmascarado), filtros, orden y exportación CSV; vista de campaña con filtro de agente para líderes y supervisores (`/historial-envios`).

Compatibilidad: el contrato solo crece. Los CLI instalados no llaman a `/agent/results` y siguen funcionando; el backend se despliega antes del release del CLI.

Fuera de alcance: reenviar desde el historial, resultados de v4 (desktop), resultados de la gestión manual y respuestas de los deudores.

## Capabilities

### New Capabilities

- `v3/agent-send-history`: registro de resultados de envío por contacto desde el CLI v3, su almacenamiento y consulta en el backend, y la vista "Historial de envíos" de ANA Admin.

### Modified Capabilities

_Ninguna._ (La cabecera de `GET /get/chats` y el evento realtime se especifican como requisitos nuevos de la capacidad nueva.)

## Impact

- CLI: nuevo `results-outbox.js` (+ pruebas `node:test`), `index.js` (encolar tras cada intento), `agent-config.js` (`sourceKey` de la cabecera), `assignment-journal.js` (`source_key` opcional), `build-portable.ps1`.
- Backend v3: nuevo `src/handlers/agentResults.ts` y `src/lib/sendResults.ts`, `chats.ts` (cabecera), `serverless.yml` (3 funciones, ciclo de vida, prefijo del puente), pruebas vitest.
- v4 backend: `realtime.ts` (tipo `results.changed`) y `realtimeBridge.ts` (prefijo `results/`).
- ANA Admin: rutas BFF `/api/agent/results/[campaign]` y `/api/campaigns/[campaign]/results`, `components/workspace/SendHistoryView.tsx`, `lib/send-history.ts`, páginas nuevas, sección nueva en `sections.ts`, un enlace en `MyAssignmentView.tsx`, `KNOWN_EVENTS`.
- Datos: nuevo prefijo `results/` en `ana-backend-storage-prod` con teléfonos, créditos y un extracto del mensaje (mismo nivel de sensibilidad que `review/`), expira a los 180 días.
- Despliegue: v4 backend → v3 backend → ANA Admin → release CLI 1.0.51.
