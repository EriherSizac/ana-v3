# Spec Delta

## MODIFIED Requirements

### Requirement: Encolado de job automático
El sistema SHALL crear en la tabla de jobs un item en la partición del agente validado con `jobId = "direct#<epochMs>#<dígitos de phone>#<sufijo aleatorio de 8 hex>"`, `campaignId = "direct-<campaign>"`, `campaign`, `phone` crudo, `template = message`, `row` (default `{}`), `countryCode` (default `52`), `srcKey: ""`, `status: "pending"`, `leaseUntil: 0`, `attempts: 0`, `ttl` a 7 días y `auto: true`, y responder 200 `{"queued":true,jobId,operatorId,campaign}`.

#### Scenario: Envío directo aceptado
- **WHEN** se envía `{"message":"Hola {nombre}","username":"agente1","phone":"5512345678","campaign":"bancoppel","row":{"nombre":"Ana"}}`
- **THEN** se encola un job `auto: true` para `agente1` y la respuesta trae `queued: true` y el `jobId`

#### Scenario: Agente offline
- **WHEN** el agente indicado no tiene la app abierta
- **THEN** el job queda pendiente en su partición hasta que lo descargue o expire a los 7 días

#### Scenario: Dos envíos en el mismo milisegundo
- **WHEN** llegan dos envíos al mismo teléfono y agente con el mismo `epochMs`
- **THEN** se crean dos jobs con `jobId` distintos y ninguno sobrescribe al otro

> Nota: `queued: true` significa aceptado, no entregado; no hay callback de resultado.

## ADDED Requirements

### Requirement: Clave de idempotencia opcional
`POST /send` SHALL aceptar `idempotencyKey` opcional (1 a 64 caracteres `[A-Za-z0-9_-]`; otro valor responde 400 `{"error":"idempotencyKey inválida"}`). Con clave, el `jobId` MUST ser `direct#key#<idempotencyKey>` y crearse solo si no existe; si ya existe, el sistema SHALL responder 200 con el mismo `jobId` y `duplicate: true` sin modificar el job.

#### Scenario: Reintento del integrador
- **WHEN** un integrador envía dos veces el mismo body con `idempotencyKey: "crm-123"`
- **THEN** existe un solo job y la segunda respuesta trae el mismo `jobId` con `duplicate: true`

### Requirement: Validación del agente destino
Antes de encolar, el sistema MUST verificar que `username` sea, sin distinguir mayúsculas, un agente elegible de `campaign` según la misma fuente y regla que el reparto de CSV, y escribir el job con el identificador que devuelve esa fuente. Si no lo es SHALL responder 400 `{"error":"el agente \"<username>\" no pertenece a la campaña"}`; si la fuente no responde, 503 `{"error":"no se pudo validar el agente"}`, sin encolar.

#### Scenario: Username inexistente
- **WHEN** se envía `username: "nadie"` para `bancoppel`
- **THEN** el sistema responde 400 y no se crea ningún job

#### Scenario: Fuente de agentes caída
- **WHEN** la API de agentes de la campaña falla
- **THEN** el sistema responde 503 y no se crea ningún job
