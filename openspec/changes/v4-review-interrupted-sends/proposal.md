# Proposal

## Why

Si el desktop v4 se cierra, se actualiza o se cae entre el envío de WhatsApp y el `POST /jobs/ack`, el job sigue `pending` en el backend y vuelve a aparecer en "Mi asignación": la siguiente aprobación **reenvía el mensaje al mismo deudor**. El ack además es fire-and-forget: un fallo de red tras un envío exitoso produce el mismo efecto. En v3, `report-pending-progress` resuelve el caso equivalente marcando el contacto que quedó "en curso" como **por revisar** (no se reenvía ni se pierde) y `link-review-contacts-to-uploads` lo enlaza a su carga en ANA Admin para que un supervisor lo descarte o lo reasigne. v4 necesita el mismo comportamiento para que la comparación sea justa.

## What Changes

- **Reserva antes de enviar**: el desktop reserva cada job con `POST /jobs/claim` (`pending` → `sending`, con `claimedAt`) justo antes de enviarlo; si la reserva falla, no lo envía.
- **Por revisar**: un job que sigue `sending` 10 minutos después de su reserva pasa a `review` en el backend; nunca vuelve a `pending` solo ni se reenvía automáticamente.
- **Acuse confiable**: el ack se reintenta (3 intentos) y es aceptado desde `sending` o `review` (el resultado real gana sobre la sospecha).
- **Desktop**: pestaña "Por revisar (N)" de solo lectura en "Mi asignación" y conteo "por revisar" en el panel de pendientes del líder.
- **Backend**: `GET /jobs/review` (por campaña y, opcionalmente, por carga `srcKey`) y `POST /jobs/review/resolve` para descartar o reencolar (al mismo u otro agente) con autor y fecha.
- **ANA Admin**: en el detalle de una carga v4 del historial (`add-contact-upload-console`), sección "Por revisar" por agente con "Descartar" y "Reenviar a…" (agente habilitado), con confirmación que advierte posible mensaje duplicado; vista por campaña para los envíos directos (sin carga).
- Nuevos estados `sending`, `review` y `discarded` en la cola.
- Despliegue del backend antes del release del desktop (los desktops viejos no reservan y siguen funcionando como hoy).

Fuera de alcance: persistencia local del lote en el desktop (los jobs ya viven en el backend), deduplicar contra otras cargas, reasignar desde el desktop.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/send-jobs`: estados de reserva y revisión en la tabla; se agregan reserva, paso a revisión, transiciones del acuse, jobs por revisar en el poll, consulta y resolución.
- `v4/job-processing`: reserva antes de enviar y acuse con reintento; pestaña "Por revisar".
- `v4/team-jobs`: se agrega el conteo de por revisar en el resumen.
- `v4/team-viewer`: se agrega el conteo de por revisar en el panel de envíos pendientes.
- `admin-web/contact-upload` (creada por `add-contact-upload-console`): se agregan los contactos por revisar en cargas v4 y por campaña.

## Impact

- Depende de `v4-harden-send-job-queue` (estados, índice con `status`/`srcKey`, ack con conteo real). La parte de ANA Admin depende de `add-admin-web-foundation` y `add-contact-upload-console` (detalle de carga v4 por `srcKey`) y usa el roster v4 de `add-agent-roster-management` para los destinos habilitados.
- Backend: `src/handlers/jobsPoll.ts` (claim, paso a revisión perezoso, ack), `src/handlers/jobsAdmin.ts` (review, resolve), `serverless.yml` (rutas), `src/lib/jobs.ts`.
- Desktop: `electron/jobs/poller.ts`, `src/routes/Assignment.tsx`, `src/routes/TeamViewer.tsx`.
- admin-web: detalle `/contactos/historial/[uploadId]` (flota v4), página por campaña, rutas BFF `/api/v4/campaigns/{campaign}/review*`.
