# agent-assignments Specification

## Purpose
Gestionar la asignación de contactos de cobranza a agentes: los supervisores suben CSVs de contactos con un mensaje plantilla, los consultan y descargan, y el CLI del agente consume su asignación una sola vez y reporta los contactos pendientes. La disposición de llaves en S3 es un contrato externo con el CLI.

> Nota: las rutas de lectura `GET /supervisors/...` y `GET /get/chats/...` no exigen `X-Admin-Key`; cualquiera que conozca agente y campaña puede leer (o consumir) los contactos. El backend no mueve archivos de `assignments/` a `agents/`; esa promoción no ocurre en este servicio. Los listados de S3 no paginan (máximo 1000 objetos por prefijo).

## Requirements

### Requirement: Disposición de llaves S3 de asignaciones
El sistema SHALL usar en el bucket de almacenamiento estas llaves, donde `{ts}` es la fecha ISO 8601 UTC con `:` y `.` reemplazados por `-` (p. ej. `2026-10-26T15-04-05-123Z`): `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv` (pendientes), `agents/{campaign}/{agent}-contacts-{ts}.csv` (listos para el CLI), `historic/agents/{campaign}/{agent}-contacts-{ts}.csv` (histórico) y `chats/{agent_id}-{campaign}.csv` (pendientes del CLI).

#### Scenario: Identificación de archivos de un agente
- **WHEN** el sistema busca archivos de contactos del agente `erick` bajo un prefijo de campaña
- **THEN** considera solo objetos cuyo nombre de archivo empiece con `erick-contacts` y termine en `.csv`

### Requirement: Carga de contactos por supervisor
El sistema SHALL exponer `POST /supervisors/agents/{agent}/{campaign}/contacts`, protegido con `X-Admin-Key`, que acepta JSON `{csv, message, metadata?, direct?}` o `multipart/form-data` (archivo en campo `file` o `csv`, o el primer archivo, o campo de texto `csv`; campos `message`, `metadata`, `direct`), eliminando un BOM UTF-8 inicial del CSV.

#### Scenario: Carga normal a asignaciones
- **WHEN** un supervisor con llave válida envía `{"csv":"contact_phone,first_name\n521...,Ana","message":"Hola {{first_name}}"}`
- **THEN** el sistema escribe el CSV procesado en `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv` y una copia idéntica en `historic/agents/{campaign}/{agent}-contacts-{ts}.csv`
- **AND** responde 200 con `{"success":true,"message":"CSV subido correctamente con mensaje agregado","data":{"agent","campaign","key","historic_key","destination":"assignments","isDirect":false,"contactCount","messageAdded","metadata","timestamp"}}`

#### Scenario: Carga directa
- **WHEN** `direct` es `true` o `"true"` en JSON, o `"true"`/`"1"` en multipart
- **THEN** el archivo principal se escribe en `agents/{campaign}/{agent}-contacts-{ts}.csv` con `destination: "agents (directo)"` e `isDirect: true`, además de la copia histórica

#### Scenario: Metadata adjunta
- **WHEN** se envía `metadata`
- **THEN** ambos objetos S3 llevan el metadato de usuario `metadata_b64` con el valor codificado en Base64 UTF-8

### Requirement: Procesamiento del CSV con columna message
El sistema SHALL agregar `,message` al encabezado si este no contiene la palabra `message`, y a cada fila no vacía agregar el mensaje escapado como campo CSV, salvo que la fila ya contenga el texto del mensaje; las filas vacías se omiten y el resultado termina en salto de línea.

#### Scenario: Conteo de contactos
- **WHEN** el CSV tiene encabezado y 10 filas no vacías
- **THEN** `contactCount` es 10 y cada fila termina con el mensaje plantilla sin sustituir variables

#### Scenario: Mensaje con comas o comillas
- **WHEN** el mensaje contiene coma, comilla doble o salto de línea
- **THEN** el mensaje se agrega entre comillas dobles, con las comillas internas duplicadas

### Requirement: Validaciones de la carga de contactos
El sistema MUST responder 401/503 según la llave de administración, y 400 cuando falten parámetros de ruta, body, CSV o mensaje, o el body no sea parseable.

