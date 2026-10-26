# chat-backup-sync Specification

## Purpose
Respaldo en el backend ANA de las conversaciones de la ventana manual: un respaldo automático por chat (solo texto) que se sincroniza al abrir, cada 45 segundos y al salir de un chat, y un respaldo masivo bajo demanda ("Respaldar Chats") que recorre todos los chats e incluye media.

## Requirements

### Requirement: Activación del respaldo automático
La ventana manual SHALL activar el respaldo automático por chat solo si existe configuración de agente con `agent_id` y `campaign`. El sistema MUST empezar a vigilar el chat abierto 2 segundos después de cargar la página y luego cada 1 segundo.

#### Scenario: Sin configuración de agente
- **WHEN** no existe configuración de agente
- **THEN** el respaldo automático no se activa y se registra una advertencia en consola

### Requirement: Detección de cambio de chat
El respaldo automático SHALL considerar un chat como abierto cuando el mismo teléfono (con al menos 10 dígitos y `+` o prefijo `52`) se detecta en 2 sondeos consecutivos, y MUST ignorar cambios de chat a menos de 1.5 segundos del cambio anterior. Se considera que el agente salió del chat tras 3 sondeos consecutivos sin teléfono detectable.

#### Scenario: Agente cambia de chat
- **WHEN** el agente pasa del chat A al chat B
- **THEN** se respalda el chat A en silencio
- **AND** 500 ms después se respalda el chat B mostrando notificaciones y se reinicia la cuenta regresiva de 45 segundos

#### Scenario: Agente sale del chat
- **WHEN** durante 3 sondeos no se detecta teléfono de chat
- **THEN** se respalda en silencio el último chat, se oculta la cuenta regresiva y se detiene el respaldo periódico

#### Scenario: Chat con contacto guardado por nombre
- **WHEN** el encabezado muestra un nombre y no se encuentra un número con `+`/`52` en el chat ni en la lista
- **THEN** el chat no se respalda automáticamente

### Requirement: Captura de mensajes del respaldo automático
El respaldo automático SHALL extraer los mensajes actualmente cargados en el chat abierto que tienen identificador y texto, con los campos `id`, `timestamp` (texto `HH:MM, DD/MM/YYYY` tomado de WhatsApp o, si falta, la hora actual en milisegundos), `body`, `from` (`me`/`them`), `type: "text"` y `direction` (`outgoing`/`incoming`). Los mensajes sin texto (imágenes, audios, documentos sin pie) MUST omitirse.

#### Scenario: Chat con fotos y texto
- **WHEN** el chat contiene una foto sin pie y dos mensajes de texto
- **THEN** solo los dos mensajes de texto se incluyen en el respaldo

#### Scenario: Chat sin mensajes de texto
- **WHEN** no se extrae ningún mensaje
- **THEN** no se consulta ni se envía nada al backend

### Requirement: Sincronización con el backend
Cada respaldo automático SHALL normalizar el teléfono al formato `521` + 10 dígitos, obtener el respaldo existente con `GET {API ANA}/backups/chat/{campaign}/{agent_id}/{teléfono}` y comparar un hash de `id`, `timestamp`, `body` y `from` de todos los mensajes. Si los hashes difieren o no hay respaldo previo, MUST enviar `POST {API ANA}/backups/chat` con `{ campaign, agent_id, contact_phone, messages }`. Solo SHALL ejecutarse un respaldo a la vez.

#### Scenario: Normalización del teléfono de respaldo
- **WHEN** el teléfono detectado es `5512345678` o `525512345678`
- **THEN** el respaldo usa `contact_phone` `5215512345678`

#### Scenario: Sin cambios
- **WHEN** el hash local coincide con el del respaldo remoto
- **THEN** no se envía el respaldo y, si el respaldo es visible, se muestra "No hay cambios en el chat"

#### Scenario: Mensajes nuevos
- **WHEN** el hash local difiere del remoto
- **THEN** se envían todos los mensajes extraídos y se muestra "Chat respaldado ({n} nuevos mensajes)" con el valor `stats.new_messages` de la respuesta

#### Scenario: Error del backend
- **WHEN** el `POST` responde sin éxito
- **THEN** se muestra "Error al respaldar chat"

> Nota: el teléfono de respaldo usa formato `521...` mientras la gestión y el monitor usan `+52...`; el comentario del código dice "521 -> 52" pero hace lo contrario (`whatsapp-manual.js:1927`).

