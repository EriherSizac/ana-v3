# Spec Delta

## MODIFIED Requirements

### Requirement: Tabla de jobs
El sistema SHALL guardar los jobs en `ana-backend-jobs-<stage>` con clave `operatorId` (HASH) + `jobId` (RANGE), TTL nativo sobre `ttl` (epoch s, 7 días desde la creación) y un GSI disperso por campaña (`campaign` + `operatorId`) que proyecte al menos `campaignId`, `srcKey`, `status`, `sentAt` y `ttl`. Los estados MUST ser `pending`, `sending`, `sent`, `no_whatsapp`, `error`, `review` y `discarded`; sin estado o con el heredado `leased` SHALL tratarse como `pending`. No se asigna lease.

#### Scenario: Job sin campaña
- **WHEN** se crea un job sin atributo `campaign`
- **THEN** el job existe en la tabla base pero no aparece en el índice por campaña

#### Scenario: Estado visible en el índice
- **WHEN** un job de `didi_vip` pasa a `sent`
- **THEN** la consulta del índice por campaña devuelve ese job con `status: "sent"`

> Nota: la misma tabla aloja marcadores de idempotencia (`REPORT#`, `OPEN#`, `UPLOAD#` y otros) cuyo `operatorId` nunca coincide con un username; el TTL de DynamoDB borra con retraso, por lo que pueden leerse jobs ya vencidos.

## ADDED Requirements

### Requirement: Reserva del job antes de enviar
`POST /jobs/claim` con `{jobId}` SHALL pasar un job `pending` (o sin estado, o `leased`) de la partición del operador a `sending` con `claimedAt` = epoch ms y `attempts` + 1, y responder 200 `{"claimed":true}`. Si el job no existe o está en otro estado MUST responder 409 `{"error":"job no disponible","status":<estado o null>}` sin modificarlo.

#### Scenario: Reserva exitosa
- **WHEN** el desktop reserva un job `pending` antes de enviarlo
- **THEN** el job queda `sending` con `claimedAt`

#### Scenario: Job reasignado mientras esperaba
- **WHEN** el líder movió el job a otro agente y el desktop intenta reservarlo
- **THEN** el sistema responde 409 y el desktop no envía ese mensaje

### Requirement: Envíos interrumpidos quedan por revisar
Un job `sending` cuyo `claimedAt` tenga más de 10 minutos MUST pasar a `review` con `reviewReason: "interrupted"` y `reviewAt` cuando lo lean `GET /jobs/poll` de su dueño, `GET /jobs/summary` o `GET /jobs/review`. Un job `review` o `discarded` SHALL NOT volver a `pending` salvo por una resolución de reencolado.

#### Scenario: App cerrada durante el envío
- **WHEN** el agente cierra la app después de reservar un job y antes del acuse, y la vuelve a abrir 15 minutos después
- **THEN** el job aparece como `review` y no se ofrece para enviar

### Requirement: Transiciones del acuse
`POST /jobs/ack` SHALL aceptar el resultado de un job en `pending`, `sending` o `review` y fijar el estado final; un acuse de un job `discarded` o ya final con otro estado MUST listarse en `invalid` sin escribir.

#### Scenario: Acuse tardío
- **WHEN** un job pasó a `review` y luego llega su acuse `sent`
- **THEN** el job queda `sent` y deja de estar por revisar

#### Scenario: Acuse de un descartado
- **WHEN** llega un acuse de un job que el supervisor ya descartó
- **THEN** el job sigue `discarded` y aparece en `invalid`

### Requirement: Jobs por revisar en el poll
`GET /jobs/poll` SHALL devolver los jobs `sending` y `review` del operador junto con los no finales y los `discarded` junto con los finales. Ninguno de ellos MUST tratarse como pendiente de envío.

#### Scenario: Agente con un interrumpido
- **WHEN** el agente tiene 5 pendientes y 1 job `review`
- **THEN** el poll trae los 6 y el desktop solo ofrece enviar los 5 pendientes

### Requirement: Consulta de jobs por revisar
`GET /jobs/review?campaign=<c>[&srcKey=<k>]` SHALL responder 200 `{"campaign","items":[{operatorId,jobId,srcKey,label,phone,row,claimedAt,reviewAt,status,resolution?,resolvedBy?,resolvedAt?}]}` con los jobs `review` y `discarded` vigentes de la campaña (o de esa carga), con la misma autorización que `GET /jobs/summary`. Sin `campaign` MUST responder 400 `{"error":"falta campaign"}`.

#### Scenario: Revisión de una carga
- **WHEN** un líder de `didi_vip` consulta `GET /jobs/review?campaign=didi_vip&srcKey=csv-uploads/lider/1_a.csv`
- **THEN** recibe solo los jobs por revisar o descartados de esa carga

#### Scenario: Campaña ajena
- **WHEN** un líder de `didi_vip` consulta `campaign=zendere`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

### Requirement: Resolución de jobs por revisar
`POST /jobs/review/resolve` con `{campaign, items:[{operatorId,jobId}], action, to?}` (1 a 100 items) SHALL, con la autorización de `POST /jobs/reassign`, aplicar a cada job en `review`: `discard` → `discarded`; `requeue` → `discarded` con `resolution:"requeued"` y un job `pending` nuevo en `to` (o el mismo agente) con la misma fila. MUST registrar `resolvedBy` y `resolvedAt` y responder 200 `{"results":[{jobId,ok,error?}]}`.

#### Scenario: Descartar
- **WHEN** el supervisor descarta un job por revisar
- **THEN** el job queda `discarded` con su username y fecha y no vuelve a enviarse

#### Scenario: Reencolar a otro agente
- **WHEN** el supervisor reencola un job por revisar de `a1` a `a2`
- **THEN** `a2` recibe un job `pending` nuevo con la misma fila y el original queda `discarded` con `resolution: "requeued"`

#### Scenario: Ya resuelto
- **WHEN** se intenta resolver un job que ya no está en `review`
- **THEN** ese item responde `ok: false` y no se crea ningún job