#### Scenario: Sin body
- **WHEN** la solicitud autorizada no tiene body
- **THEN** el sistema responde 400 con `{"success":false,"message":"Body requerido"}`

#### Scenario: JSON inválido
- **WHEN** el body no es multipart y no es JSON válido
- **THEN** el sistema responde 400 con `{"success":false,"message":"Body debe ser JSON válido con campos: csv y message (metadata opcional)"}`

#### Scenario: Multipart inválido
- **WHEN** el Content-Type es multipart pero falta el boundary o no se encuentra en el body
- **THEN** el sistema responde 400 con `{"success":false,"message":"Error parseando multipart/form-data"}`

#### Scenario: CSV o mensaje faltante
- **WHEN** no se obtiene `csv` o `message`
- **THEN** el sistema responde 400 con un mensaje indicando que CSV y mensaje son requeridos

#### Scenario: Error de escritura
- **WHEN** falla la escritura en S3
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor","error":<detalle>}`

### Requirement: Consulta de contactos listos del agente
El sistema SHALL exponer `GET /supervisors/agents/{agent}/{campaign}/contacts`, sin autenticación, que devuelve con `Content-Type: text/csv` el contenido del archivo más reciente (por fecha de modificación) del agente bajo `agents/{campaign}/`, sin eliminarlo.

#### Scenario: Archivo existente
- **WHEN** existen uno o más archivos `agents/{campaign}/{agent}-contacts*.csv`
- **THEN** el sistema responde 200 con el CSV del más reciente

#### Scenario: Sin archivos
- **WHEN** no hay archivos que coincidan
- **THEN** el sistema responde 404 con `{"success":false,"message":"CSV no encontrado"}`

### Requirement: Listado de asignaciones pendientes
El sistema SHALL exponer `GET /supervisors/assignments/agents/{agent}/{campaign}`, sin autenticación, que lista los archivos del agente bajo `assignments/agents/{campaign}/` ordenados del más reciente al más antiguo.

#### Scenario: Listado
- **WHEN** se consulta el listado de un agente
- **THEN** el sistema responde 200 con `{"success":true,"data":{"agent","campaign","prefix","items":[{"key","lastModified","size"}]}}`, con `items` vacío si no hay archivos

#### Scenario: Error de S3
- **WHEN** falla el listado en S3
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor"}`

### Requirement: Consulta de la asignación pendiente más reciente
El sistema SHALL exponer `GET /supervisors/assignments/agents/{agent}/{campaign}/contacts`, sin autenticación, que devuelve con `Content-Type: text/csv` el archivo más reciente del agente bajo `assignments/agents/{campaign}/`, sin eliminarlo.

#### Scenario: Asignación existente
- **WHEN** existen archivos del agente en el prefijo
- **THEN** el sistema responde 200 con el CSV del más reciente

#### Scenario: Sin asignaciones
- **WHEN** no hay archivos del agente en el prefijo
- **THEN** el sistema responde 404 con `{"success":false,"message":"CSV assignment no encontrado"}`

### Requirement: Descarga de archivos por llave
El sistema SHALL exponer `POST /supervisors/files/download`, protegido con `X-Admin-Key`, que recibe `{key}` o `{keys:[...]}` y devuelve una URL prefirmada de lectura válida 15 minutos por cada llave no vacía, sin restringir el prefijo de la llave dentro del bucket.

#### Scenario: Llaves válidas
- **WHEN** se envía `{"keys":["historic/agents/prueba/erick-contacts-2026-10-26T15-04-05-123Z.csv"]}` con llave válida
- **THEN** el sistema responde 200 con `{"success":true,"data":{"okCount","total","results":[{"key","ok":true,"url","expiresInSeconds":900}]}}`
- **AND** la URL se genera aunque el objeto no exista (el error aparece al descargarla)

#### Scenario: Sin llaves
- **WHEN** el body no tiene `key` ni `keys` con valores no vacíos
- **THEN** el sistema responde 400 con `{"success":false,"message":"Se requiere key o keys"}`

#### Scenario: Body ausente o inválido
- **WHEN** no hay body o no es JSON válido
- **THEN** el sistema responde 400 con `Body requerido` o `Body debe ser JSON válido con campo: key o keys` respectivamente

