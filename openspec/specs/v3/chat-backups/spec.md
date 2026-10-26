# chat-backups Specification

## Purpose
Respaldar en S3 el estado del CLI de cada agente y el historial de conversaciones de WhatsApp por contacto, permitir su recuperación y listado, y almacenar archivos multimedia enviados por los agentes.

> Nota: ninguna de estas rutas exige autenticación; cualquiera que conozca campaña, agente y teléfono puede leer o escribir respaldos. Las respuestas de escritura no incluyen header `Content-Type`.

## Requirements

### Requirement: Respaldo diario del estado del agente
El sistema SHALL exponer `POST /backups`, sin autenticación, que recibe `{campaign, agent_id, data}` y guarda `data` serializado como JSON en `backups/{campaign}/{YYYY-MM}/{agent_id}_{DD}.json`, usando la fecha UTC del servidor; un segundo respaldo el mismo día sobrescribe al anterior.

#### Scenario: Respaldo exitoso
- **WHEN** el CLI envía `{"campaign":"prueba","agent_id":"erick","data":{...}}` el 2026-10-26
- **THEN** el sistema escribe `backups/prueba/2026-10/erick_26.json`
- **AND** responde 200 con `{"message":"Backup uploaded successfully","path":"backups/prueba/2026-10/erick_26.json"}`

#### Scenario: Campos faltantes
- **WHEN** no hay body
- **THEN** el sistema responde 400 con `{"error":"Request body is required"}`
- **AND** si falta `campaign`, `agent_id` o `data` responde 400 con `{"error":"campaign, agent_id and data fields are required"}`

#### Scenario: Error interno
- **WHEN** el body no es JSON válido o falla S3
- **THEN** el sistema responde 500 con `{"error":"Internal server error"}`

### Requirement: Recuperación del respaldo más reciente
El sistema SHALL exponer `GET /backups/latest/{agentId}/{campaign}`, sin autenticación, que busca el respaldo diario del agente empezando por hoy y retrocediendo un día a la vez hasta un total de 4 días (hoy y los 3 anteriores), devolviendo el primero encontrado.

#### Scenario: Respaldo encontrado
- **WHEN** existe el respaldo de ayer pero no el de hoy
- **THEN** el sistema responde 200 con `{"success":true,"date":"YYYY-MM-DD","daysBack":1,"data":<contenido>}`

#### Scenario: Sin respaldo reciente
- **WHEN** no existe respaldo en ninguno de los 4 días revisados
- **THEN** el sistema responde 404 con `{"success":false,"message":"No se encontró backup para {agentId}/{campaign} en los últimos 4 días"}`

#### Scenario: Error de lectura o contenido corrupto
- **WHEN** S3 falla con un error distinto de objeto inexistente, o el contenido no es JSON válido
- **THEN** el sistema responde 500 con `{"error":"Error al obtener backup","details":<detalle>}`

### Requirement: Respaldo incremental de chat por contacto
El sistema SHALL exponer `POST /backups/chat`, sin autenticación, que recibe `{campaign, agent_id, contact_phone, messages:[...]}` y fusiona los mensajes con los ya guardados en `backups/{campaign}/{agent_id}/{contact_phone}/chat_backup.json`, descartando duplicados (misma combinación `id`, `timestamp`, `from`, `body`) y ordenando por `timestamp` ascendente.

#### Scenario: Fusión con mensajes existentes
- **WHEN** el archivo tiene 10 mensajes y se envían 5, de los cuales 2 ya existían
- **THEN** el sistema guarda `{"campaign","agent_id","contact_phone","last_updated","total_messages":13,"messages":[...]}`
- **AND** responde 200 con `{"success":true,"message":"Chat backup saved successfully","path","stats":{"existing_messages":10,"new_messages":3,"total_messages":13,"skipped_duplicates":2}}`

