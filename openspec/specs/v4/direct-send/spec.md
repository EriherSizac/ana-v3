# direct-send Specification

## Purpose
Permitir que sistemas externos (CRM, dashboard, automatizaciones) encolen un mensaje de WhatsApp puntual para que lo envíe la app de escritorio de un agente concreto, mediante `POST /send` autenticado por API key, sin pasar por la aprobación manual de la asignación de campaña.

> Nota: el valor real de `SEND_API_KEY` está publicado en `v4/ENVIO_DIRECTO.md`; cualquiera con esa key puede enviar como cualquier agente. Ese documento también omite el error 400 por campaña inexistente.

## Requirements

### Requirement: Campos requeridos
`POST /send` (autenticado por `X-Api-Key`, ver `v4/api-auth`) SHALL aceptar `{message, username, phone, campaign, countryCode?, row?}` y MUST responder 400 `{"error":"faltan message/username/phone/campaign"}` si falta alguno de los cuatro primeros.

#### Scenario: Falta el agente
- **WHEN** se envía un body sin `username`
- **THEN** el sistema responde 400 `{"error":"faltan message/username/phone/campaign"}`

### Requirement: Validación de campaña
El sistema MUST rechazar con 400 `{"error":"la campaña \"<x>\" no existe"}` una `campaign` ausente del catálogo `SELECT name FROM campaigns`; si el catálogo no está disponible (lista vacía), SHALL aceptarla.

#### Scenario: Campaña inexistente
- **WHEN** se envía `campaign: "noexiste"` y el catálogo está disponible
- **THEN** el sistema responde 400 y no encola nada

### Requirement: Encolado de job automático
El sistema SHALL crear en la tabla de jobs un item en la partición `operatorId = username` con `jobId = "direct#<epochMs>#<dígitos de phone>"`, `campaignId = "direct-<campaign>"`, `campaign`, `phone` crudo, `template = message`, `row` (default `{}`), `countryCode` (default `52`), `srcKey: ""`, `status: "pending"`, `leaseUntil: 0`, `attempts: 0`, `ttl` a 7 días y `auto: true`, y responder 200 `{"queued":true,jobId,operatorId,campaign}`.

#### Scenario: Envío directo aceptado
- **WHEN** se envía `{"message":"Hola {nombre}","username":"agente1","phone":"5512345678","campaign":"bancoppel","row":{"nombre":"Ana"}}`
- **THEN** se encola un job `auto: true` para `agente1` y la respuesta trae `queued: true` y el `jobId`

#### Scenario: Agente offline
- **WHEN** el agente indicado no tiene la app abierta
- **THEN** el job queda pendiente en su partición hasta que lo descargue o expire a los 7 días

> Nota: `username` no se valida contra Cognito, la API de roles ni la campaña; un username inexistente deja el job huérfano hasta su TTL. Dos envíos al mismo teléfono y agente en el mismo milisegundo comparten `jobId` y el segundo sobrescribe al primero. `queued: true` significa aceptado, no entregado; no hay callback de resultado.
