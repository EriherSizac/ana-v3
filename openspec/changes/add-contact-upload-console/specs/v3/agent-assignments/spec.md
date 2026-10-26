# Spec Delta

## ADDED Requirements

### Requirement: Carga de contactos de administración
El sistema SHALL exponer `POST /admin/campaigns/{campaign}/contacts` (rutas `/admin/*` de `v3/backend-api-security`) con body JSON `{"uploadId","fileName","mode","message"?,"files":[{"agent","csv"}]}`: `uploadId` de 8 a 64 caracteres `[A-Za-z0-9-]`, `mode` `distribute` o `single`, 1 a 200 archivos con agentes distintos tras normalizar (`v3/agent-roster`) y body de hasta 5 500 000 bytes (más grande responde 413).

#### Scenario: Body demasiado grande
- **WHEN** el body supera 5 500 000 bytes
- **THEN** el sistema responde 413 con `{"success":false,"message":"Archivo demasiado grande"}` sin escribir en S3

#### Scenario: Agente repetido
- **WHEN** `files` contiene `Ana` y `ana`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Agente repetido: ana"}`

### Requirement: Permisos de la carga de administración
La carga y la consulta del historial SHALL exigir que el usuario sea admin o tenga `ana:contacts:list:upload` y `ana:contacts:list:distribute` con la campaña normalizada (o `*`) entre sus campañas; si no, MUST responder 403 sin acceder a S3.

#### Scenario: Sin permiso de reparto
- **WHEN** el usuario tiene `ana:contacts:list:upload` pero no `ana:contacts:list:distribute`
- **THEN** el sistema responde 403 con `{"success":false,"message":"Sin permiso"}`

### Requirement: Agentes destino habilitados en el roster
Antes de escribir, el sistema SHALL verificar que cada agente de `files` esté habilitado en el roster de la campaña según la regla de `v3/agent-roster`; si alguno no lo está MUST responder 409 con `{"success":false,"message":"Agentes no habilitados","data":{"agents":[...]}}` sin escribir nada.

#### Scenario: Agente deshabilitado tras la vista previa
- **WHEN** `luis` fue deshabilitado en `prueba` después de la vista previa y la carga lo incluye
- **THEN** el sistema responde 409 listando `luis` y no escribe ningún archivo

### Requirement: Validación de los CSV por agente
Cada `csv` SHALL tener encabezado con una columna de teléfono (`phone_number`, `contact_phone`, `contact_pho` o `phone`) y al menos una fila no vacía; si el encabezado no contiene `message`, `message` del body MUST ser no vacío. Un BOM UTF-8 inicial se elimina. Cualquier incumplimiento responde 400 indicando agente y causa.

#### Scenario: Sin columna de teléfono
- **WHEN** el CSV de `ana.lopez` tiene encabezado `nombre,saldo`
- **THEN** el sistema responde 400 con `{"success":false,"message":"ana.lopez: falta columna de teléfono"}`

#### Scenario: Sin mensaje
- **WHEN** ningún CSV tiene columna `message` y el body no trae `message`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Mensaje requerido"}`

### Requirement: Escritura en el layout que consume el CLI
Por cada archivo el sistema SHALL escribir el CSV procesado (columna `message` como en "Procesamiento del CSV con columna message", con saltos de línea del mensaje convertidos a `\n` literal) en `agents/{campaign}/{agent}-contacts-{ts}.csv` y una copia idéntica en `historic/agents/{campaign}/{agent}-contacts-{ts}.csv`, con un mismo `{ts}` para toda la carga y sin escribir en `assignments/`.

#### Scenario: Carga a dos agentes
- **WHEN** se cargan archivos para `ana.lopez` y `luis` en `prueba`
- **THEN** existen `agents/prueba/ana.lopez-contacts-{ts}.csv` y `agents/prueba/luis-contacts-{ts}.csv` con sus copias en `historic/`, y `GET /get/chats/ana.lopez/prueba` entrega el archivo de `ana.lopez`

#### Scenario: Mensaje con salto de línea
- **WHEN** `message` es `Hola {first_name}` + salto de línea + `Saldo: {total_balance}`
- **THEN** cada fila termina con el mensaje en una sola línea con `\n` literal entre ambas partes

### Requirement: Fallo parcial de la carga de administración
Si falla la escritura de algún archivo, el sistema SHALL intentar borrar los objetos `agents/...` ya escritos de esa carga, registrar el manifiesto con `status:"failed"` y responder 500 con `{"success":false,"message":"Error interno del servidor","data":{"written":[...],"rolledBack":[...]}}`.

#### Scenario: Error en el tercer archivo
- **WHEN** la escritura del tercero de cinco archivos falla
- **THEN** los dos primeros archivos de `agents/` se borran, el manifiesto queda `failed` y la respuesta lista lo escrito y lo revertido

### Requirement: Manifiesto de la carga de administración
Cada carga SHALL registrarse en `uploads/{campaign}/{uploadId}.json` con `{"schemaVersion":1,"uploadId","campaign","fileName","mode","uploadedBy","uploadedAt","status","message","totalRows","perAgent":[{"agent","rows","key","historicKey"}]}`, `status` `completed` o `failed`. Ese prefijo MUST NOT estar bajo `agents/`.

#### Scenario: Carga completada
- **WHEN** una carga de 120 filas para dos agentes termina bien
- **THEN** el manifiesto tiene `status:"completed"`, `totalRows:120` y una entrada por agente con sus llaves
- **AND** la respuesta es 200 con `{"success":true,"data":<manifiesto>}`

### Requirement: Idempotencia por uploadId
Si ya existe un manifiesto `completed` con el mismo `uploadId` en la campaña, el sistema SHALL responder 200 con ese manifiesto sin escribir archivos nuevos; si existe uno `failed`, MUST procesar la carga de nuevo y sobrescribirlo.

#### Scenario: Doble envío
- **WHEN** ANA Admin reintenta la misma carga por un timeout de red
- **THEN** el segundo envío responde 200 con el manifiesto original y el agente no recibe archivos duplicados

### Requirement: Historial de cargas de administración
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/uploads` que responde 200 con `{"success":true,"data":{"campaign","items":[<manifiesto sin message>]}}`, las 50 cargas más recientes por `uploadedAt` descendente, con `items` vacío si no hay ninguna.

#### Scenario: Consulta del historial
- **WHEN** un líder de `prueba` consulta el historial
- **THEN** recibe las cargas de `prueba` de la más reciente a la más antigua, sin el texto del mensaje
