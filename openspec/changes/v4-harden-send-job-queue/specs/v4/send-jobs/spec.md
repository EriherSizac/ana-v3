# Spec Delta

## MODIFIED Requirements

### Requirement: Tabla de jobs
El sistema SHALL guardar los jobs en `ana-backend-jobs-<stage>` con clave `operatorId` (HASH) + `jobId` (RANGE), TTL nativo sobre `ttl` (epoch s, 7 días desde la creación) y un GSI disperso por campaña (`campaign` + `operatorId`) que proyecte al menos `campaignId`, `srcKey`, `status`, `sentAt` y `ttl`. Los estados MUST ser `pending`, `sent`, `no_whatsapp` y `error`; un job sin estado o con el estado heredado `leased` SHALL tratarse como `pending`. No se asigna lease.

#### Scenario: Job sin campaña
- **WHEN** se crea un job sin atributo `campaign`
- **THEN** el job existe en la tabla base pero no aparece en el índice por campaña

#### Scenario: Estado visible en el índice
- **WHEN** un job de `didi_vip` pasa a `sent`
- **THEN** la consulta del índice por campaña devuelve ese job con `status: "sent"`

> Nota: la misma tabla aloja marcadores de idempotencia (`REPORT#`, `OPEN#`, `UPLOAD#` y otros) cuyo `operatorId` nunca coincide con un username; el TTL de DynamoDB borra con retraso, por lo que pueden leerse jobs ya vencidos.

### Requirement: Descarga de jobs del propio operador
`GET /jobs/poll` SHALL consultar solo la partición `operatorId` del JWT (hasta 10 000 items) y responder 200 `{"jobs":[{"id","job"}],"truncated","pendingTotal","historyTotal"}` con todos los jobs no finales hasta 2000, en orden de `jobId`, y los 300 finales (`sent`, `no_whatsapp`, `error`) más recientes por `sentAt`. `truncated` MUST ser verdadero si quedaron jobs no finales fuera o la partición excedió el límite. No modifica jobs.

#### Scenario: Agente con pendientes e historial
- **WHEN** un agente tiene 3 jobs `pending` y 5 `sent` vigentes
- **THEN** la respuesta contiene los 8 jobs con `truncated: false`

#### Scenario: Aislamiento entre agentes
- **WHEN** el agente A llama `GET /jobs/poll`
- **THEN** nunca recibe jobs con `operatorId` del agente B

#### Scenario: Mucho historial
- **WHEN** un agente tiene 2500 jobs enviados y 40 pendientes nuevos
- **THEN** la respuesta incluye los 40 pendientes y los 300 enviados más recientes, con `historyTotal: 2500`

#### Scenario: Demasiados pendientes
- **WHEN** un agente tiene 3000 jobs pendientes
- **THEN** la respuesta trae 2000 pendientes, `pendingTotal: 3000` y `truncated: true`

### Requirement: Reporte de resultado (ack)
`POST /jobs/ack` SHALL aceptar `{"acks":[{"jobId","status"}]}` o, por compatibilidad, `{"ids":[...]}` (todos como `sent`). Para cada job existente de la partición del operador MUST fijar `status` (`sent`, `no_whatsapp` o `error`) y `sentAt` = epoch ms actual, sin borrarlo. Un estado distinto MUST rechazarse sin escribir. Responde 200 `{"acked":<jobs actualizados>,"notFound":[jobIds],"invalid":[jobIds]}`.

#### Scenario: Job sin WhatsApp
- **WHEN** el desktop envía `{"acks":[{"jobId":"c1#4","status":"no_whatsapp"}]}`
- **THEN** el job queda con `status: "no_whatsapp"` y `sentAt` y sigue visible en el historial del poll

#### Scenario: Ack de job inexistente o ajeno
- **WHEN** el `jobId` no existe en la partición del operador (expirado, reasignado o de otro agente)
- **THEN** no se crea ningún item, `acked` no lo cuenta y aparece en `notFound`

#### Scenario: Estado inválido
- **WHEN** el desktop envía `{"acks":[{"jobId":"c1#5","status":"enviado"}]}`
- **THEN** el job no cambia y aparece en `invalid`
