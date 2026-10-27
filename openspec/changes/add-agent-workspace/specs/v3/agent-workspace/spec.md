# Spec Delta

## Purpose

Permitir que el agente v3 (o supervisor) habilitado consulte con su token de Cognito sus asignaciones pendientes, publique las filas elegidas con el mensaje ya renderizado en el layout que consume el CLI y consulte el historial de sus publicaciones.

## ADDED Requirements

### Requirement: Autenticación de las rutas de asignación del agente
Las rutas `/agent/assignments/*` SHALL usar el authorizer `cognitoAgentJwt` y la verificación estricta de token de `/agent/*` (401 sin token válido) y exigir que el usuario del token esté habilitado en la campaña de la ruta según `v3/agent-roster` (403 `{"error":"Forbidden"}` si no). El agente es siempre el del token; MUST NOT aceptarse otro agente en path, query o body. Todo esto ocurre antes de leer S3.

#### Scenario: Agente habilitado
- **WHEN** `ana.lopez`, habilitada en `prueba`, llama a `GET /agent/assignments/prueba` con su id token
- **THEN** el sistema responde 200 con sus asignaciones

#### Scenario: Campaña donde no está habilitado
- **WHEN** `ana.lopez` llama a `GET /agent/assignments/zendere`
- **THEN** el sistema responde 403 sin acceder a S3

#### Scenario: Sin token
- **WHEN** la solicitud no trae `Authorization: Bearer`
- **THEN** el sistema responde 401

### Requirement: Listado de asignaciones pendientes del agente
`GET /agent/assignments/{campaign}` SHALL responder 200 con `{"campaign","agent","items":[{"key","fileName","lastModified","size","etag"}]}`: los objetos `assignments/agents/{campaign}/{agent}-contacts*.csv` del agente del token (paginando el listado), del más reciente al más antiguo, con `items` vacío si no hay.

#### Scenario: Dos cargas pendientes
- **WHEN** existen `assignments/agents/prueba/ana.lopez-contacts-T1.csv` y `...-T2.csv` y uno de `luis`
- **THEN** `ana.lopez` recibe solo sus dos archivos, el más reciente primero

### Requirement: Lectura de un archivo pendiente
`GET /agent/assignments/{campaign}/file?key=<k>` SHALL responder 200 con `{"key","etag","lastModified","csv"}` solo si `k` es una llave `assignments/agents/{campaign}/{agent}-contacts*.csv` del agente del token; otra llave MUST responder 403 `{"error":"Archivo no permitido"}` sin leer S3, una inexistente 404 y una de más de 5 MB 413.

#### Scenario: Llave de otro agente
- **WHEN** `ana.lopez` pide `assignments/agents/prueba/luis-contacts-T1.csv`
- **THEN** el sistema responde 403 sin leer el objeto

#### Scenario: Llave con recorrido
- **WHEN** la llave contiene `..` o no termina en `.csv`
- **THEN** el sistema responde 403

### Requirement: Parseo de los archivos pendientes
Los archivos pendientes SHALL parsearse con las reglas del CLI v3 (`v3/automated-sending`, "Parseo del CSV de contactos"): comillas dobles, comas y saltos de línea dentro de comillas, BOM y filas vacías omitidos. Las filas de datos se numeran desde 0; una fila con menos columnas que el encabezado MUST ser inválida y no publicable.

#### Scenario: Fila incompleta
- **WHEN** la fila 3 de un archivo tiene menos columnas que el encabezado
- **THEN** se reporta inválida y una publicación que la incluya responde 400

### Requirement: Solicitud de publicación
`POST /agent/assignments/{campaign}/publish` SHALL recibir `{"publishId","template","phoneColumns":[...],"sources":[{"key","etag","rows":[<índice>]}]}`: `publishId` `^[A-Za-z0-9-]{8,64}$`, `template` no vacío de hasta 2000 caracteres, 1 a 5 columnas de teléfono, 1 a 20 fuentes propias sin repetir y 1 a 20 000 filas en total. Un body inválido MUST responder 400 sin escribir.

#### Scenario: Sin filas
- **WHEN** todas las fuentes traen `rows` vacío
- **THEN** el sistema responde 400 con `{"success":false,"message":"Selecciona al menos una fila"}`

#### Scenario: Fuente de otro agente
- **WHEN** una fuente es una llave de `luis`
- **THEN** el sistema responde 403 `{"error":"Archivo no permitido"}` sin escribir

### Requirement: Fuentes sin cambios desde la lectura
Antes de escribir, el sistema SHALL leer cada fuente y comparar su ETag con el enviado; si alguna no existe o cambió MUST responder 409 `{"success":false,"message":"La asignación cambió; vuelve a cargarla"}` sin escribir nada.

#### Scenario: Publicación en otra pestaña
- **WHEN** el agente publica desde dos pestañas con la misma fuente
- **THEN** la segunda publicación responde 409 y no publica filas repetidas

### Requirement: Teléfonos de la publicación
Por cada fila seleccionada y cada columna de `phoneColumns` (en orden), el sistema SHALL generar un contacto si el valor tiene 10 o más dígitos y esos dígitos no se repiten en la publicación; una columna que no existe en ninguna fuente MUST responder 400. Si ninguna fila produce teléfono MUST responder 400 `Sin teléfonos válidos`.