### Requirement: Respaldo periódico y cuenta regresiva
Mientras un chat permanece abierto, el sistema SHALL repetir el respaldo cada 45 segundos si el chat sigue siendo el mismo y MUST mostrar en la esquina superior derecha un indicador circular "Próximo respaldo" con los segundos restantes (45 a 0), pausado durante cada respaldo.

#### Scenario: Chat abierto por varios minutos
- **WHEN** el agente mantiene abierto el mismo chat 3 minutos
- **THEN** se ejecutan respaldos cada 45 segundos y en cada uno aparece durante ~4 segundos una notificación de resultado

> Nota: el respaldo periódico usa el modo visible, así que cada 45 segundos aparece una notificación (aunque sea "No hay cambios en el chat") (`whatsapp-manual.js:2093`).

### Requirement: Respaldo masivo bajo demanda
La ventana manual SHALL mostrar el botón "☁️ Respaldar Chats" y, al pulsarlo (detectado en un sondeo cada 1 segundo), MUST recorrer todos los chats de la lista lateral: contar los chats desplazando la lista hasta que el número no cambie en 3 intentos, abrir cada chat, desplazar hacia arriba hasta 20 veces para cargar historial (deteniéndose tras 3 intentos sin mensajes nuevos) y extraer sus mensajes.

#### Scenario: Progreso del respaldo masivo
- **WHEN** el respaldo masivo está en curso
- **THEN** se muestra un overlay "Respaldando Chats" con el mensaje de estado, barra de progreso y "{actual} / {total} chats ({%})"

#### Scenario: Chat que no carga
- **WHEN** un chat no muestra su contenedor de mensajes tras la espera
- **THEN** ese chat se omite y el recorrido continúa

#### Scenario: Fin del respaldo masivo
- **WHEN** el envío al servidor termina con éxito o con error
- **THEN** el overlay muestra "Backup completado exitosamente" o el error, con un botón "Cerrar"

### Requirement: Captura y subida de media en el respaldo masivo
En el respaldo masivo cada mensaje SHALL incluir `id`, `type` (`incoming`/`outgoing`), `text`, `timestamp`, `hasMedia` y `mediaType` (`image`, `video`, `audio`, `document` o `null`). Para imágenes, videos y audios cargados en el navegador, el contenido MUST subirse con `POST {API ANA}/media` y cuerpo `{ campaign, agent_id, filename, content_type, data: <base64> }`, guardando la URL devuelta en `mediaUrl`.

#### Scenario: Mensaje con imagen
- **WHEN** un mensaje contiene una imagen cargada
- **THEN** la imagen se sube como `{id_saneado}.{extensión}` y el mensaje respaldado incluye `mediaUrl`

#### Scenario: Documento adjunto
- **WHEN** un mensaje contiene un documento
- **THEN** se marca `hasMedia: true` y `mediaType: "document"` sin subir el archivo

#### Scenario: Falla la subida de media
- **WHEN** `POST /media` responde con error
- **THEN** el mensaje se respalda sin `mediaUrl`

### Requirement: Envío del respaldo masivo
Al terminar el recorrido, el sistema SHALL enviar `POST {API ANA}/backups` con `{ campaign, agent_id, data }`, donde `data` es `{ type: "chat_backup", totalChats, totalMessages, chats: [{ chatIndex, name, phone, messageCount, messages, extractedAt }], extractedAt }`. El teléfono de cada chat MUST tomarse del encabezado o del título del chat solo si tiene al menos 10 dígitos, conservando el `+` inicial; en otro caso queda vacío.

#### Scenario: Chat de un contacto guardado
- **WHEN** el chat muestra un nombre y no un número
- **THEN** el chat se respalda con `phone` vacío y `name` igual al nombre visible

> Nota: el formato de mensajes del respaldo masivo (`type`/`text`) difiere del respaldo automático (`from`/`body`/`direction`); además, el respaldo masivo abre cada chat, lo que los marca como leídos en la cuenta manual.

### Requirement: Restauración de respaldos
El sistema SHALL ofrecer los respaldos únicamente como consulta de solo lectura desde el botón "Ver Historial" de la ventana manual (lista por agente y campaña y detalle por teléfono) y MUST NOT restaurar mensajes dentro de WhatsApp Web.

#### Scenario: Agente reinstala el CLI
- **WHEN** el agente vincula de nuevo su WhatsApp en un equipo nuevo
- **THEN** las conversaciones respaldadas pueden consultarse en "Ver Historial", pero no se reinsertan en WhatsApp
