# Design

## Context

- Base: `add-admin-web-foundation` (BFF, acceso) y `add-agent-roster-management` (agentes derivados de roles en `campaign-agents/{campaign}.json` + excepciones en `rosters/{campaign}.json` y en la tabla v4; regla efectiva de habilitación; authorizer `cognitoAdminJwt`, helper `requireAdminAccess`). "Agentes habilitados" en este cambio = regla efectiva de cada flota.
- v3 hoy (`openspec/specs/v3/agent-assignments`): el CLI consume con `GET /get/chats/{agent}/{campaign}` el archivo más antiguo `agents/{campaign}/{agent}-contacts*.csv` y lo borra. La carga de supervisor escribe por defecto en `assignments/agents/...`, que nada promueve, así que solo `direct=true` llega al CLI. El parser del CLI (`agent-config.js`) separa por `\n`, no admite saltos de línea dentro de campos y descarta filas con menos columnas que el encabezado; mapea `phone_number|contact_phone|contact_pho|phone` a teléfono e interpola `{var}` en `message`.
- v4 hoy: `POST /uploads/presign` firma metadata (`operatorid`, `campaign`, `distribute`, `assignments` ≤ 1500 chars, `template`, `countrycode`, `phonecolumn`); `csvTrigger` parsea con `csv-parse` (`columns`, `trim`, `skip_empty_lines`), normaliza alias, filtra filas con teléfono y asigna `targets[i % n]` con la lista expandida de pesos en el orden de `Object.entries`. No hay historial.

## Goals / Non-Goals

**Goals:**
- Lo que el supervisor ve en la vista previa es exactamente lo que recibe cada agente.
- Usar en v3 el layout que el CLI ya consume, sin release del CLI.

**Non-Goals:**
- Subidas de más de 4 MB a v3 (requeriría presign a S3 en v3; se deja para cuando haga falta).
- Reemplazar o retirar la ruta de supervisor con `X-Admin-Key`.
- Contactos "por revisar" en el detalle de una carga: los cubre `link-review-contacts-to-uploads`, que agrega la columna `ana_upload_id` a los archivos que escribe D3, el campo opcional `source` del manifiesto (D5) y la reasignación; se archiva después de este cambio.

## Decisions

### D1. Validación y reparto en el navegador, verificación en el BFF
El navegador parsea con `papaparse` (mismas reglas: `trim`, saltar filas vacías, BOM), valida y calcula el plan; nada sale del navegador hasta confirmar. En la confirmación el navegador envía al BFF el archivo y el plan resumido (`agents` en orden + conteos + hash SHA-256 de las asignaciones fila→agente). El BFF vuelve a parsear con la misma función compartida (`src/lib/contacts/plan.ts`, isomórfica), relee el roster vigente y compara; si difiere responde 409.
- Alternativa: subir primero el archivo al BFF para validar — descartada: más latencia y PII en tránsito antes de que el usuario decida.
- Alternativa: confiar en el plan del cliente — descartada: el roster pudo cambiar o el cliente pudo ser alterado.

### D2. Algoritmo de reparto determinista
Filas válidas en orden del archivo; habilitados ordenados por username (comparación de código de punto, no `localeCompare`); fila i → agente `i mod n`. En v4 el orden efectivo de `csvTrigger` es el de `Object.entries(assignments)`: JavaScript ordena primero las llaves con forma de entero. Por eso el plan v4 toma como orden `Object.keys` del objeto `assignments` construido con los habilitados ordenados, y ese mismo orden se usa en la vista previa (para usernames normales coincide con el orden alfabético).
- Alternativa: `distribute` sin `assignments` en v4 — descartada: el trigger resuelve los elegibles al procesar (API del Dashboard), así que la vista previa no podría garantizar el resultado.

### D3. v3: el BFF manda archivos por agente a una ruta nueva
`POST /admin/campaigns/{campaign}/contacts` recibe los CSV ya repartidos (encabezado original + filas válidas del agente) y aplica el mismo procesamiento de `message` que la carga de supervisor (función extraída de `supervisors.ts` a `src/lib/contactsCsv.ts`, sin cambiar su comportamiento). Escribe directo en `agents/` (lo que consume el CLI) + `historic/`, con el mismo `{ts}` para toda la carga. Las copias de `historic/` llevan el username de Cognito y fecha posterior al cutover, así que la purga de `agent_id` legados de `migrate-cli-to-cognito-login` (D12) no las toca.
- Alternativa: llamar N veces a la ruta de supervisor con `direct=true` — descartada: exige `X-Admin-Key` en el BFF, no valida roster, no es atómica ni deja manifiesto.
- Alternativa: escribir en `assignments/` y agregar promoción — descartada: nada del CLI lee `assignments/` y agregar un proceso de promoción no aporta.
- Alternativa: enviar el maestro + plan y repartir en v3 — descartada: duplicaría el algoritmo en otro runtime; con archivos por agente v3 solo valida y escribe.

