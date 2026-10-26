# csv-ingestion Specification

## Purpose
Permitir que líderes y administradores suban CSV de contactos al bucket `ana-backend-csv-<stage>` mediante URL prefirmada con configuración firmada en metadata, y convertir automáticamente cada CSV subido en send-jobs de DynamoDB asignados al propio uploader, a un reparto ponderado o en round-robin entre los agentes activos elegibles de la campaña.

> Nota: la documentación (`ARCHITECTURE.md`) dice que el reparto usa la tabla de heartbeat `agents`; el código actual usa la API de agentes del Dashboard (`GET /users/campaign/{campaign}`).

## Requirements

### Requirement: Autorización para subir
`POST /uploads/presign` MUST permitirse solo si el usuario es admin, es líder o tiene explícitamente `ana:contacts:list:upload`, sin importar `PERMISSIONS_ENFORCED`; en otro caso responde 403 `{"error":"sin permiso"}`.

#### Scenario: Agente sin permiso
- **WHEN** un agente sin rol de líder ni grant de upload pide presign
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

### Requirement: Validación de campaña destino
La campaña SHALL ser `campaign` del body o, si falta, la primera campaña del usuario; si queda vacía MUST responder 400 `{"error":"falta campaign"}`. Si el usuario no es admin ni tiene `*`, la campaña MUST estar entre las suyas (403 `{"error":"campaña no permitida"}`) y MUST existir en `SELECT name FROM campaigns` de PostgreSQL (400 `{"error":"la campaña \"<x>\" no existe"}`).

#### Scenario: Campaña con typo
- **WHEN** un admin pide presign con `campaign: "didi_vipp"` inexistente en el catálogo
- **THEN** el sistema responde 400 `{"error":"la campaña \"didi_vipp\" no existe"}`

#### Scenario: Catálogo no disponible
- **WHEN** PostgreSQL no responde y no hay lista cacheada
- **THEN** la validación de existencia se omite y la campaña se acepta

> Nota: el catálogo se cachea 10 minutos por contenedor y, si la DB falla, se sirve la última lista conocida; una lista vacía equivale a "todas existen".

### Requirement: Permiso de reparto y pesos explícitos
Si `distribute` es verdadero, el usuario MUST tener `ana:contacts:list:distribute` (sujeto al flag) o recibe 403 `{"error":"sin permiso para repartir"}`. `assignments` `{operatorId: peso}` SHALL requerir reparto (403 `{"error":"assignments requiere distribute"}`), conservar solo pesos enteros positivos (si ninguno, 400 `{"error":"assignments sin pesos válidos"}`) y no exceder 1500 caracteres serializado (400 `{"error":"assignments demasiado grande"}`).

#### Scenario: Pesos mixtos
- **WHEN** se envía `distribute: true` y `assignments: {"a":2.7,"b":0,"c":"x"}`
- **THEN** solo se conserva `{"a":2}`

> Nota: los `operatorId` de `assignments` no se validan contra agentes de la campaña; un líder puede asignar jobs a cualquier username.

### Requirement: Presign de CSV con metadata firmada
El sistema SHALL responder 200 `{url,key,maxBytes,metadata,eligibleAgents?}` con un PUT prefirmado (300 s, `Content-Type: text/csv`) a `csv-uploads/<usuario>/<epochMs>_<filename>` (saneado, default `upload.csv`; `.`/`..` → 400). La metadata MUST incluir `operatorid`, `template` (default `{mensaje}`), `countrycode` (`52`), `phonecolumn` (`telefono`), `campaignid` (default la key), `distribute` (`1`/`0`), `campaign` y `assignments` si aplica.

#### Scenario: Preview del reparto
- **WHEN** un líder pide presign con `distribute: true` sin `assignments`
- **THEN** la respuesta incluye `eligibleAgents` con los agentes que recibirían los jobs y `maxBytes: 10485760`

> Nota: `maxBytes` es informativo; la URL prefirmada no limita el tamaño del archivo subido.

### Requirement: Agentes elegibles de la campaña
El sistema SHALL obtener agentes elegibles con `GET {DASHBOARD_BASE_PATH}/users/campaign/{campaign}` (`X-Api-Key`), quedándose con usuarios `active === true`, cuyo email no coincida con `@pernexium.com.mx` ni `@dirsa`, y que tengan el rol `AGENT_ROLE_<CAMPAÑA EN MAYÚSCULAS>` si esa variable existe; devuelve `username` (o `user_id`). Ante error MUST devolver lista vacía.

