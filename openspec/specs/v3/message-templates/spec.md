# message-templates Specification

## Purpose
Listar, descargar y guardar plantillas de mensajes por campaña y canal (texto, email en JSON y audios MP3 para blaster) en el bucket compartido de templates del motor, separado del bucket de almacenamiento del backend.

> Nota: `GET /templates` no exige autenticación y el parámetro `key` no se valida contra `campaign`/`channel`; cualquier llave bajo `templates/` del bucket de templates puede leerse. Las respuestas no incluyen header `Content-Type`.

## Requirements

### Requirement: Ubicación de plantillas
El sistema SHALL almacenar las plantillas en el bucket de templates configurado (región us-east-2) bajo `templates/{campaign}/{channel}/{nombre}{extensión}`, con extensión `.json` y tipo `application/json` para el canal `email`, `.mp3` y `audio/mpeg` para `blaster`, y `.txt` y `text/plain` para cualquier otro canal.

#### Scenario: Plantilla de texto
- **WHEN** se guarda la plantilla `saludo` en el canal `whatsapp` de la campaña `prueba`
- **THEN** la llave resultante es `templates/prueba/whatsapp/saludo.txt`

#### Scenario: Extensión ya presente en el nombre
- **WHEN** se guarda `saludo.txt` en un canal de texto
- **THEN** la llave resultante es `templates/{campaign}/{channel}/saludo.txt.txt`, pues solo se elimina la extensión `.mp3` del nombre recibido

### Requirement: Listado de plantillas
El sistema SHALL exponer `GET /templates?campaign=X&channel=Y`, sin autenticación, que lista los objetos bajo `templates/{campaign}/{channel}/` (excluyendo el propio prefijo).

#### Scenario: Listado exitoso
- **WHEN** se consulta con `campaign` y `channel` sin `key`
- **THEN** el sistema responde 200 con `{"files":[{"key","filename"}]}`, donde `filename` es la llave sin el prefijo

#### Scenario: Parámetros faltantes
- **WHEN** falta `campaign` o `channel`
- **THEN** el sistema responde 400 con `{"error":"campaign y channel son requeridos"}`

#### Scenario: Error de listado
- **WHEN** falla el listado en S3
- **THEN** el sistema responde 500 con `{"error":"Error al listar los templates"}`

### Requirement: Descarga de una plantilla
El sistema SHALL, cuando `GET /templates` incluye además el parámetro `key`, devolver el contenido del objeto con esa llave exacta: en Base64 si `channel` es `blaster`, o como texto UTF-8 en cualquier otro caso.

#### Scenario: Plantilla de texto
- **WHEN** se consulta `GET /templates?campaign=prueba&channel=whatsapp&key=templates/prueba/whatsapp/saludo.txt`
- **THEN** el sistema responde 200 con `{"content":"<texto>"}`

#### Scenario: Audio blaster
- **WHEN** `channel` es `blaster`
- **THEN** el sistema responde 200 con `{"content":"<base64>","encoding":"base64","contentType":"audio/mpeg"}`

#### Scenario: Plantilla inexistente
- **WHEN** la llave no existe
- **THEN** el sistema responde 404 con `{"error":"Archivo no encontrado"}`

#### Scenario: Error de lectura
- **WHEN** S3 falla por otra causa (p. ej. llave fuera de `templates/` sin permiso)
- **THEN** el sistema responde 500 con `{"error":"Error al obtener el template"}`

### Requirement: Guardado de plantillas
El sistema SHALL exponer `POST /templates`, protegido con `X-Admin-Key`, que recibe `{campaign, channel, filename, content}` y crea o sobrescribe la plantilla correspondiente.

#### Scenario: Guardado exitoso
- **WHEN** un supervisor con llave válida envía `{"campaign":"prueba","channel":"email","filename":"aviso","content":"{...}"}`
- **THEN** el sistema escribe `templates/prueba/email/aviso.json`
- **AND** responde 200 con `{"message":"Template guardado correctamente","key":"templates/prueba/email/aviso.json"}`

#### Scenario: Audio blaster
- **WHEN** `channel` es `blaster`, `filename` termina en `.mp3` y `content` es una cadena Base64
- **THEN** el sistema decodifica el Base64 y guarda los bytes como `audio/mpeg`

#### Scenario: Llave de administración inválida
- **WHEN** falta `X-Admin-Key` o es incorrecta
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}` (503 si la llave no está configurada en el servidor)

#### Scenario: Campos faltantes
- **WHEN** falta `campaign`, `channel` o `filename`, o `content` no está definido
- **THEN** el sistema responde 400 con `{"error":"campaign, channel, filename y content son requeridos"}`

#### Scenario: Validaciones de blaster
- **WHEN** `channel` es `blaster` y `filename` no termina en `.mp3`
- **THEN** el sistema responde 400 con `{"error":"El canal blaster solo acepta archivos .mp3"}`
- **AND** si `content` no es cadena responde 400 con `{"error":"content debe ser el archivo MP3 en base64"}`

#### Scenario: Error interno
- **WHEN** el body no es JSON válido o falla S3
- **THEN** el sistema responde 500 con `{"error":"Error al guardar el template"}`
