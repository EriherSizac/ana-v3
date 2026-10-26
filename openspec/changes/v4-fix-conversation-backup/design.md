# Design

## Context

- `putMessage`: `PutCommand` condicional (`attribute_not_exists(sk)`) que ignora `ConditionalCheckFailed` y luego, siempre, `UpdateCommand` `SET lastMessage, lastMessageTime ADD unreadCount :u`.
- `listConversations`: un `QueryCommand` sin paginar y `sort` en memoria. `listMessages`: un `QueryCommand` ascendente sin paginar.
- `ConversationsTable` (PK `operatorId`, SK `chatId`) no tiene índices; las LSI no se pueden agregar a una tabla existente, un GSI sí.
- whatsapp-web.js emite `message` solo para entrantes y `message_create` para todos los creados (incluidos los propios desde cualquier dispositivo).

## Goals / Non-Goals

**Goals:** contadores y "último mensaje" correctos ante reintentos; listados completos y paginados; historial que incluya lo enviado desde el teléfono.

**Non-Goals:** sincronizar el historial anterior a la conexión del desktop; marcar como leído en WhatsApp (solo en el respaldo).

## Decisions

- **D1. Resumen condicionado.** Si el `Put` del mensaje falla por condición, no se toca la conversación. Si fue nuevo: `UpdateCommand` con `SET lastMessage = :b, lastMessageTime = :t` condicionado a `attribute_not_exists(lastMessageTime) OR lastMessageTime <= :t`, y `ADD unreadCount :one` solo para entrantes en una segunda actualización sin condición (un entrante viejo que llega tarde sí cuenta como no leído). Alternativa: transacción única; se descarta porque la condición del resumen no debe impedir contar el no leído.
- **D2. GSI `operator-recent-index`** (`operatorId` HASH, `lastMessageTime` RANGE numérico, proyección `ALL`; la conversación es pequeña). `listConversations` consulta el índice con `ScanIndexForward: false`, `Limit` = `limit` (default 100, máx. 200) y `nextToken` = `LastEvaluatedKey` en base64url. `putConversationMeta` agrega `lastMessageTime = if_not_exists(lastMessageTime, :zero)`.
- **D3. Mensajes.** `ScanIndexForward: false`, `Limit` (default 200, máx. 500), se invierte la página para responder ascendente y `nextToken` apunta a los anteriores. Sin `limit` se usa el default (cambio de comportamiento solo para chats con más de 200 mensajes, que hoy podían truncarse sin aviso a 1 MB).
- **D4. `POST /conversations/{chatId}/read`.** `UpdateCommand` `SET unreadCount = :zero` condicionado a `attribute_exists(chatId)` en la partición propia (nunca con `operatorId` ajeno); 200 `{ok:true}` también si no existe.
- **D5. Mensajes propios de otros dispositivos.** `client.on('message_create')` con `fromMe` verdadero: se normaliza igual que los entrantes y se persiste con `PUT /messages`. Los enviados por la app también disparan `message_create`; el `id` es el mismo que la app ya persistió, así que el `Put` condicional lo ignora y D1 evita efectos en el resumen. La media propia de otro dispositivo se respalda con el mismo flujo que la entrante.

## Risks / Trade-offs

- [Creación del GSI en una tabla grande] → Backfill en línea sin downtime; el código nuevo se despliega cuando el índice está `ACTIVE` (dos despliegues).
- [Doble escritura de mensajes propios] → Idempotente por `sk`; costo de una escritura condicional extra por mensaje enviado.

## Migration Plan

1. Deploy A: GSI. 2. Deploy B: código. 3. Release del desktop. Rollback del código: los desktops nuevos siguen funcionando con respuestas sin `nextToken` (no muestran "Cargar más").