#### Scenario: Dos columnas de teléfono
- **WHEN** una fila tiene `telefono_1=5512345678` y `telefono_2=5598765432` y se eligen ambas
- **THEN** el archivo publicado tiene dos filas, una por teléfono, con el mismo resto de datos

#### Scenario: Teléfono repetido
- **WHEN** dos filas seleccionadas tienen el mismo teléfono
- **THEN** solo se publica la primera

### Requirement: Renderizado del mensaje por fila
El mensaje de cada contacto SHALL renderizarse en el servidor con la semántica del CLI v3 (`{{var}}`, `{var}`, variables estándar, expresiones matemáticas y `\n` literal, `v3/automated-sending`) sobre la fila combinada con el teléfono del contacto como `phone`, sin `ana_upload_id`. Si algún marcador queda sin resolver MUST responder 400 `Variable desconocida: <marcador>` sin escribir.

#### Scenario: Variable y expresión
- **WHEN** la plantilla es `Hola {{first_name}}, paga {{total_balance*0.5}}` y la fila tiene `first_name=Ana`, `total_balance=1000`
- **THEN** la columna `message` es `Hola Ana, paga 500`

#### Scenario: Variable inexistente
- **WHEN** la plantilla usa `{{apodo}}` y ninguna fuente tiene esa columna
- **THEN** el sistema responde 400 `Variable desconocida: {{apodo}}`

#### Scenario: Variable que tomaría el identificador de carga
- **WHEN** la plantilla usa `{upload}` y ninguna columna salvo `ana_upload_id` lo contiene
- **THEN** el sistema responde 400 `Variable desconocida: {upload}`

### Requirement: Archivo publicado para el CLI
El sistema SHALL escribir `agents/{campaign}/{agent}-contacts-{ts}.csv` y una copia idéntica en `historic/agents/...` con encabezado `phone_number`, las demás columnas de las fuentes (unión en orden, sin alias de teléfono, `message` ni `ana_upload_id`), `message` (renderizado, saltos de línea como `\n` literal) y `ana_upload_id` (el de la fila o vacío), con campos escapados como CSV.

#### Scenario: Consumo por el CLI
- **WHEN** `ana.lopez` publica 2 filas en `prueba`
- **THEN** `GET /get/chats/ana.lopez/prueba` entrega ese archivo y el CLI envía a cada contacto el mensaje de su fila

#### Scenario: Mensaje con salto de línea
- **WHEN** la plantilla tiene dos líneas
- **THEN** la columna `message` queda en una sola línea con `\n` literal entre ambas

### Requirement: Consumo de las filas publicadas
Tras escribir el archivo publicado, cada fuente SHALL quedar sin las filas publicadas: si le quedan filas válidas sin publicar se reescribe (encabezado y líneas originales) condicionado a su ETag; si no, se borra. Una fila publicada MUST NOT volver a ofrecerse como pendiente.

#### Scenario: Publicación parcial
- **WHEN** un archivo tiene 10 filas y se publican 4
- **THEN** el archivo pendiente queda con las otras 6 filas y su listado muestra un ETag nuevo

#### Scenario: Publicación total
- **WHEN** se publican todas las filas válidas de un archivo
- **THEN** el archivo deja de existir en `assignments/`

### Requirement: Fallo parcial de la publicación
Si falla la escritura del archivo publicado o el consumo de alguna fuente, el sistema SHALL borrar el archivo publicado de `agents/`, restaurar el contenido original de las fuentes ya modificadas y responder 500 `{"success":false,"message":"Error interno del servidor"}`, de modo que un reintento tras recargar no duplique contactos.

#### Scenario: Falla al reescribir la segunda fuente
- **WHEN** la publicación tiene dos fuentes y la reescritura de la segunda falla
- **THEN** el archivo de `agents/` se borra, la primera fuente recupera su contenido y la respuesta es 500

### Requirement: Manifiesto e idempotencia de la publicación
Cada publicación exitosa SHALL registrarse en `agent-publications/{campaign}/{agent}/{publishId}.json` con `{"schemaVersion":1,"publishId","campaign","agent","publishedAt","template","phoneColumns","contacts","rows","key","historicKey","uploadIds","sources":[{"key","rows","remaining","action"}]}` sin teléfonos ni filas. Un `publishId` ya registrado MUST responder 200 con su manifiesto sin escribir.

#### Scenario: Doble clic
- **WHEN** la misma publicación llega dos veces con el mismo `publishId`
- **THEN** la segunda responde 200 con el manifiesto original y el CLI recibe un solo archivo

### Requirement: Historial de publicaciones del agente
`GET /agent/assignments/{campaign}/publications` SHALL responder 200 con `{"campaign","agent","items":[<manifiesto>]}`: las 50 publicaciones más recientes del agente del token en la campaña por `publishedAt` descendente, con `items` vacío si no hay.

#### Scenario: Consulta del historial
- **WHEN** `ana.lopez` publicó 3 veces en `prueba`
- **THEN** recibe las 3, la más reciente primero, sin las de otros agentes

### Requirement: Contactos fuera de logs del backend
Las rutas de asignación del agente MUST NOT registrar teléfonos, filas ni el mensaje renderizado; los logs solo incluyen campaña, agente, `publishId`, llaves y conteos.

#### Scenario: Publicación exitosa
- **WHEN** se publica una selección
- **THEN** el log contiene `evt:"agent_publish"`, campaña, agente, `publishId` y conteos, sin datos de contacto
