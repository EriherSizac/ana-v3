# Spec Delta

## MODIFIED Requirements

### Requirement: Carga de contactos de administración
El sistema SHALL exponer `POST /admin/campaigns/{campaign}/contacts` (rutas `/admin/*` de `v3/backend-api-security`) con body JSON `{"uploadId","fileName","mode","files":[{"agent","csv"}]}`: `uploadId` de 8 a 64 caracteres `[A-Za-z0-9-]`, `mode` `distribute` o `single`, 1 a 200 archivos con agentes distintos tras normalizar (`v3/agent-roster`) y body de hasta 5 500 000 bytes (más grande responde 413). Un campo `message` en el body MUST ignorarse.

#### Scenario: Body demasiado grande
- **WHEN** el body supera 5 500 000 bytes
- **THEN** el sistema responde 413 con `{"success":false,"message":"Archivo demasiado grande"}` sin escribir en S3

#### Scenario: Agente repetido
- **WHEN** `files` contiene `Ana` y `ana`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Agente repetido: ana"}`

#### Scenario: Mensaje enviado por un cliente anterior
- **WHEN** el body trae `message:"Hola {first_name}"`
- **THEN** el sistema procesa la carga sin agregar columna `message` y el manifiesto guarda `message:null`

### Requirement: Validación de los CSV por agente
Cada `csv` SHALL tener encabezado con una columna de teléfono (`phone_number`, `contact_phone`, `contact_pho` o `phone`) y al menos una fila no vacía; no se exige mensaje ni columna `message`. Un BOM UTF-8 inicial se elimina. Cualquier incumplimiento responde 400 indicando agente y causa.

#### Scenario: Sin columna de teléfono
- **WHEN** el CSV de `ana.lopez` tiene encabezado `nombre,saldo`
- **THEN** el sistema responde 400 con `{"success":false,"message":"ana.lopez: falta columna de teléfono"}`

#### Scenario: CSV sin columna message
- **WHEN** ningún CSV tiene columna `message` y el body no trae `message`
- **THEN** el sistema acepta la carga

### Requirement: Escritura en el layout que consume el CLI
Por cada archivo el sistema SHALL escribir el CSV recibido, sin agregar ni modificar la columna `message`, en las asignaciones pendientes del agente `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv` y una copia idéntica en `historic/agents/{campaign}/{agent}-contacts-{ts}.csv`, con un mismo `{ts}` para toda la carga. MUST NOT escribir en `agents/`: el agente publica desde "Mi asignación" (`v3/agent-workspace`).

#### Scenario: Carga a dos agentes
- **WHEN** se cargan archivos para `ana.lopez` y `luis` en `prueba`
- **THEN** existen `assignments/agents/prueba/ana.lopez-contacts-{ts}.csv` y `assignments/agents/prueba/luis-contacts-{ts}.csv` con sus copias en `historic/`, y `GET /get/chats/ana.lopez/prueba` no los entrega

#### Scenario: Pendientes visibles para el agente
- **WHEN** termina la carga
- **THEN** `ana.lopez` ve su archivo en `GET /agent/assignments/prueba`

### Requirement: Fallo parcial de la carga de administración
Si falla la escritura de algún archivo, el sistema SHALL intentar borrar los objetos `assignments/agents/...` ya escritos de esa carga, registrar el manifiesto con `status:"failed"` y responder 500 con `{"success":false,"message":"Error interno del servidor","data":{"written":[...],"rolledBack":[...]}}`.

#### Scenario: Error en el tercer archivo
- **WHEN** la escritura del tercero de cinco archivos falla
- **THEN** los dos primeros archivos de `assignments/agents/` se borran, el manifiesto queda `failed` y la respuesta lista lo escrito y lo revertido

### Requirement: Manifiesto de la carga de administración
Cada carga SHALL registrarse en `uploads/{campaign}/{uploadId}.json` con `{"schemaVersion":1,"uploadId","campaign","fileName","mode","uploadedBy","uploadedAt","status","destination":"assignments","message":null,"totalRows","perAgent":[{"agent","rows","key","historicKey"}]}`, `status` `completed` o `failed` y `key` la llave bajo `assignments/agents/`. Ese prefijo MUST NOT estar bajo `agents/`.

#### Scenario: Carga completada
- **WHEN** una carga de 120 filas para dos agentes termina bien
- **THEN** el manifiesto tiene `status:"completed"`, `destination:"assignments"`, `totalRows:120` y una entrada por agente con sus llaves
- **AND** la respuesta es 200 con `{"success":true,"data":<manifiesto>}`

### Requirement: Identificador de carga en las filas entregadas
La carga de administración SHALL agregar a cada archivo por agente, como última columna, `ana_upload_id` con el `uploadId` de la carga en todas las filas, tanto en `assignments/agents/` como en `historic/`. Si el encabezado recibido ya contiene `ana_upload_id` (sin distinguir mayúsculas), MUST responder 400 `{"success":false,"message":"<agente>: columna reservada ana_upload_id"}` sin escribir nada.

#### Scenario: Carga con identificador
- **WHEN** se confirma la carga `20261026T1530-ab12cd34` con encabezado `phone_number,first_name`
- **THEN** `assignments/agents/prueba/ana.lopez-contacts-{ts}.csv` tiene encabezado `phone_number,first_name,ana_upload_id` y cada fila termina en `20261026T1530-ab12cd34`

#### Scenario: Columna reservada en el archivo
- **WHEN** el CSV de `luis` ya trae la columna `ANA_UPLOAD_ID`
- **THEN** el sistema responde 400 con `luis: columna reservada ana_upload_id` y no escribe ningún archivo

#### Scenario: Fila reportada por revisar
- **WHEN** el agente publica esas filas desde "Mi asignación" y el CLI reporta en `review` una de ellas
- **THEN** la fila guardada en `review/prueba/ana.lopez/{assignment_id}.csv` conserva `ana_upload_id` igual a `20261026T1530-ab12cd34`
