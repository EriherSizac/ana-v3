# Design

## Context

- `insertInteraction` recibe `at: new Date()` y usa `getHours()`/`getMinutes()` y `toISOString().slice(0,10)`; en Lambda el proceso corre en UTC.
- `POST /interactions/report` hace `PutCommand` condicional (`attribute_not_exists(jobId)`) del marcador `REPORT#<user>` y luego llama al CRM; `POST /interactions/open` igual con `OPEN#<user>` / `<chatId>#<YYYY-MM-DD UTC>`.
- El desktop llama `reportInteraction` en modo fire-and-forget y no reintenta.
- Ciudad de México no tiene horario de verano desde 2022; aun así se usa la base de datos de zonas (`Intl`) y no un offset fijo.

## Goals / Non-Goals

**Goals:** fecha/hora correctas en el CRM; ninguna interacción de reporte o apertura perdida por un fallo transitorio; sin duplicados por reintentos.

**Non-Goals:** reprocesar interacciones históricas; idempotencia de extremo a extremo con el CRM (el CRM no ofrece clave de idempotencia; queda una ventana de duplicado si el CRM inserta y la respuesta se pierde).

## Decisions

- **D1. Helper único `mxDateParts(at)`** con `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', hourCycle: 'h23', ... })` que devuelve `{ date: 'YYYY-MM-DD', time: 'HH:MM', range: 'HH:00 - HH+1:00' }`, con `23:00 - 00:00`. Lo usan `insertInteraction` y el día del marcador de apertura. Alternativa: fijar `TZ=America/Mexico_City` en la Lambda; se descarta porque cambia silenciosamente cualquier otro cálculo de fecha del backend (TTL, `sentAt`).
- **D2. Marcador con estados.** `claim(pk, sk, ttl)`: `PutCommand` con `ConditionExpression: attribute_not_exists(jobId) OR (#s = :pending AND claimedAt < :stale) OR #s = :failed`, `status: 'pending'`, `claimedAt: now`. Éxito del CRM → `UpdateCommand` a `status: 'done'`. Fallo del CRM → `DeleteCommand` condicional a `status = pending AND claimedAt = :mine` (libera solo su propia reserva). Si la condición del `claim` falla, se lee el marcador: `done` (o sin `status`, compatibilidad) → "ya reportado"/"ya registrado hoy"; `pending` vigente → `reason: "en curso"`. `stale` = 2 minutos (mayor que el timeout de 29 s de la Lambda).
- **D3. Qué cuenta como éxito.** La inserción de la interacción. El `PATCH /phone` de `no_whatsapp` es secundario: si falla se registra en logs y el marcador queda `done` igualmente (reintentar duplicaría la interacción).
- **D4. Reintento en el desktop.** `reportInteraction` reintenta si la respuesta trae `retryable: true`, es 5xx o falla la red: esperas de 30 s, 2 min y 10 min, en un temporizador independiente del ritmo de envío y solo en memoria (si la app se cierra, el reporte pendiente se pierde; se acepta y se documenta). 401 sigue el flujo de renovación de token de `v4-fix-desktop-session-lifecycle` si ya está desplegado.
- **D5. Gestión manual.** `requestId` (UUID v4 creado al abrir el modal) → marcador `MANUAL#<user>` / `<requestId>` (TTL 2 días) con el mismo `claim`. Sin `requestId`, comportamiento actual (sin idempotencia) para desktops viejos.

## Risks / Trade-offs

- [El CRM inserta pero la respuesta se pierde (timeout)] → El marcador se libera y el reintento duplica. Se acepta: es raro y preferible a perder la interacción; se mide con logs `evt:"crm_insert_timeout"`.
- [Reportes de interacciones con fecha "del día siguiente" ya existentes] → Se documenta en `v4/CAMPANAS_Y_ASIGNACION.md` el criterio: interacciones v4 con `contact_time` ≥ `00:00` y < `06:00` registradas antes del despliegue corresponden a 18:00–23:59 del día anterior en México (hora y fecha UTC).

## Migration Plan

1. Desplegar backend (compatible con desktops viejos). 2. Release del desktop con reintento y `requestId`. Rollback: redeploy de la versión anterior del backend; los marcadores nuevos con `status` son leídos por el código viejo como existentes ("ya reportado"), sin pérdida adicional.

## Decisiones de implementación

- **`withMarker` común** en `handlers/interactions.ts` aplica `claim` → inserción → `confirm`/`release` a los tres endpoints; si la inserción lanza excepción también se libera la reserva antes de responder 500.
- **Condiciones**: `confirm` exige `claimedAt = :mine` (no confirma una reserva ajena); `release` exige `status = pending AND claimedAt = :mine`. Si el `Put` de `claim` falla por condición y el `Get` no encuentra el marcador (otra invocación lo liberó entre ambos), se reintenta el `claim` una vez; si vuelve a fallar se responde "en curso".
- **Respuestas**: además de las del spec, la de fallo del CRM incluye `creditId` junto a `reported:false, retryable:true`. `requestId` se valida con `^[A-Za-z0-9-]{8,64}$` (UUID u otro id razonable); otro valor → 400 `requestId inválido`.
- **Desktop**: `Backend.reportInteraction` hace el primer intento inline (como antes, sin bloquear el ritmo porque `runJob` no lo espera) y programa los reintentos con `setTimeout` (inyectable en pruebas). 4xx no se reintenta; un error de red o falta momentánea de sesión sí.
- **Gestión manual**: el modal genera `crypto.randomUUID()` al montarse; si el backend responde `retryable`, `reportManualInteraction` lanza "El CRM no respondió; intenta de nuevo." y el modal queda abierto para reintentar con el mismo `requestId`.
- **Pruebas**: `src/lib/__tests__/fakeJobsTable.ts` simula en memoria las condiciones exactas usadas por `idempotency.ts` sobre `aws-sdk-client-mock`, para probar los escenarios completos del spec.
- La verificación manual de 3.2 (doble clic en dev con logs) y el despliegue/release (5.x) quedan pendientes.