#### Scenario: Primer respaldo del contacto
- **WHEN** no existe archivo previo para el contacto
- **THEN** el sistema crea el archivo con los mensajes recibidos y `existing_messages` igual a 0

#### Scenario: Validaciones
- **WHEN** no hay body, o falta alguno de `campaign`, `agent_id`, `contact_phone`, `messages`
- **THEN** el sistema responde 400 con `{"error":"Request body is required"}` o `{"error":"campaign, agent_id, contact_phone and messages fields are required"}`
- **AND** si `messages` no es arreglo responde 400 con `{"error":"messages must be an array"}`

#### Scenario: Error interno
- **WHEN** el body no es JSON válido o falla S3
- **THEN** el sistema responde 500 con `{"error":"Internal server error","details":<detalle>}`

### Requirement: Consulta de chat de un contacto
El sistema SHALL exponer `GET /backups/chat/{campaign}/{agentId}/{contactPhone}`, sin autenticación, que devuelve el respaldo de chat almacenado para ese contacto.

#### Scenario: Chat existente
- **WHEN** existe `backups/{campaign}/{agentId}/{contactPhone}/chat_backup.json`
- **THEN** el sistema responde 200 con `{"success":true,"data":<contenido del archivo>}`

#### Scenario: Chat inexistente
- **WHEN** el objeto no existe
- **THEN** el sistema responde 404 con `{"success":false,"message":"No backup found for this contact","data":null}`
- **AND** si el objeto existe pero está vacío responde 404 con `{"success":false,"message":"No backup found"}`

#### Scenario: Error de lectura
- **WHEN** S3 falla por otra causa o el contenido no es JSON válido
- **THEN** el sistema responde 500 con `{"error":"Error al obtener backup","details":<detalle>}`

### Requirement: Listado de chats respaldados de un agente
El sistema SHALL exponer `GET /backups/chats/{campaign}/{agentId}`, sin autenticación, que lista los archivos `chat_backup.json` bajo `backups/{campaign}/{agentId}/` con un resumen por contacto, ordenado por `last_updated` descendente.

#### Scenario: Listado exitoso
- **WHEN** el agente tiene chats respaldados
- **THEN** el sistema responde 200 con `{"success":true,"campaign","agent_id","total_chats","chats":[{"contact_phone","total_messages","last_updated","last_message_preview"}]}`, donde `last_message_preview` son los primeros 80 caracteres del cuerpo del último mensaje

#### Scenario: Archivo ilegible
- **WHEN** un archivo de chat no se puede leer o parsear
- **THEN** ese contacto aparece con `total_messages: 0`, `last_message_preview: null` y `last_updated` igual a la fecha de modificación del objeto

#### Scenario: Error de listado
- **WHEN** falla el listado en S3
- **THEN** el sistema responde 500 con `{"error":"Internal server error","details":<detalle>}`

### Requirement: Carga de archivos multimedia
El sistema SHALL exponer `POST /media`, sin autenticación, que recibe `{campaign, agent_id, filename, content_type?, data}` con `data` en Base64, guarda los bytes en `media/{campaign}/{agent_id}/{filename}` con el `content_type` indicado (o `application/octet-stream`) y devuelve una URL S3 construida sin firmar.

#### Scenario: Carga exitosa
- **WHEN** el CLI envía una imagen en Base64
- **THEN** el sistema responde 200 con `{"message":"Media uploaded successfully","url":"https://{bucket}.s3.amazonaws.com/media/{campaign}/{agent_id}/{filename}","path"}`
- **AND** un archivo con el mismo nombre se sobrescribe

#### Scenario: Campos faltantes
- **WHEN** no hay body o falta `campaign`, `agent_id`, `filename` o `data`
- **THEN** el sistema responde 400 con `{"error":"Request body is required"}` o `{"error":"campaign, agent_id, filename and data fields are required"}`

#### Scenario: Error interno
- **WHEN** el body no es JSON válido o falla S3
- **THEN** el sistema responde 500 con `{"error":"Internal server error"}`
