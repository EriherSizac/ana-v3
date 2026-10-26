# send-jobs Specification

## Purpose
Definir la cola de send-jobs del backend v4: la tabla DynamoDB particionada por operador donde el CSV de campaña y el envío directo depositan mensajes por enviar, y las rutas con las que la app de escritorio de cada agente los descarga (`GET /jobs/poll`) y reporta su resultado (`POST /jobs/ack`), conservando el historial 7 días.

> Nota: `ARCHITECTURE.md`, `ARQUITECTURA_FLUJOS.md` y `CONTEXT.md` describen un lease de hasta 10 jobs por poll y que `ack` borra los jobs; el código actual no aplica lease (devuelve todos los jobs del operador) y `ack` solo cambia el estado. El estado `leased` y el lease de 60 s están definidos en el modelo pero nada los asigna.

## Requirements

### Requirement: Tabla de jobs
El sistema SHALL guardar los jobs en `ana-backend-jobs-<stage>` con clave `operatorId` (HASH) + `jobId` (RANGE), TTL nativo sobre el atributo `ttl` (epoch en segundos, 7 días desde la creación) y un GSI disperso `campaign-index` (`campaign` + `operatorId`, proyección INCLUDE de `campaignId`, `leaseUntil`, `ttl`). Los estados válidos MUST ser `pending`, `leased`, `sent`, `no_whatsapp` y `error`.

#### Scenario: Job sin campaña
- **WHEN** se crea un job sin atributo `campaign`
- **THEN** el job existe en la tabla base pero no aparece en `campaign-index`

> Nota: la misma tabla aloja marcadores de idempotencia del CRM con `operatorId` `REPORT#<usuario>` y `OPEN#<usuario>`; el TTL de DynamoDB borra con retraso, por lo que pueden leerse jobs ya vencidos.

### Requirement: Descarga de jobs del propio operador
`GET /jobs/poll` SHALL consultar solo la partición `operatorId` del JWT, paginando hasta acumular al menos 2000 items o agotar la partición, y responder 200 `{"jobs":[{"id":<jobId>,"job":<item completo>}]}` incluyendo pendientes e historial (`sent`, `no_whatsapp`, `error`). MUST NOT modificar los jobs ni asignar lease.

#### Scenario: Agente con pendientes e historial
- **WHEN** un agente tiene 3 jobs `pending` y 5 `sent` vigentes
- **THEN** la respuesta contiene los 8 jobs y el desktop separa pendientes de procesados

#### Scenario: Aislamiento entre agentes
- **WHEN** el agente A llama `GET /jobs/poll`
- **THEN** nunca recibe jobs con `operatorId` del agente B

> Nota: con más de ~2000 items en la partición la lista se trunca sin indicarlo; como el historial cuenta, un agente con mucho historial puede no ver pendientes nuevos. El orden es el de la clave (`jobId`), no cronológico.

### Requirement: Reporte de resultado (ack)
`POST /jobs/ack` SHALL aceptar `{"acks":[{"jobId","status"}]}` o, por compatibilidad, `{"ids":[...]}` (todos como `sent`). Para cada job de la partición del operador MUST fijar `status` (`sent`, `no_whatsapp` o `error`; cualquier otro valor se trata como `sent`), `sentAt` = epoch ms actual y eliminar `leaseUntil`, sin borrar el job. Responde 200 `{"acked":<n>}`.

#### Scenario: Job sin WhatsApp
- **WHEN** el desktop envía `{"acks":[{"jobId":"c1#4","status":"no_whatsapp"}]}`
- **THEN** el job queda con `status: "no_whatsapp"` y `sentAt` y sigue visible en el historial del poll

#### Scenario: Ack de job inexistente o ajeno
- **WHEN** el `jobId` no existe en la partición del operador (expirado, reasignado o de otro agente)
- **THEN** no se crea ningún item y el job se cuenta igual en `acked`

> Nota: `acked` es el número de elementos recibidos, no de jobs actualizados; tras `REMOVE leaseUntil` el job ya no tiene ese atributo.

### Requirement: Retención del historial
Los jobs procesados SHALL permanecer en la tabla hasta su `ttl` (7 días desde la creación del job, no desde el envío) y MUST eliminarse automáticamente por el TTL de DynamoDB.

#### Scenario: Job antiguo
- **WHEN** pasan más de 7 días desde que se creó un job pendiente que nunca se envió
- **THEN** el job expira y deja de entregarse en el poll una vez que DynamoDB lo borra