### D4. Saltos de línea del mensaje en v3
El parser del CLI rompe con saltos de línea dentro de un campo. La ruta convierte CR/LF del `message` a `\n` literal, que el CLI ya interpreta como salto (`v3/automated-sending`, "Saltos de línea literales"). El navegador además marca como inválidas las filas del CSV con saltos de línea dentro de comillas para v3 (causa "Salto de línea dentro de un campo").

### D5. Manifiesto + idempotencia por `uploadId`
`uploads/{campaign}/{uploadId}.json`; `uploadId` = `{ts}-{8 hex}` generado por el BFF al confirmar. Antes de escribir se lee el manifiesto: `completed` → se devuelve tal cual; ausente o `failed` → se procesa. El historial lista `uploads/{campaign}/` (orden por `uploadedAt` tras leer los 50 más recientes por `LastModified`).
- Alternativa: inferir el historial de `historic/` — descartada: no sabe qué archivos son de una misma carga, ni autor, ni modo.

### D6. v4: presign con el token del usuario y PUT desde el BFF
El BFF pide el presign con el id token del usuario (así `operatorid` = el supervisor y aplican los chequeos de v4: upload, distribute, campaña propia y existente, destinatarios habilitados), y hace el `PUT` a la URL firmada desde el servidor con `Content-Type: text/csv` y los headers `x-amz-meta-*` de la `metadata` devuelta. El CSV subido contiene solo las filas válidas, para que `i` del trigger coincida con `i` del plan.
- Alternativa: PUT desde el navegador — viable (el bucket permite CORS), descartada porque el BFF ya tiene el archivo para la verificación D1 y evita exponer la URL firmada.

### D7. Historial v4 en tabla nueva
`ana-backend-uploads-{stage}`: PK `campaign`, SK `srcKey`, atributos del spec, `uploadedAt` para ordenar (GSI no necesario: Query por campaña y orden en memoria de los últimos 180 días, volúmenes bajos), TTL 180 días. `csvTrigger` hace `PutCommand` al final (idempotente por SK). `GET /uploads/history` en el handler `api.ts`.
- Alternativa: listar `csv-uploads/` y leer metadata — descartada: el prefijo es por uploader, no por campaña, y no guarda el resultado del reparto.

### D8. BFF de contactos
- `POST /api/campaigns/{campaign}/uploads` `{fleet, mode, agent?, fileName, csv, message|template, phoneColumn, countryCode, plan:{agents, counts, hash}}` → verificación D1 y entrega D3/D6; responde manifiesto (v3) o `{srcKey}` (v4).
- `GET /api/campaigns/{campaign}/uploads?fleet=&srcKey=` → historial normalizado de ambas flotas.
- Límite de body del route handler: 11 MB (v4) y 4 MB efectivos para v3.

## Risks / Trade-offs

- [Payload de Lambda v3 (6 MB) limita archivos a ~4 MB] → límite explícito en UI y 413 en la ruta; si se vuelve un problema, presign a S3 en v3.
- [Diferencias de parseo navegador vs `csv-parse` de v4 o parser del CLI] → función compartida para el plan; pruebas con los mismos fixtures contra `csv-parse` y contra `parseCSV` del CLI; reglas v3 más estrictas (sin saltos de línea en campos).
- [Escritura parcial en v3] → rollback best-effort de `agents/` y manifiesto `failed`; reintento seguro por `uploadId`.
- [El CLI consume solo un archivo por poll] → varias cargas a un agente se entregan en orden de antigüedad; se informa en la UI.
- [PII en el BFF] → nunca se registra contenido; el archivo vive solo durante la solicitud.

## Migration Plan

1. v4: desplegar tabla de historial, `csvTrigger` con registro y `GET /uploads/history` (aditivo).
2. v3: desplegar `POST /admin/campaigns/{campaign}/contacts` y `GET .../uploads` con `cognitoAdminJwt` (aditivo; requiere la change de roster desplegada).
3. ANA Admin: habilitar la sección Contactos; piloto con un líder por flota.
4. Avisar a supervisores que la carga por `curl`/`setup-campaign.sh` queda como respaldo hasta el retiro de `X-Admin-Key`.
- Rollback: ocultar la sección; las rutas nuevas no afectan a las existentes.

