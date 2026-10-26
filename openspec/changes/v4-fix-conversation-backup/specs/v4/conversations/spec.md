# Spec Delta

## MODIFIED Requirements

### Requirement: Listado de conversaciones
`GET /conversations` SHALL responder 200 `{"conversations":[...],"nextToken"?}` con una página de la partición del operador objetivo ordenada por `lastMessageTime` descendente (ausente = 0), de `limit` items (default 100, máximo 200), y `nextToken` mientras queden más; con `nextToken` MUST devolver la página siguiente sin repetir items. Requiere `ana:chats:conversation:view` (sujeto al flag de enforcement).

#### Scenario: Listado propio
- **WHEN** un agente llama `GET /conversations` sin parámetros
- **THEN** recibe sus conversaciones, la más reciente primero

#### Scenario: Partición grande
- **WHEN** un agente tiene 450 conversaciones y pide páginas de 200
- **THEN** recibe 200, 200 y 50 conversaciones en tres llamadas, la última sin `nextToken`

### Requirement: Historial de mensajes
`GET /conversations/{chatId}/messages` SHALL responder 200 `{"chatId","messages":[...],"nextToken"?}` con los `limit` mensajes más recientes (default 200, máximo 500) de `convKey` del operador objetivo en orden ascendente de `sk`, y `nextToken` si hay anteriores; con `nextToken` MUST devolver la página anterior. Sin `chatId` MUST responder 400 `{"error":"falta chatId"}`.

#### Scenario: Chat sin mensajes
- **WHEN** se pide el historial de un `chatId` sin respaldo
- **THEN** el sistema responde 200 con `messages: []`

#### Scenario: Chat largo
- **WHEN** un chat tiene 700 mensajes y se pide sin `limit`
- **THEN** la respuesta trae los 200 más recientes en orden ascendente y un `nextToken` para los anteriores

### Requirement: Resumen de conversación al recibir mensaje
En cada `PUT /messages` que guarda un mensaje nuevo, el sistema SHALL actualizar (o crear) la conversación con `lastMessage = body` y `lastMessageTime = timestamp` solo si ese `timestamp` es igual o posterior al guardado, y sumar 1 a `unreadCount` si `fromMe` es falso. Si el mensaje ya existía, la conversación MUST quedar sin cambios.

#### Scenario: Mensaje entrante
- **WHEN** se respalda un mensaje con `fromMe: false`
- **THEN** la conversación queda con ese texto como `lastMessage` y `unreadCount` incrementado en 1

#### Scenario: Reintento del mismo mensaje
- **WHEN** el desktop reenvía un mensaje entrante ya respaldado
- **THEN** `unreadCount`, `lastMessage` y `lastMessageTime` no cambian

#### Scenario: Mensaje viejo que llega tarde
- **WHEN** se respalda un mensaje con `timestamp` anterior al `lastMessageTime` guardado
- **THEN** el mensaje se guarda pero `lastMessage` y `lastMessageTime` conservan el más reciente

> Nota: `PUT /messages` no verifica `ana:chats:message:reply`.

## ADDED Requirements

### Requirement: Marcar conversación como leída
`POST /conversations/{chatId}/read` SHALL poner `unreadCount` en 0 en la conversación del propio operador del JWT (nunca en la de otro, aunque se envíe `operatorId`) y responder 200 `{"ok":true}`, también si la conversación no existe, sin crearla.

#### Scenario: Agente abre un chat con no leídos
- **WHEN** el agente marca como leída una conversación con `unreadCount: 3`
- **THEN** la conversación queda con `unreadCount: 0`

#### Scenario: Intento sobre otro operador
- **WHEN** un admin llama la ruta con `?operatorId=agente1`
- **THEN** solo se afecta la conversación del propio admin, si existe
