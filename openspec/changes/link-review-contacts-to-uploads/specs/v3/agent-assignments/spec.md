# Spec Delta

## ADDED Requirements

### Requirement: Identificador de carga en las filas entregadas
La carga de administración SHALL agregar a cada archivo por agente, como última columna, `ana_upload_id` con el `uploadId` de la carga en todas las filas, tanto en `agents/` como en `historic/`. Si el encabezado recibido ya contiene `ana_upload_id` (sin distinguir mayúsculas), MUST responder 400 `{"success":false,"message":"<agente>: columna reservada ana_upload_id"}` sin escribir nada.

#### Scenario: Carga con identificador
- **WHEN** se confirma la carga `20261026T1530-ab12cd34` con encabezado `phone_number,first_name,message`
- **THEN** `agents/prueba/ana.lopez-contacts-{ts}.csv` tiene encabezado `phone_number,first_name,message,ana_upload_id` y cada fila termina en `20261026T1530-ab12cd34`

#### Scenario: Columna reservada en el archivo
- **WHEN** el CSV de `luis` ya trae la columna `ANA_UPLOAD_ID`
- **THEN** el sistema responde 400 con `luis: columna reservada ana_upload_id` y no escribe ningún archivo

#### Scenario: Fila reportada por revisar
- **WHEN** el CLI reporta en `review` una fila de esa carga
- **THEN** la fila guardada en `review/prueba/ana.lopez/{assignment_id}.csv` conserva `ana_upload_id` igual a `20261026T1530-ab12cd34`

### Requirement: Origen de reasignación en la carga de administración
`POST /admin/campaigns/{campaign}/contacts` SHALL aceptar un campo opcional `source:{"type":"review","fromUploadId","items":[{"agent","assignmentId","phone"}]}` (1 a 5 000 items, `fromUploadId` con el formato de `uploadId` o `none`) y guardarlo tal cual en el manifiesto; con `source`, `mode` MUST ser `single`. Sin `source` la ruta se comporta igual que antes.

#### Scenario: Carga de reasignación
- **WHEN** ANA Admin envía una carga `single` a `luis` con `source` de 3 items de la carga `20261026T1530-ab12cd34`
- **THEN** el manifiesto de la carga nueva incluye `source` con esos 3 items

#### Scenario: Origen con modo de reparto
- **WHEN** el body trae `source` y `mode:"distribute"`
- **THEN** el sistema responde 400 con `{"success":false,"message":"source requiere mode single"}`

### Requirement: Consulta de contactos por revisar por carga
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/review-items?uploadId=<id>|none` que lee `review/{campaign}/` (paginando) y responde 200 con `{"success":true,"data":{"uploadId","items":[{"agent","assignmentId","phone","row","state","stateBy","stateAt","reassignUploadId","targetAgent"}]}}`: con un `uploadId`, las filas cuyo `ana_upload_id` coincide; con `none`, las que no tienen la columna o la traen vacía.

#### Scenario: Carga con dos contactos por revisar
- **WHEN** `review/prueba/ana.lopez/A1.csv` tiene 2 filas con `ana_upload_id` `U1` y 1 fila de `U2`
- **THEN** `uploadId=U1` responde las 2 filas de `ana.lopez` con `state:"pending"`

#### Scenario: Filas sin carga asociada
- **WHEN** una fila de `review/` viene de una carga por `curl` sin la columna
- **THEN** aparece solo con `uploadId=none`

#### Scenario: Parámetro inválido
- **WHEN** falta `uploadId` o no cumple `^[A-Za-z0-9-]{8,64}$` ni es `none`
- **THEN** el sistema responde 400 sin leer S3

### Requirement: Estados de los contactos por revisar
Cada fila por revisar SHALL identificarse por `(agent, assignmentId, phone)` (teléfono solo dígitos) y tener estado `pending` (sin registro), `reassigned` o `discarded`, guardado en `review-state/{campaign}/{agent}/{assignmentId}.json` con `by` (usuario del token), `at` (ISO 8601 UTC) y, si es `reassigned`, `reassignUploadId` y `targetAgent`. Las escrituras MUST ser condicionales con hasta 3 reintentos; agotados, 409.

#### Scenario: Estado registrado
- **WHEN** `erick.silva` descarta el contacto `5215512345678` de `ana.lopez`/`A1`
- **THEN** `review-state/prueba/ana.lopez/A1.json` lo guarda como `discarded` con `by:"erick.silva"` y la fecha

#### Scenario: Dos supervisores a la vez
- **WHEN** dos solicitudes cambian contactos distintos del mismo `assignmentId` al mismo tiempo
- **THEN** el registro final conserva ambos cambios

### Requirement: Resolución de contactos por revisar
`POST /admin/campaigns/{campaign}/review-items/resolve` SHALL recibir `{"action":"discard"|"reassign","items":[{"agent","assignmentId","phone"}],"reassignUploadId"?}` (1 a 5 000 items existentes en `review/`). `reassign` MUST exigir un manifiesto `completed` de `reassignUploadId` cuyo `source.items` contenga todos los items y toma `targetAgent` de él. Un item ya resuelto MUST dar 409 sin cambios, salvo `reassigned` con el mismo `reassignUploadId` (éxito idempotente).

#### Scenario: Marcar reasignados
- **WHEN** la carga `U9` de reasignación terminó `completed` con `source` de 3 items y se resuelve con `reassignUploadId:"U9"`
- **THEN** los 3 items quedan `reassigned` con `reassignUploadId:"U9"` y `targetAgent` del manifiesto

#### Scenario: Reasignación sin carga
- **WHEN** `reassignUploadId` no existe, está `failed` o su `source` no incluye un item
- **THEN** el sistema responde 409 con `{"success":false,"message":"Carga de reasignación no válida"}`

#### Scenario: Item ya resuelto
- **WHEN** un item ya está `discarded`
- **THEN** el sistema responde 409 listando el item y no modifica ningún estado

#### Scenario: Reintento del marcado
- **WHEN** se repite la resolución con el mismo `reassignUploadId` sobre items ya marcados con él
- **THEN** el sistema responde 200 sin cambiar `by` ni `at`

### Requirement: Permisos de la revisión de contactos
Las rutas `review-items*` SHALL aplicar la autorización de `/admin/*` (`v3/backend-api-security`) y exigir admin o `ana:contacts:list:upload` y `ana:contacts:list:distribute` con la campaña (o `*`); si no, MUST responder 403 sin leer S3. Ninguna ruta de revisión MUST escribir ni borrar bajo `review/`.

#### Scenario: Líder de otra campaña
- **WHEN** un líder de `didi_vip` consulta `GET /admin/campaigns/zendere/review-items?uploadId=U1`
- **THEN** el sistema responde 403 con `{"success":false,"message":"Sin permiso"}` sin leer S3
