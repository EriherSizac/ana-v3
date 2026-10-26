# conversations Specification

## Purpose
Respaldar en DynamoDB las conversaciones y mensajes de WhatsApp de cada operador del desktop v4 y permitir restaurarlas: listado de conversaciones, historial de mensajes, alta idempotente de mensajes y metadatos de contacto/campaña por conversación, aislados por `operatorId`.

> Nota: la documentación (`ARCHITECTURE.md`) describe que un líder con `ana:chats:team:view` puede leer conversaciones de agentes de sus campañas; el código actual solo permite "ver como" a administradores.

## Requirements

### Requirement: Modelo de datos aislado por operador
El sistema SHALL guardar conversaciones en `ana-backend-conversations-<stage>` con clave `operatorId` (HASH) + `chatId` (RANGE) y mensajes en `ana-backend-messages-<stage>` con `convKey = "<operatorId>#<chatId>"` (HASH) + `sk = "<timestamp>#<msgId>"` (RANGE). Las escrituras MUST usar siempre el `operatorId` del JWT.

#### Scenario: Dos operadores con el mismo chat
- **WHEN** dos operadores respaldan mensajes del mismo `chatId`
- **THEN** quedan en particiones distintas y ninguno ve los del otro

### Requirement: Listado de conversaciones
`GET /conversations` SHALL responder 200 `{"conversations":[...]}` con los items de la partición del operador objetivo, ordenados por `lastMessageTime` descendente (ausente = 0). Requiere `ana:chats:conversation:view` (sujeto al flag de enforcement).

#### Scenario: Listado propio
- **WHEN** un agente llama `GET /conversations` sin parámetros
- **THEN** recibe sus conversaciones, la más reciente primero

> Nota: la consulta no pagina; si la partición excede 1 MB solo se devuelve la primera página, sin indicarlo.

### Requirement: Ver como otro operador
`GET /conversations` y `GET /conversations/{chatId}/messages` SHALL aceptar `?operatorId=`. Si coincide con el propio usuario o se omite, MUST leer la propia partición; si es otro operador, MUST permitirlo solo a administradores y responder 403 `{"error":"sin permiso"}` a cualquier otro usuario, incluidos líderes.

#### Scenario: Líder intenta ver a su agente
- **WHEN** un líder no admin llama `GET /conversations?operatorId=agente1`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

#### Scenario: Admin ve a un agente
- **WHEN** un admin llama `GET /conversations?operatorId=agente1`
- **THEN** recibe las conversaciones de `agente1`

### Requirement: Historial de mensajes
`GET /conversations/{chatId}/messages` SHALL responder 200 `{"chatId","messages":[...]}` con los mensajes de `convKey` del operador objetivo en orden ascendente de `sk`. Sin `chatId` MUST responder 400 `{"error":"falta chatId"}`.

#### Scenario: Chat sin mensajes
- **WHEN** se pide el historial de un `chatId` sin respaldo
- **THEN** el sistema responde 200 con `messages: []`

### Requirement: Alta idempotente de mensajes
`PUT /messages` SHALL requerir `chatId`, `id` y `timestamp` (si falta alguno responde 400 `{"error":"faltan chatId/id/timestamp"}`) y guardar solo campos de una lista blanca: `chatId`, `id`, `timestamp` numérico, `body` (string o ""), `fromMe`, `from`, `to`, `type` (default `chat`) y opcionales `mediaKey`, `mimetype`, `filename`. Un mensaje con el mismo `sk` MUST NOT sobrescribirse. Responde 201 `{"ok":true}`.

#### Scenario: Reintento del mismo mensaje
- **WHEN** el desktop envía dos veces el mismo mensaje (mismo `timestamp` e `id`)
- **THEN** el mensaje se guarda una sola vez y ambas llamadas responden 201

#### Scenario: Campos extra en el body
- **WHEN** el body incluye `operatorId: "otro"` o campos arbitrarios
- **THEN** se ignoran y el mensaje se guarda bajo el operador del JWT

### Requirement: Resumen de conversación al recibir mensaje
En cada `PUT /messages` el sistema SHALL actualizar (o crear) la conversación con `lastMessage = body`, `lastMessageTime = timestamp` y sumar 1 a `unreadCount` si `fromMe` es falso (0 si es verdadero).

#### Scenario: Mensaje entrante
- **WHEN** se respalda un mensaje con `fromMe: false`
- **THEN** la conversación queda con ese texto como `lastMessage` y `unreadCount` incrementado en 1

> Nota: la actualización se ejecuta también cuando el mensaje ya existía (reintento), por lo que `unreadCount` se infla con reintentos y un mensaje viejo puede pisar `lastMessage`/`lastMessageTime` más recientes. No existe ruta para poner `unreadCount` en cero. `PUT /messages` no verifica `ana:chats:message:reply`.

### Requirement: Metadatos de contacto por conversación
`PUT /conversations/meta` con `{chatId, campaign?, contact?}` SHALL guardar en la conversación del operador `campaign` (string, "" si falta) y `contact` (objeto, `{}` si falta) sin tocar `lastMessage`, y `contactName` = `contact.name`, `contact.nombre` o `first_name + last_name` si alguno existe. Sin `chatId` MUST responder 400 `{"error":"falta chatId"}`. Responde 200 `{"ok":true}`.

#### Scenario: Asociar contacto de campaña
- **WHEN** el desktop envía `{"chatId":"5215512345678@c.us","campaign":"didi_vip","contact":{"nombre":"Ana"}}`
- **THEN** la conversación queda con `campaign = "didi_vip"`, el objeto `contact` y `contactName = "Ana"`

> Nota: `campaign` no se valida contra las campañas del usuario ni contra el catálogo, y `contact` se guarda tal cual (sin lista blanca de campos).
