# Design

## Context

- `JobsTable`: PK `operatorId`, SK `jobId`, TTL `ttl`, GSI `campaign-index` (`campaign`/`operatorId`, INCLUDE `campaignId`, `leaseUntil`, `ttl`). DynamoDB no permite cambiar la proyección de un GSI existente y CloudFormation solo crea o borra un GSI por actualización.
- `presignCsv` firma `campaignid = payload.campaignId ?? key`; el desktop envía `<archivo>-<lada>`. `csvTrigger` escribe con `BatchWriteCommand` sin revisar `UnprocessedItems`.
- `jobsAdmin.reassign` itera jobs uno a uno con `TransactWrite` (delete+put) condicionado a `leaseUntil < :now`, condición que falla cuando `ack` eliminó `leaseUntil`.

## Goals / Non-Goals

**Goals:** conteos correctos para líderes; ninguna carga que pise otra; ningún job perdido o duplicado por el trigger; contrato de la cola documentado igual que el código.

**Non-Goals:** reservar jobs antes de enviar (cambio siguiente); paginación cliente de `GET /jobs/poll` (el desktop necesita la lista completa de pendientes para aprobar).

## Decisions

- **D1. Índice nuevo `campaign-status-index`** (`campaign` HASH, `operatorId` RANGE, INCLUDE `campaignId`, `srcKey`, `status`, `sentAt`, `ttl`, `label`). Nombre en la variable `JOBS_CAMPAIGN_INDEX` para cambiar sin tocar código. Alternativa: proyección `ALL`; se descarta por costo (la `row` completa de cada contacto se duplicaría).
- **D2. Sin lease.** El modelo de aprobación manual hace que un lease en el poll no tenga sentido (el agente ve y elige). Se documenta que el desktop recibe todo y que la protección contra reenvíos viene de los estados (y, con el cambio siguiente, de la reserva antes de enviar). `leaseUntil` deja de escribirse en jobs nuevos; `leased` existente = `pending`.
- **D3. Poll.** Se pagina la partición completa hasta 10 000 items; se separan no finales (`pending`, sin estado o `leased`) y finales; se devuelven los primeros 2000 no finales (orden de `jobId`, que agrupa por carga) y los 300 finales más recientes por `sentAt`; `{ jobs, truncated, pendingTotal, historyTotal }`. `truncated` si hubo más de 2000 no finales o la partición superó 10 000.
- **D4. Ack.** `UpdateCommand` condicionado a `attribute_exists(jobId)`; se cuentan los éxitos en `acked`, los `ConditionalCheckFailed` en `notFound`, y los estados fuera de `sent|no_whatsapp|error` van a `invalid` sin escribir. Compatibilidad: `{ids}` sigue significando `sent`.
- **D5. Identificador de carga.** `uploadId = <usuario>/<epochMs>_<filename saneado>` (la key sin el prefijo `csv-uploads/`) se firma como `campaignid`; el valor del cliente se firma como `label` (máx. 100 caracteres). `jobId = <uploadId>#<índice>`. Dos cargas nunca comparten `jobId` porque cada objeto de S3 tiene su propia key (dos cargas del mismo usuario y archivo en el mismo ms producirían la misma key y la segunda reemplazaría al objeto antes de procesarse: se acepta). Alternativa: UUID aleatorio; se descarta porque derivarlo de la key permite reconstruirlo desde `srcKey`.
- **D6. Trigger idempotente.** Antes de escribir jobs, `PutCommand` condicional del marcador `{operatorId: "UPLOAD#<srcKey>", jobId: "processed"}` (TTL 7 días); si existe, el evento se ignora (`evt:"csv_duplicate_event"`). `BatchWrite` con hasta 6 reintentos de `UnprocessedItems` (espera 100 ms × 2^n con jitter); si aún quedan, `evt:"csv_jobs_partial"` con conteos y se continúa (no se lanza error para que S3 no reintente y re-escriba). Errores de `csv-parse` → `evt:"csv_rejected","reason":"parse_error"` sin lanzar.
- **D7. Reasignación.** Se consultan los jobs `pending` del origen en el índice nuevo y se procesan en paralelo (concurrencia 10), cada uno con `TransactWrite` condicionado a `#s = :pending OR attribute_not_exists(#s) OR #s = :leased`; presupuesto de 25 s; al agotarse responde `partial: true` con `remaining`. `skippedLeased` se conserva en la respuesta como alias de `skipped` por compatibilidad con el desktop actual.

- **D8. Borrado del CSV en el trigger.** Los jobs llevan la `row` completa, así que el CSV no se necesita después de escribirlos. Se borra al final de una escritura completa; el borrado del desktop (`POST /uploads/delete`) queda como no-op inofensivo (404/403 ignorados) y se retira en un release posterior. Regla de ciclo de vida de 7 días en `CsvBucket` para cargas parciales o eventos perdidos. Alternativa: permitir que cualquier agente con jobs de la carga la borre; se descarta porque exige saber cuándo terminó toda la carga entre varias particiones.

## Risks / Trade-offs

- [Ventana entre pasos del despliegue] → Paso 1 solo agrega el índice (el código viejo sigue con el viejo); paso 2 cambia `JOBS_CAMPAIGN_INDEX` cuando el índice nuevo está `ACTIVE`; paso 3 borra el viejo. Rollback del paso 2: volver la variable al índice viejo.
- [Respuesta de poll grande (~2.3 MB)] → Debajo del límite de 6 MB de Lambda; se mide en dev con 2000 pendientes reales.
- [Jobs de cargas viejas con `campaignId` del cliente] → Siguen funcionando (el desktop agrupa por `srcKey`); vencen en ≤ 7 días.

## Migration Plan

1. Deploy A: agregar `campaign-status-index` (esperar `ACTIVE`, `aws dynamodb describe-table`).
2. Deploy B: código nuevo con `JOBS_CAMPAIGN_INDEX=campaign-status-index`.
3. Release del desktop (aviso de truncado).
4. Deploy C (≥ 1 día después, sin errores): retirar `campaign-index`.
