# Design

## Context

- `JobPoller.processFile` espera el ritmo, llama `runJob` (resuelve, escribe, envía) y después `ack`; un cierre entre `sendMessage` y `ack` deja el job `pending`. `approve` filtra por estado en memoria, que se pierde al reiniciar.
- Tras `v4-harden-send-job-queue`, el índice por campaña proyecta `status` y `srcKey`, `ack` informa `notFound`/`invalid` y no hay lease.
- En v3 el "en curso" se detecta localmente (journal del CLI); en v4 el backend es la fuente de verdad del estado, así que la detección se hace en el backend.

## Goals / Non-Goals

**Goals:** ningún reenvío automático de un job que pudo haberse enviado; nada se pierde en silencio; un supervisor decide desde ANA Admin.

**Non-Goals:** saber con certeza si WhatsApp entregó el mensaje interrumpido (no se consulta el historial del chat); resolver desde el desktop.

## Decisions

- **D1. Reserva justo antes de `runJob`.** Después de la espera del ritmo, `POST /jobs/claim {jobId}`: `UpdateCommand` condicionado a `#s = :pending OR attribute_not_exists(#s) OR #s = :leased`, `SET #s = :sending, claimedAt = :now ADD attempts :one`. 409 → el job se salta (otro proceso lo tomó o fue reasignado). Error de red → no se envía y el lote continúa con el siguiente (el job sigue `pending`). Alternativa: reservar todo el lote al aprobar; se descarta porque un lote de 7/20 min puede durar horas y todo quedaría en revisión ante un cierre.
- **D2. Paso a revisión perezoso.** No hay proceso programado: `GET /jobs/poll` (del dueño), `GET /jobs/summary` y `GET /jobs/review` convierten con escritura condicional los `sending` con `claimedAt < now − 10 min` a `review` (`reviewReason: "interrupted"`, `reviewAt`). 10 min cubre el envío más lento (resolver + 9 s de escritura + red) y la espera de instalación de 3 min de `v4-fix-desktop-session-lifecycle`. Alternativa: EventBridge cada 5 min con scan; se descarta por costo y porque el poll del dueño llega cada 5 s.
- **D3. Acuse.** Se acepta desde `pending` (desktops viejos), `sending` y `review`; desde `discarded` o un estado final distinto se lista en `invalid`. El desktop reintenta el ack 3 veces (1 s, 5 s, 30 s); si todos fallan, el job queda `sending` y terminará en revisión (falso positivo aceptable, nunca reenvío).
- **D4. Poll.** `sending` y `review` se devuelven junto a los no finales (el desktop los muestra en "Por revisar", nunca como aprobables); `discarded` con los finales. `approve` y el envío automático solo toman `pending`.
- **D5. Resolución.** `POST /jobs/review/resolve {campaign, items:[{operatorId, jobId}], action: "discard"|"requeue", to?}` (máx. 100 items). `discard` → `status: discarded`, `resolvedBy`, `resolvedAt`, `resolution: "discarded"`. `requeue` → transacción: original a `discarded` con `resolution: "requeued"`, `requeuedTo`; job nuevo en `to` (default el mismo agente) con `jobId = <jobId>~r<epochMs>`, `status: pending`, misma `row`/`template`/`srcKey`/`campaign`/`label`, `requeuedFrom`. Condición: original en `review`. Respuesta por item `{jobId, ok, error?}`.
- **D6. Autorización.** `GET /jobs/review` y `POST /jobs/review/resolve` usan la misma regla que `GET /jobs/summary` y `POST /jobs/reassign` respectivamente (admin o líder de la campaña; con `v4-enforce-permissions`, `ana:team:jobs:view`/`manage`).
- **D7. ANA Admin.** El BFF llama v4 con el token del usuario. El detalle de carga v4 filtra por `srcKey` (el historial de `add-contact-upload-console` lo guarda); destinos de "Reenviar a…" = agentes habilitados del roster v4 (`GET /admin/agent-roster`). La confirmación dice: "Este contacto pudo haber recibido el mensaje. Reenviarlo puede duplicarlo."

## Risks / Trade-offs

- [Falsos "por revisar" por fallas de red del ack] → Reintentos del ack; el costo es una revisión manual, no un reenvío.
- [Reloj del backend vs `claimedAt`] → Ambos los fija el backend (`Date.now()` en Lambda).
- [Desktops viejos no reservan] → Siguen con el riesgo actual hasta actualizarse; `v4-fix-desktop-session-lifecycle` fuerza la actualización.

## Migration Plan

1. Deploy backend (dev, prod): rutas nuevas; poll/ack compatibles con desktops viejos. 2. Release del desktop. 3. Deploy de ANA Admin con la sección. Rollback: el desktop actual solo aprueba jobs sin estado, `pending` o `leased`, así que nunca envía jobs `sending`/`review` (los oculta); revertir el desktop es seguro y el backend nuevo se mantiene.
