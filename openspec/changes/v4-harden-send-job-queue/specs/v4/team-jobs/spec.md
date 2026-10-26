# Spec Delta

## MODIFIED Requirements

### Requirement: Resumen de pendientes por agente
`GET /jobs/summary?campaign=` SHALL requerir `campaign` (400 `{"error":"falta campaign"}`), leer paginadamente los jobs de la campaña en el índice por campaña, descartar los de `ttl` vencido y los que no sean `pending` (incluidos sin estado y `leased`), y responder 200 `{campaign,total,operators:[{operatorId,pending,leased,files}]}`, donde `files` lista los identificadores de carga distintos y `leased` MUST ser siempre 0 (se conserva por compatibilidad).

#### Scenario: Dos agentes con pendientes
- **WHEN** la campaña tiene 10 jobs pendientes de `a1` de un archivo y 4 de `a2` de dos archivos
- **THEN** `total` es 14 y `operators` trae `a1` con `pending: 10` y `a2` con `pending: 4` y dos `files`

#### Scenario: Historial no cuenta
- **WHEN** `a1` tiene 10 jobs `sent` y 2 `pending` vigentes en la campaña
- **THEN** el resumen muestra `a1` con `pending: 2`

### Requirement: Reasignación de pendientes
`POST /jobs/reassign` con `{campaign,from,to}` SHALL requerir los tres campos (400 `{"error":"faltan campaign/from/to"}`) y `from` ≠ `to` (400 `{"error":"from y to son el mismo operador"}`). Cada job `pending` de `from` en la campaña MUST borrarse y recrearse en `to` con `status: "pending"` en una transacción condicionada a que siga pendiente, procesando en paralelo con un presupuesto de 25 s. Responde 200 `{campaign,from,to,moved,skipped,skippedLeased,partial}`.

#### Scenario: Agente caído
- **WHEN** el líder mueve los pendientes de `a1` a `a2`
- **THEN** los jobs pasan a la partición de `a2`, `a1` deja de recibirlos en su poll y la respuesta indica cuántos se movieron

#### Scenario: Carrera con el agente origen
- **WHEN** un job de `a1` cambia a `sent` mientras se reasigna
- **THEN** la transacción de ese job falla, el job se queda en `a1` y se suma a `skipped`

#### Scenario: Historial no se mueve
- **WHEN** `a1` tiene jobs ya enviados en la campaña
- **THEN** esos jobs no se intentan mover ni se cuentan en `skipped`

#### Scenario: Muchos pendientes
- **WHEN** mover todos los pendientes excedería el presupuesto de tiempo
- **THEN** la respuesta trae `partial: true` con los movidos hasta ese momento y una nueva llamada mueve el resto

> Nota: `to` no se valida como agente de la campaña; los jobs movidos conservan `jobId`, `srcKey` y `auto`. `skippedLeased` es igual a `skipped`.