### Requirement: Consumo único de la asignación por el CLI
El sistema SHALL exponer `GET /get/chats/{agentId}/{campaignId}`, sin autenticación, que toma el archivo más antiguo del agente bajo `agents/{campaignId}/` (excluyendo `credentials.csv`), devuelve su contenido CSV crudo y lo elimina de S3 antes de responder, de modo que cada asignación se entregue una sola vez.

#### Scenario: Consumo exitoso
- **WHEN** el CLI solicita la asignación y existe al menos un archivo del agente
- **THEN** el sistema responde 200 con el CSV crudo como body (con header `Content-Type: application/json`)
- **AND** el objeto queda eliminado; una segunda llamada devuelve el siguiente archivo más antiguo o 404

#### Scenario: Sin asignación
- **WHEN** no hay archivos del agente en el prefijo o el objeto desaparece entre listado y lectura
- **THEN** el sistema responde 404 con `{"error":"Chat assignment not found"}`

#### Scenario: Archivo vacío
- **WHEN** el archivo seleccionado no tiene contenido
- **THEN** el sistema responde 404 con `{"error":"File not found or empty"}` sin eliminarlo

#### Scenario: Fallo al eliminar
- **WHEN** la lectura funciona pero la eliminación falla
- **THEN** el sistema responde 500 con `{"error":"Failed to delete chat assignment after reading"}` y el contenido no se entrega

#### Scenario: Parámetros faltantes
- **WHEN** falta `agentId` o `campaignId`
- **THEN** el sistema responde 400 con `{"error":"agentId and campaignId parameters are required"}`

### Requirement: Publicación legacy de selección final
El sistema SHALL exponer `POST /agents/{agent}/{campaign}/contacts` (deprecado), protegido con `X-Admin-Key`, que solo acepta `multipart/form-data` y escribe el CSV recibido sin modificar (salvo quitar BOM) en `agents/{campaign}/{agent}-contacts-{ts}.csv`, sin copia histórica.

#### Scenario: Publicación exitosa
- **WHEN** se envía un multipart con archivo CSV no vacío y llave válida
- **THEN** el sistema responde 200 con `{"success":true,"message":"CSV publicado","data":{"agent","campaign","key"}}`

#### Scenario: Content-Type incorrecto
- **WHEN** el Content-Type no es `multipart/form-data`
- **THEN** el sistema responde 415 con `{"success":false,"message":"Content-Type debe ser multipart/form-data"}`

#### Scenario: Multipart inválido o CSV vacío
- **WHEN** el multipart no se puede parsear
- **THEN** el sistema responde 400 con `{"success":false,"message":"Multipart inválido"}`
- **AND** si se parsea pero el CSV queda vacío responde 400 con `{"success":false,"message":"Archivo CSV requerido"}`

### Requirement: Reporte de contactos pendientes del CLI
El sistema SHALL exponer `POST /contacts/pending`, sin autenticación, que recibe `{campaign, agent_id, contacts:[{...}]}` y sobrescribe `chats/{agent_id}-{campaign}.csv` con un CSV cuyo encabezado son las llaves del primer contacto, o `contact_phone,contact_name` si la lista está vacía.

#### Scenario: Actualización exitosa
- **WHEN** el CLI envía 3 contactos restantes
- **THEN** el sistema escribe el CSV con una fila por contacto, rodeando con comillas (sin escapar comillas internas) los valores que contienen coma y convirtiendo valores falsy (p. ej. `0`) en vacío
- **AND** responde 200 con `{"message":"Contactos pendientes actualizados","path","remainingContacts":3}`

#### Scenario: Validaciones
- **WHEN** falta `campaign` o `agent_id`
- **THEN** el sistema responde 400 con `{"error":"campaign y agent_id son requeridos"}`
- **AND** si `contacts` no es arreglo responde 400 con `{"error":"contacts debe ser un array"}`

#### Scenario: Error interno
- **WHEN** el body no es JSON válido o falla S3
- **THEN** el sistema responde 500 con `{"error":"Error al actualizar contactos pendientes","details":<detalle>}`
