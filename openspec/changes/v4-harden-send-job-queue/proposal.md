# Proposal

## Why

La cola de send-jobs de v4 tiene defectos que distorsionan cualquier comparación con v3:

- El índice `campaign-index` no proyecta `status`, así que `GET /jobs/summary` cuenta como pendientes los jobs ya enviados hasta que vencen (7 días) y `POST /jobs/reassign` intenta moverlos y los cuenta como "arrendados".
- La documentación (`ARCHITECTURE.md`, `ARQUITECTURA_FLUJOS.md`, `CONTEXT.md`) describe un lease de 10 jobs por poll y un `ack` que borra; el código no asigna lease (devuelve todo) y `ack` solo cambia el estado; `acked` cuenta lo recibido, no lo actualizado, y un estado inválido se guarda como `sent`.
- `GET /jobs/poll` corta en ~2000 items en orden de `jobId`: un agente con mucho historial puede no ver pendientes nuevos, sin aviso.
- El `campaignId` de un CSV lo fija el cliente (`<archivo>-<lada>`) y el `jobId` es `<campaignId>#<índice>`: subir dos veces el mismo archivo **sobrescribe** los jobs de la primera carga, incluidos los ya enviados, que vuelven a `pending` y se reenvían al deudor.
- `csvTrigger` no reintenta los `UnprocessedItems` de `BatchWrite` (jobs perdidos en silencio), un evento S3 duplicado reprocesa el archivo y un CSV ilegible hace fallar la invocación.
- La reasignación es secuencial y puede exceder los 29 s.

## What Changes

- Nuevo índice por campaña que proyecta `status`, `srcKey` y `sentAt`; resumen y reasignación usan el estado real. El índice viejo se retira.
- Semántica explícita sin lease: estados `pending`, `sent`, `no_whatsapp`, `error`; `leased` heredado se lee como `pending`; `ack` informa cuántos jobs actualizó, cuáles no existen y rechaza estados inválidos. La documentación se alinea al código.
- `GET /jobs/poll` entrega primero todos los pendientes (hasta 2000) y el historial reciente (hasta 300 por `sentAt`), con `truncated` y totales; el desktop avisa cuando la lista está truncada.
- Identificador de carga generado por el servidor (único por objeto subido); el `campaignId` del cliente se conserva como `label`. **BREAKING** (contrato interno): `campaignid` de la metadata ya no es el valor enviado por el cliente.
- `csvTrigger`: reintento de `UnprocessedItems` con espera exponencial, procesamiento único por objeto (marcador), CSV ilegible registrado sin fallar la invocación, y borrado del CSV en cuanto sus jobs están escritos (hoy un CSV repartido nunca se borra: el agente que termina recibe 403 al borrar la key del líder), con expiración de 7 días en el bucket como respaldo.
- Reasignación por lotes en paralelo con presupuesto de tiempo y respuesta `partial`.
- Despliegue del backend en tres pasos (índice nuevo, cambio de código, retiro del índice viejo) y release del desktop (aviso de truncado).

Fuera de alcance: reservar el job antes de enviarlo y los jobs "por revisar" (`v4-review-interrupted-sends`, que depende de este cambio), validar el destino de una reasignación contra el roster (`add-agent-roster-management`).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/send-jobs`: tabla e índice con estado proyectado y semántica sin lease; poll con prioridad de pendientes y truncado explícito; ack con conteo real y estados válidos.
- `v4/team-jobs`: resumen y reasignación basados en `status`; reasignación por lotes con presupuesto de tiempo.
- `v4/csv-ingestion`: identificador de carga generado por el servidor y `jobId` único por carga; se agregan escritura completa, procesamiento único por objeto, borrado del CSV procesado y manejo de CSV ilegible.
- `v4/job-processing`: se agrega el aviso de asignación truncada.

## Impact

- Backend: `v4/backend/serverless.yml` (GSI `campaign-status-index`, variable `JOBS_CAMPAIGN_INDEX`), `src/handlers/jobsPoll.ts`, `src/handlers/jobsAdmin.ts`, `src/handlers/csvTrigger.ts`, `src/handlers/api.ts` (`presignCsv`), `src/lib/jobs.ts`.
- Desktop: `electron/jobs/poller.ts` (lee `truncated`/totales), `src/routes/Assignment.tsx` (aviso). `src/routes/Campaigns.tsx` sigue enviando su `campaignId`, ahora usado como etiqueta.
- `add-contact-upload-console` (v4/contact-uploads): su registro por `srcKey` es compatible; el identificador de carga nuevo puede mostrarse como referencia.
- Documentación: `v4/ARCHITECTURE.md`, `v4/ARQUITECTURA_FLUJOS.md`, `v4/CONTEXT.md`, `v4/CAMPANAS_Y_ASIGNACION.md`.