#### Scenario: Usuarios internos excluidos
- **WHEN** la API devuelve un usuario activo con email `x@pernexium.com.mx`
- **THEN** no se incluye entre los elegibles

> Nota: ninguna variable `AGENT_ROLE_*` está declarada en `serverless.yml`, así que el filtro por rol no se aplica en despliegues normales.

### Requirement: Borrado de CSV propio
`POST /uploads/delete` con `{key}` SHALL borrar el objeto solo si `key` empieza con `csv-uploads/<usuario saneado>/` y responder 200 `{"deleted":key}`; en otro caso MUST responder 403 `{"error":"key no permitida"}`.

#### Scenario: CSV ajeno
- **WHEN** un usuario intenta borrar `csv-uploads/otro/123_a.csv`
- **THEN** el sistema responde 403 `{"error":"key no permitida"}`

### Requirement: Conversión de CSV en send-jobs
Ante `s3:ObjectCreated` en `csv-uploads/*.csv`, el sistema SHALL ignorar objetos de más de 10 MB, sin `operatorid` en metadata o con más de 50 000 filas; parsear con encabezados, recortando espacios y omitiendo líneas vacías; normalizar alias de columnas; y crear un job por fila con teléfono no vacío (columna `phonecolumn`, o alias `phone`).

#### Scenario: CSV de formato v3
- **WHEN** se sube un CSV con columnas `phone_number,total_balance,message` y `phonecolumn = telefono`
- **THEN** cada fila con teléfono genera un job y la fila incluye también `telefono`, `saldo` y `mensaje`

#### Scenario: Filas sin teléfono
- **WHEN** una fila no trae teléfono en ninguna columna equivalente
- **THEN** no genera job

> Nota: un CSV malformado hace fallar la invocación completa (sin respuesta al usuario); `MAX_ROWS` se evalúa después de parsear todo el archivo; los items no procesados de cada BatchWrite no se reintentan y pueden perderse en silencio.

### Requirement: Normalización de alias de columnas
Cada fila SHALL rellenar las columnas vacías de cada grupo de alias con el primer valor no vacío del grupo: `phone`/`phone_number`/`contact_phone`/`contact_pho`/`telefono`; `name`/`nombre`/`contact_name`; `first_name`/`nombre_pila`; `last_name`/`apellido`; `credit`/`credito`/`credit_id`/`id_credito`; `discount`/`descuento`; `total_balance`/`total_balanc`/`balance`/`saldo`; `product`/`producto`; `message`/`mensaje`. Sin `name` MUST usar `first_name last_name`.

#### Scenario: Solo nombre de pila y apellido
- **WHEN** la fila trae `first_name = "Ana"` y `last_name = "López"`
- **THEN** la fila resultante tiene `name` y `nombre` igual a `"Ana López"`

### Requirement: Selección de destinatarios
Los jobs SHALL asignarse por índice de fila válida `i` a `targets[i % N]`, donde `targets` es: la lista expandida por pesos si hay `assignments` (p. ej. `{a:2,b:1}` → `[a,a,b]`); si no, los agentes elegibles si `distribute = 1`; y el uploader cuando no hay reparto o la lista resultante queda vacía.

#### Scenario: Reparto sin agentes elegibles
- **WHEN** `distribute = 1` y la API del Dashboard no devuelve agentes
- **THEN** todos los jobs quedan asignados al uploader

### Requirement: Forma del job generado
Cada job MUST escribirse en `ana-backend-jobs-<stage>` con `operatorId` destino, `jobId = "<campaignId>#<índice>"`, `campaignId`, `campaign` (omitido si vacío), `phone`, `template`, `row` normalizada, `countryCode`, `srcKey` = key del CSV, `status: "pending"`, `leaseUntil: 0`, `attempts: 0` y `ttl` a 7 días.

#### Scenario: Dos CSV con el mismo campaignId
- **WHEN** dos subidas usan el mismo `campaignId` explícito para el mismo agente
- **THEN** los jobs de la segunda sobrescriben a los de la primera con el mismo índice

> Nota: el trigger no borra el CSV de S3; según la documentación lo borra el desktop al terminar el archivo usando `srcKey`.
