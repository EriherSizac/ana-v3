# Proposal

## Why

El respaldo de conversaciones de v4 tiene inconsistencias que afectan lo que el agente y el supervisor ven:

- `PUT /messages` actualiza el resumen de la conversación aunque el mensaje ya existiera: cada reintento (los que agrega `v4-fix-desktop-session-lifecycle` ante 401, o el reenvío de la media) **suma 1 a `unreadCount`** y un mensaje viejo puede pisar `lastMessage`/`lastMessageTime` más recientes. No existe forma de poner `unreadCount` en cero.
- `GET /conversations` y `GET /conversations/{chatId}/messages` no paginan: con más de 1 MB por partición se devuelve solo la primera página de DynamoDB, sin indicarlo; el listado además se ordena en memoria sobre esa página parcial.
- La lista del desktop no se refresca tras un envío de campaña y, si la carga falla, queda vacía sin aviso.
- Lo que el agente escribe desde su teléfono u otro dispositivo no se respalda (solo se escucha el evento de mensajes entrantes), así que el historial queda incompleto respecto a v3, que respalda la conversación completa.

## What Changes

- `PUT /messages` solo actualiza el resumen cuando el mensaje es nuevo, y `lastMessage`/`lastMessageTime` solo si el mensaje es igual o más reciente; los propios no tocan `unreadCount`.
- Nueva ruta `POST /conversations/{chatId}/read` que pone `unreadCount` en 0 (solo la partición propia); el desktop la llama al abrir un chat propio y muestra el conteo de no leídos.
- Paginación con `limit` y `nextToken` en el listado de conversaciones (ordenado en DynamoDB por un índice por `lastMessageTime`) y en el historial de mensajes (página más reciente primero, con mensajes anteriores bajo demanda).
- Desktop: "Cargar más" en la lista, "Ver mensajes anteriores" en el hilo, aviso y "Reintentar" si la lista falla, refresco tras un envío de campaña.
- Respaldo de los mensajes propios enviados desde otros dispositivos.
- Despliegue del backend (índice nuevo) antes del release del desktop; las rutas siguen aceptando llamadas sin `limit` (los desktops viejos reciben la primera página completa de hasta 200).

Fuera de alcance: recalcular `unreadCount` históricos inflados (se ponen en 0 la próxima vez que el agente abre el chat), búsqueda de conversaciones, permisos de respuesta (`v4-enforce-permissions`).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/conversations`: resumen solo con mensajes nuevos, listado y mensajes paginados; se agrega marcar como leída.
- `v4/desktop-chats`: lista con no leídos, "Cargar más" y error visible; refresco tras envío de campaña; se agregan mensajes anteriores y marcar como leída al abrir.
- `v4/whatsapp-session`: se agrega el respaldo de mensajes propios desde otros dispositivos.

## Impact

- Backend: `v4/backend/src/handlers/api.ts` (`putMessage`, `listConversations`, `listMessages`, `putConversationMeta`, ruta nueva), `serverless.yml` (GSI `operator-recent-index` en la tabla de conversaciones, ruta `POST /conversations/{chatId}/read`).
- Desktop: `src/routes/Chats.tsx`, `src/lib/api.ts`, `electron/whatsapp/client.ts` (evento `message_create`), `electron/main.ts`.
- Datos: el índice nuevo se llena solo; `putConversationMeta` deja `lastMessageTime: 0` si no existe para que la conversación aparezca en el índice.
