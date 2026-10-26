# Proposal

## Why

El backend v4 registra las interacciones del CRM con la fecha y hora de la Lambda (UTC): `contact_date` sale de `toISOString()` y `contact_time`/`range_time` de `getHours()`, que en Lambda también es UTC. Toda gestión en Ciudad de México queda 6 horas adelantada y, entre las 18:00 y las 23:59, con la fecha del día siguiente; el marcador diario de "apertura de chat" también corta el día a las 18:00 hora de México. Es el mismo defecto que `fix-interaction-date-timezone` corrige en el CLI v3, aquí peor porque también la hora está mal. Además, la idempotencia de `POST /interactions/report` escribe el marcador **antes** de llamar al CRM: si la inserción falla, el reintento responde "ya reportado" y la interacción se pierde para siempre; lo mismo pasa con la apertura de chat. Y una gestión manual enviada dos veces (doble clic, reintento) se registra dos veces.

## What Changes

- Fecha y hora de toda interacción (`contact_date`, `contact_time`, `range_time`) calculadas en `America/Mexico_City`, sin depender de la zona de la Lambda; el día del marcador de apertura de chat también es el día de México.
- Marcadores de idempotencia de reporte y apertura con estado: se reservan como `pending`, se marcan `done` solo tras una inserción exitosa y se liberan si el CRM falla; una reserva `pending` abandonada vence a los 2 minutos.
- La respuesta indica `retryable: true` cuando el CRM falló; el desktop reintenta el reporte de un job (hasta 3 intentos con espera creciente) sin frenar el ritmo de envío.
- Gestión manual con `requestId` opcional generado por el desktop por cada apertura del modal: dos envíos con el mismo `requestId` registran una sola interacción.
- Pruebas vitest con instantes fijos (franja 18:00–23:59, medianoche, 23:xx) y de las transiciones del marcador.
- Despliegue del backend y release del desktop.

Fuera de alcance: corregir interacciones ya registradas con fecha errónea (se documenta cómo identificarlas), el `user_id` único del CRM (`INTERACTIONS_USER_ID`), normalización de teléfonos (`v4-normalize-phone-mx`).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/crm-interactions`: idempotencia del reporte con marcador de estados; apertura de chat por día de México y con marcador liberable; se agregan la fecha/hora de México y la idempotencia opcional de la gestión manual.
- `v4/job-processing`: se agrega el reintento del reporte al CRM desde el desktop.

## Impact

- Backend: `v4/backend/src/lib/interactions.ts` (nuevo helper de fecha/hora con `Intl.DateTimeFormat`), `src/handlers/interactions.ts` (marcadores), nuevo `src/lib/idempotency.ts`; tabla de jobs sin cambios de esquema (los marcadores `REPORT#`/`OPEN#`/`MANUAL#` ganan `status`, `claimedAt`).
- Desktop: `electron/backend.ts` (`reportInteraction` con reintento), `src/routes/Chats.tsx` y `src/lib/api.ts` (`requestId` en "Registrar gestión").
- Compatibilidad: el backend acepta desktops viejos (sin `requestId`, sin reintento); los marcadores viejos sin `status` se tratan como `done`.
- Datos CRM: a partir del despliegue, las interacciones nuevas tienen fecha y hora de México.
