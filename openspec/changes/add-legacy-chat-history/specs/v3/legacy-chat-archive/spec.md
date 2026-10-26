# Spec Delta

## Purpose

Conservar en v3, en solo lectura, el historial de chats de cobranza guardado bajo `agent_id` legados (anteriores al login Cognito) y permitir que admins y líderes lo consulten por campaña desde ANA Admin.

## ADDED Requirements

### Requirement: Disposición del archivo legado
El historial legado SHALL vivir en el bucket `ana-backend-storage-{stage}` bajo `legacy/backups/{campaign}/{agent}/{phone}/chat_backup.json` y `legacy/media/{campaign}/{agent}/{filename}`, con el mismo contenido que tenían en `backups/` y `media/`. Ninguna ruta del backend MUST escribir, sobrescribir ni borrar bajo `legacy/`, salvo el índice `legacy/index/{campaign}.json` que escribe el proceso de indexación.

#### Scenario: Conversación movida
- **WHEN** existía `backups/prueba/erick/5215512345678/chat_backup.json` de un `agent_id` legado
- **THEN** su contenido está en `legacy/backups/prueba/erick/5215512345678/chat_backup.json`

#### Scenario: Sin rutas de escritura
- **WHEN** se revisan las rutas `/admin/campaigns/{campaign}/legacy-chats*`
- **THEN** solo existen operaciones `GET`

### Requirement: Índice de búsqueda por campaña
El índice `legacy/index/{campaign}.json` SHALL contener `{"schemaVersion":1,"generatedAt","conversations":[{"agent","phone","totalMessages","firstMessageAt","lastMessageAt"}]}`, con una entrada por `chat_backup.json` de la campaña, fechas ISO 8601 UTC tomadas de los mensajes (no de la fecha del objeto) y teléfonos tal como aparecen en la llave.

#### Scenario: Conversación indexada
- **WHEN** `legacy/backups/prueba/erick/5215512345678/chat_backup.json` tiene 12 mensajes del 2026-08-01 al 2026-09-15
- **THEN** el índice de `prueba` incluye `{"agent":"erick","phone":"5215512345678","totalMessages":12,"firstMessageAt":"2026-08-01T...","lastMessageAt":"2026-09-15T..."}`

#### Scenario: Respaldo ilegible
- **WHEN** un `chat_backup.json` no es JSON válido
- **THEN** la conversación entra al índice con `totalMessages: 0` y fechas `null`, y el proceso continúa

### Requirement: Autorización de consulta por campaña
Las rutas de historial legado SHALL permitir el acceso a usuarios con `isAdmin` en cualquier campaña y a usuarios con `isLeader` solo en campañas incluidas en sus `campaigns` (o con `*`), según v4 `GET /me` con el mismo token; cualquier otro caso MUST responder 403 y un fallo de v4 MUST responder 503, ambos sin leer S3.

#### Scenario: Líder de otra campaña
- **WHEN** un líder con `campaigns: ["ventas"]` consulta `prueba`
- **THEN** el sistema responde 403 sin leer `legacy/`

#### Scenario: v4 no responde
- **WHEN** v4 `GET /me` falla o excede el tiempo de espera
- **THEN** el sistema responde 503

### Requirement: Búsqueda de conversaciones legadas
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/legacy-chats` con filtros opcionales `agent` (exacto, normalizado), `phone` (coincidencia por dígitos contenidos), `from` y `to` (fechas `YYYY-MM-DD` sobre `lastMessageAt`) y `page` (50 por página), que responde 200 con `{"total","page","conversations":[...]}` desde el índice, ordenado por `lastMessageAt` descendente.

#### Scenario: Búsqueda por teléfono
- **WHEN** se busca `phone=5512345678` en `prueba`
- **THEN** la respuesta incluye la conversación `5215512345678` de `erick`

#### Scenario: Campaña sin índice
- **WHEN** no existe `legacy/index/{campaign}.json`
- **THEN** el sistema responde 200 con `total: 0` y `conversations` vacío

#### Scenario: Filtro inválido
- **WHEN** `from` no es una fecha `YYYY-MM-DD` o es posterior a `to`
- **THEN** el sistema responde 400 sin leer S3

### Requirement: Consulta de una conversación legada
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/legacy-chats/{agent}/{phone}` que responde 200 con `{"campaign","agent","phone","messages":[{"id","timestamp","from","body","media"}]}` en orden de `timestamp`, o 404 si no existe el respaldo. `body` MUST devolverse como texto tal cual se guardó, sin interpretarlo.

#### Scenario: Conversación existente
- **WHEN** existe `legacy/backups/prueba/erick/5215512345678/chat_backup.json`
- **THEN** la respuesta contiene sus mensajes ordenados por `timestamp`

#### Scenario: Conversación inexistente
- **WHEN** no existe el respaldo pedido
- **THEN** el sistema responde 404 con `{"error":"not_found"}`

### Requirement: Multimedia por URL prefirmada
Para cada mensaje con multimedia, el sistema SHALL devolver en `media` una URL prefirmada de lectura con vigencia de 5 minutos hacia la llave equivalente bajo `legacy/media/{campaign}/`, y su tipo de contenido. Una referencia que no resuelva a una llave bajo `legacy/media/{campaign}/` MUST devolver `media: null`. Los tipos distintos de imagen, audio o video MUST servirse como descarga.

#### Scenario: Imagen de la conversación
- **WHEN** un mensaje referencia `media/prueba/erick/foto.jpg`
- **THEN** `media.url` es una URL prefirmada de `legacy/media/prueba/erick/foto.jpg` que expira en 5 minutos

#### Scenario: Referencia fuera de la campaña
- **WHEN** un mensaje de `prueba` referencia `media/ventas/ana/x.jpg`
- **THEN** ese mensaje se devuelve con `media: null`

### Requirement: Registro de consultas al historial legado
Cada consulta de búsqueda o de conversación SHALL registrar una línea estructurada `{"evt":"legacy_chat_access","user","campaign","agent","phone","route","status"}`; el registro MUST NOT incluir cuerpos de mensajes, URLs prefirmadas ni tokens.

#### Scenario: Consulta de una conversación
- **WHEN** un admin abre la conversación `5215512345678` de `erick` en `prueba`
- **THEN** CloudWatch contiene la línea `legacy_chat_access` con su usuario, la campaña, el agente y el teléfono, sin mensajes