## Decisiones de implementación

**Lógica compartida (admin-web `src/lib/contacts/`)**
- Columna de teléfono en v3: si hay varios alias, se usa el **último** del encabezado (el que termina usando el `parseCSV` del CLI); en v4 la elegida por el usuario o el primer alias encontrado (incluye `telefono`).
- Además de las causas del spec, en v4 una fila con **más** columnas que el encabezado es inválida ("Más columnas que el encabezado"), porque `csv-parse` con `columns:true` rechaza el archivo completo. "Sin teléfono" y "Teléfono con menos de 10 dígitos" se reportan como causas separadas.
- Un teléfono repetido se compara contra las filas **válidas** anteriores (la primera aparición válida se conserva).
- Hash del plan: SHA-256 (`crypto.subtle`, igual en navegador y Node) de `flota|modo|agentes` + `(índice, agente, dígitos del teléfono)` por fila.
- Pruebas de equivalencia: el CLI expone el parser puro `assignment-csv.js` (`parseAssignmentCsv`, tras el merge de `installer-2`), que la prueba importa directamente; contra v4 se usan `csv-parse` y `normalizeContactRow` reales importados de `v4/backend`. El workflow de CI se dispara también con cambios en esos archivos.
- Vista previa del mensaje v4 aproximada (campos simples y `{mensaje}` anidado); el formato de dinero y las expresiones se aplican al enviar en el desktop.

**v3**
- `src/lib/contactsCsv.ts` contiene el procesamiento de `message` extraído de `uploadAgentContacts` (la ruta de supervisor ahora lo llama); una prueba con la copia literal del código anterior fija que la salida es idéntica. `uploadAgentContactsLogging` (sin ruta) conserva su copia inline.
- Orden en `POST /admin/campaigns/{c}/contacts`: campaña (400) → tamaño (413, antes de autorizar y sin S3) → autorización → body → idempotencia → roster (409) → escrituras. Roster ilegible → 500 `Roster ilegible`.
- `totalRows` del manifiesto = filas entregadas (el BFF solo manda filas válidas); `written` lista las llaves de `agents/` escritas y `rolledBack` las que se pudieron borrar. El campo opcional `source` se acepta y se guarda (lo usa `link-review-contacts-to-uploads`).
- La función de carga tiene `timeout: 29` (límite de HTTP API). Verificado con `serverless package` (Framework 3.40 local): las cuatro rutas `/admin/*` quedan con authorizer JWT.

**v4** (implementado por subagente)
- Un fallo al escribir el registro de historial no interrumpe la creación de jobs (log `evt:"upload_history",status:"failed"`).
- Solo se registran cargas cuya metadata trae `campaign`; `too_large` usa `HeadObject` para no descargar el cuerpo; `mode` refleja lo pedido (`assignments` > `distribute` > `self`); `fileName` = `srcKey` sin el prefijo `<epochMs>_`.
- `listUploads` pagina la consulta por campaña y ordena en memoria (sin GSI); la campaña se compara tal cual contra la PK (nombre del catálogo).
- `serverless package` no corre (v4 exige login de Serverless); la tabla, el IAM y la ruta se verifican con una prueba que parsea `serverless.yml` (tarea 3.1 queda abierta por eso).

**ANA Admin**
- Ruta extra `GET /api/campaigns/{c}/enabled-agents?fleet=` para el formulario (habilitados de la flota). Lee los rosters `/admin/*` de v3/v4, que exigen `ana:admin:agents:manage`: un usuario con upload+distribute pero sin ese permiso no puede cargar (líderes y admins lo tienen). Pendiente decidir si v3/v4 deben exponer una lectura de habilitados con permisos de contactos.
- v4: el BFF envía a v4 la campaña tal como viene del catálogo (`campaignRaw`, solo `trim`), y a v3 la normalizada; aplica también a las rutas de Agentes.
- v4: el `PUT` a la URL firmada se hace **sin** headers `x-amz-meta-*`, igual que el desktop: el presigner de v4 sube la metadata a la query firmada (así no hay problemas con acentos o saltos de línea en headers).
- El reintento v3 se hace ante error de red **o** 5xx (seguro por la idempotencia del `uploadId`).
- Sondeo v4 cada 5 s hasta 60 s.
