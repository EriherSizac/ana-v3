# team-jobs Specification

## Purpose
Dar a líderes y administradores una vista de los send-jobs pendientes por agente dentro de una campaña y la capacidad de mover los pendientes de un agente a otro (por ejemplo, cuando un agente se desconecta a media campaña), usando el índice `campaign-index` de la tabla de jobs.

## Requirements

### Requirement: Autorización por campaña
`GET /jobs/summary` y `POST /jobs/reassign` MUST permitirse a administradores para cualquier campaña y a líderes solo para campañas propias (o si tienen `*`), sin depender de `PERMISSIONS_ENFORCED`; en otro caso responden 403 `{"error":"sin permiso"}`.

#### Scenario: Líder de otra campaña
- **WHEN** un líder de `didi_vip` pide `GET /jobs/summary?campaign=bancoppel`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

#### Scenario: Usuario con grant pero sin rol de líder
- **WHEN** un usuario no líder con `ana:team:jobs:view` explícito pide el summary de su campaña
- **THEN** el sistema responde 403, porque la ruta solo evalúa `isAdmin`/`isLeader`

### Requirement: Resumen de pendientes por agente
`GET /jobs/summary?campaign=` SHALL requerir `campaign` (400 `{"error":"falta campaign"}`), leer paginadamente los jobs de la campaña en `campaign-index`, descartar los de `ttl` vencido y los que no estén en `pending`/`leased` o sin estado, y responder 200 `{campaign,total,operators:[{operatorId,pending,leased,files}]}`, donde `leased` cuenta jobs con `leaseUntil` futuro y `files` lista los `campaignId` distintos.

#### Scenario: Dos agentes con pendientes
- **WHEN** la campaña tiene 10 jobs pendientes de `a1` de un archivo y 4 de `a2` de dos archivos
- **THEN** `total` es 14 y `operators` trae `a1` con `pending: 10` y `a2` con `pending: 4` y dos `files`

> Nota: el atributo `status` no está proyectado en `campaign-index`, por lo que muy probablemente llega vacío y los jobs ya procesados (historial) se cuentan como pendientes hasta su TTL. `leased` es siempre 0 en la práctica porque nada asigna lease.

### Requirement: Reasignación de pendientes
`POST /jobs/reassign` con `{campaign,from,to}` SHALL requerir los tres campos (400 `{"error":"faltan campaign/from/to"}`) y que `from` ≠ `to` (400 `{"error":"from y to son el mismo operador"}`). Por cada job pendiente de `from` sin lease vigente, MUST borrarlo y recrearlo en la partición `to` con `status: "pending"` y `leaseUntil: 0` en una transacción atómica, y responder 200 `{campaign,from,to,moved,skippedLeased}`.

#### Scenario: Agente caído
- **WHEN** el líder mueve los pendientes de `a1` a `a2`
- **THEN** los jobs pasan a la partición de `a2`, `a1` deja de recibirlos en su poll y la respuesta indica cuántos se movieron

#### Scenario: Carrera con el agente origen
- **WHEN** la condición de la transacción falla para un job (no existe o `leaseUntil` es mayor que ahora o no existe el atributo)
- **THEN** el job se queda en `from` y se suma a `skippedLeased`

> Nota: `to` no se valida como agente de la campaña; los jobs movidos conservan `jobId`, `srcKey` y `auto`. Por la falta de `status` en el GSI, los jobs ya procesados también se intentan mover; como `ack` eliminó su `leaseUntil`, la condición falla y se cuentan en `skippedLeased`, inflando ese número. El procesamiento es secuencial y puede exceder el timeout de 29 s con muchos jobs.
