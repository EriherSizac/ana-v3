# crm-interactions Specification

## Purpose
Registrar desde el backend v4 en la API de interacciones del CRM de Pernexium el resultado de cada envío de campaña, la apertura de chats y las gestiones manuales de los agentes, resolviendo el `credit_id` del contacto y manteniendo la API key del CRM solo en el backend.

> Nota: todas las interacciones se registran con un único `user_id` del CRM (`INTERACTIONS_USER_ID`) sin importar qué agente las genera, y la fecha/hora (`contact_date`, `contact_time`, `range_time`) se calcula en la zona horaria de la Lambda (UTC), no en hora de México.

## Requirements

### Requirement: Resolución de credit_id
El sistema SHALL tomar `credit_id` de la primera columna no vacía entre `credit`, `credito`, `credit_id` e `id_credito` de la fila; si no hay, MUST buscarlo con `POST {INTERACTIONS_API_BASE}/client-info` (`campaign_name`, `search_type: "Telefono"`, teléfono en formato `+52XXXXXXXXXX`), reintentando sin `+52` ante 404, y usar `""` si no se encuentra o falla.

#### Scenario: CRM guarda teléfonos sin prefijo
- **WHEN** la búsqueda con `+525512345678` responde 404 y con `5512345678` encuentra al cliente
- **THEN** se usa el `credit_id` del primer resultado

### Requirement: Forma de la interacción enviada al CRM
El sistema SHALL enviar `POST {INTERACTIONS_API_BASE}/interactions` con `{"interactions":[...]}` y header `X-Api-Key`, incluyendo `credit_id`, `campaign_name`, `user_id`, `subdictamen`, `contact_date`, `contact_time` (`HH:MM`), `range_time` (`HH:00 - HH+1:00`), `action_channel` y `action` `whatsapp`, `contactable`, `phone_number` (últimos 10 dígitos), `comments`, promesa de pago e `inoutbound` (default `outbound`).

#### Scenario: CRM rechaza la interacción
- **WHEN** la API del CRM responde no-2xx
- **THEN** el registro se considera no realizado (`reported: false`) sin error HTTP para el cliente

> Nota: se inserta la interacción aunque `credit_id` sea `""`.

### Requirement: Reporte de resultado de envío
`POST /interactions/report` con `{jobId, campaign, phone, status, row?}` SHALL requerir `jobId`, `phone` y `status` (400 `{"error":"faltan jobId/phone/status"}`); sin `campaign` MUST responder 200 `{"reported":false,"reason":"sin campaña, no se registra"}`. Registra `subdictamen` "No tiene Whatsapp" si `status` es `no_whatsapp` o "Se envía WhatsApp" en otro caso, `contactable` = (`status` = `sent`) y `comments` con `product`, `discount` y `total_balance` de la fila.

#### Scenario: Envío exitoso
- **WHEN** el desktop reporta `status: "sent"` con una fila que trae `credito`
- **THEN** se inserta una interacción outbound "Se envía WhatsApp" contactable y la respuesta es `{"reported":true,"creditId":...,"phonePatched":false}`

> Nota: `status: "error"` también se registra como "Se envía WhatsApp" (no contactable); ni `jobId` ni `campaign` se validan contra los jobs o campañas del usuario.

### Requirement: Marcado de teléfono sin WhatsApp
Cuando `status` es `no_whatsapp` y se conocen `credit_id` y teléfono, el sistema SHALL enviar `PATCH {INTERACTIONS_API_BASE}/phone` con `credit_id`, `campaign_name`, `current_phone` (10 dígitos) y `phone: {has_whatsapp:false, whatsapp_contactable:false}`, reportando el resultado en `phonePatched`.

#### Scenario: Número sin WhatsApp
- **WHEN** se reporta `no_whatsapp` de un contacto con `credit_id` resuelto
- **THEN** el teléfono queda marcado sin WhatsApp en el CRM y `phonePatched` es `true`

### Requirement: Idempotencia del reporte por job
Antes de registrar, el sistema MUST escribir condicionalmente el marcador `{operatorId: "REPORT#<usuario>", jobId}` (TTL 7 días) en la tabla de jobs; si ya existe SHALL responder 200 `{"reported":false,"reason":"ya reportado"}` sin llamar al CRM.

#### Scenario: Reintento del desktop
- **WHEN** el desktop reporta dos veces el mismo `jobId`
- **THEN** solo la primera llamada inserta la interacción

> Nota: el marcador se escribe antes de llamar al CRM; si la inserción falla, el reintento responde "ya reportado" y la interacción se pierde.

### Requirement: Registro al abrir un chat
`POST /interactions/open` con `{chatId}` SHALL requerir `chatId` (400 `{"error":"falta chatId"}`), leer `campaign` y `contact` de la conversación del operador (sin campaña: 200 `{"reported":false,"reason":"conversación sin campaña"}`) y registrar una vez por chat y día UTC (marcador `OPEN#<usuario>` / `<chatId>#<YYYY-MM-DD>`, TTL 2 días) una interacción inbound "Atención WhatsApp" contactable.

#### Scenario: Segunda apertura el mismo día
- **WHEN** el agente abre el mismo chat dos veces en el día
- **THEN** la segunda llamada responde `{"reported":false,"reason":"ya registrado hoy"}`

#### Scenario: Teléfono desde el chatId
- **WHEN** el contacto guardado no trae `phone` ni `telefono`
- **THEN** se usan los dígitos del `chatId` (p. ej. `5215513023544@c.us`) para el teléfono y la búsqueda de crédito

### Requirement: Gestión manual
`POST /interactions/manual` con `{chatId, subdictamen, comments?, contactable?, promiseDate?, promiseAmount?}` SHALL requerir `chatId` (400 `{"error":"falta chatId"}`) y `subdictamen` (400 `{"error":"falta subdictamen (resultado)"}`); si la conversación no tiene campaña MUST responder 409 `{"error":"conversación sin campaña; no se puede registrar"}`. Registra una interacción inbound (`contactable` default `true`) sin idempotencia.

#### Scenario: Promesa de pago
- **WHEN** el agente registra `{"chatId":"...","subdictamen":"Promesa de pago","promiseDate":"2026-11-01","promiseAmount":1500}`
- **THEN** se inserta una interacción con `promise_date` y `promise_amount` y la respuesta es `{"reported":true,"creditId":...}`

> Nota: `subdictamen` es texto libre, no se valida contra un catálogo del CRM.
