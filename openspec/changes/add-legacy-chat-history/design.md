# Design

## Context

- `migrate-cli-to-cognito-login` (design.md D12) mueve, tras el modo estricto, los respaldos de `agent_id` legados de `backups/{campaign}/{agent}/{phone}/chat_backup.json` y `media/{campaign}/{agent}/...` a `legacy/backups/...` y `legacy/media/...`, conservando el resto de la llave. Los nombres de campaña ya son los del catálogo de v4, porque el renombrado de `add-agent-roster-management` (D11) corre antes.
- Formato de `chat_backup.json` (`v3/chat-backups`): `{"campaign","agent_id","contact_phone","last_updated","total_messages","messages":[{id,timestamp,from,body,...}]}`. La multimedia la sube `POST /media` y se referencia con URLs S3 sin firmar `https://{bucket}.s3.amazonaws.com/media/{campaign}/{agent}/{filename}`.
- Copiar con `CopyObject` cambia `LastModified`, así que la fecha del objeto no sirve para filtrar por fecha.
- Base: `add-admin-web-foundation` (BFF, `withAccess`, gate de entrada: los líderes ya entran porque v4 les da `ana:contacts:list:upload` y `ana:admin:agents:manage`) y `add-agent-roster-management` (authorizer `cognitoAdminJwt` con el client compartido `1r6niimhkl2fmias6kk85n4ou4`, `requireAdminAccess` vía v4 `GET /me`).
- `fix-historial-xss` ya fijó que los datos de chats se renderizan como texto en el CLI; aquí aplica lo mismo en la web.

## Goals / Non-Goals

**Goals:**
- Encontrar en segundos una conversación legada por campaña, agente, teléfono o fecha.
- Solo lectura, acceso por campaña y trazabilidad de consultas.

**Non-Goals:**
- Mostrar los respaldos diarios del estado del agente (`legacy/backups/{campaign}/{YYYY-MM}/...`).
- Exportar conversaciones, búsqueda de texto completo dentro de los mensajes.
- Unificar con el historial de usernames de Cognito (sigue en `backups/` con sus rutas de agente).

## Decisions

### D1. Índice por campaña generado una sola vez
`scripts/build-legacy-chat-index.ts` lista `legacy/backups/{campaign}/` (paginado), lee cada `chat_backup.json`, calcula `totalMessages`, `firstMessageAt` y `lastMessageAt` desde los `timestamp` de los mensajes y escribe `legacy/index/{campaign}.json` (dry-run por defecto, `--apply`). El archivo legado no cambia después del movimiento, así que basta una corrida tras D12 (o repetirla si se mueve más). La ruta de búsqueda lee solo el índice, filtra en memoria y pagina de 50 (decenas de miles de entradas como máximo por campaña).
- Alternativa: listar y leer los respaldos en cada búsqueda. Descartada: lenta (una lectura por conversación) y sin fecha fiable sin abrir cada objeto.
- Alternativa: DynamoDB u OpenSearch. Descartada: v3 es S3 puro y el archivo es inmutable.

### D2. Acceso: admins en todo, líderes en sus campañas
`requireLegacyChatAccess(event, campaign)` reutiliza la resolución de `requireAdminAccess` (v4 `GET /me`, caché 60 s, fail-closed 503) y decide `isAdmin || (isLeader && (campaigns ∋ campaign || campaigns ∋ "*"))`. No se crea permiso nuevo: el historial es de supervisión y los líderes ya son los responsables de cada campaña en v4; un permiso nuevo obligaría a otro cambio en v4 sin beneficio hoy.
- Alternativa: permiso `ana:admin:legacy-chats:view`. Descartada por ahora; si se necesita dar acceso a no líderes, se agrega en v4 y se suma a la regla.
- El BFF aplica la misma regla (sección y rutas `/api/.../legacy-chats*`) y v3 la vuelve a verificar.

### D3. Multimedia: reescritura de la referencia y URL prefirmada
Para cada mensaje, el handler extrae de la URL o llave de media la ruta `media/{campaign}/...`, la convierte a `legacy/media/{campaign}/...` y, solo si el prefijo coincide con la campaña consultada, genera `GetObject` prefirmado de 300 s. Para tipos que no son `image/*`, `audio/*` o `video/*` agrega `ResponseContentDisposition: attachment` para que un HTML o SVG subido no se ejecute en el navegador. La Lambda ya tiene lectura sobre el bucket; no se cambia la política.

### D4. Render como texto en la web
La vista usa solo nodos de texto de React (sin `dangerouslySetInnerHTML`) y conserva saltos de línea con CSS (`white-space: pre-wrap`). Una regla de ESLint `react/no-danger` en `admin-web` lo fija para toda la app.

### D5. Registro de acceso
Línea JSON `evt:"legacy_chat_access"` por consulta (usuario del token, campaña, agente, teléfono, ruta, estado HTTP). Sirve de auditoría de acceso a datos de deudores; nunca se registran cuerpos ni URLs firmadas.

### D6. BFF
- `GET /api/campaigns/[campaign]/legacy-chats?agent=&phone=&from=&to=&page=` → proxy a v3 con el token del usuario.
- `GET /api/campaigns/[campaign]/legacy-chats/[agent]/[phone]` → proxy; no cachea respuestas (contienen URLs firmadas).

## Risks / Trade-offs

- [Datos sensibles de deudores visibles para más personas que antes (antes solo con AWS)] → acceso por campaña, solo líderes/admins, registro de consultas, URLs de 5 min.
- [Índice desactualizado si D12 se re-ejecuta] → la corrida de indexación es idempotente y se repite tras cualquier movimiento nuevo.
- [Formatos de mensajes heterogéneos entre versiones del CLI] → el handler devuelve solo `id`, `timestamp`, `from`, `body` y `media`; campos ausentes como `null`.
- [Multimedia con nombres repetidos sobrescrita en su momento por `POST /media`] → se muestra la última versión guardada; limitación del dato original.

## Migration Plan

1. Requiere desplegados `add-agent-roster-management` (authorizer, `requireAdminAccess`) y ejecutado el movimiento a `legacy/` de `migrate-cli-to-cognito-login` (D12).
2. Desplegar las rutas v3 (aditivas).
3. Ejecutar el índice en dry-run y luego `--apply` contra prod.
4. Habilitar la sección en ANA Admin; probar con un admin y un líder.
- Rollback: ocultar la sección y quitar las funciones; `legacy/` no se modifica (el índice se puede borrar sin pérdida).
