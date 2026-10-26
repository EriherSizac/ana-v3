# Spec Delta

## ADDED Requirements

### Requirement: Registro de contactos por revisar
`POST /contacts/pending` SHALL aceptar un campo opcional `review: {assignment_id, contacts:[{...}]}`. Si `review.contacts` no está vacío, MUST escribir `review/{campaign}/{agent_id}/{assignment_id}.csv` con el mismo formato CSV que `chats/` y responder además `reviewContacts`. Sin `review` la ruta se comporta como antes. `assignment_id` MUST cumplir `^[A-Za-z0-9_-]{1,64}$` o se responde 400 sin escribir nada.

#### Scenario: Reporte con contactos por revisar
- **WHEN** el CLI envía `contacts` con 3 filas y `review` con `assignment_id` `20261026T1530-ab12cd34` y 1 fila
- **THEN** el sistema sobrescribe `chats/{agent_id}-{campaign}.csv` con las 3 filas y escribe `review/{campaign}/{agent_id}/20261026T1530-ab12cd34.csv` con 1 fila
- **AND** responde 200 con `remainingContacts: 3` y `reviewContacts: 1`

#### Scenario: CLI sin el campo
- **WHEN** un CLI anterior envía solo `{campaign, agent_id, contacts}`
- **THEN** el sistema responde como antes y no escribe nada bajo `review/`

#### Scenario: Identificador inválido
- **WHEN** `review.assignment_id` es `../x` o `review.contacts` no es arreglo
- **THEN** el sistema responde 400 con `{"error":"review inválido"}` sin escribir en S3

### Requirement: Consulta de contactos por revisar
El sistema SHALL exponer `GET /supervisors/review/{campaign}`, con la misma validación de `X-Admin-Key` que las demás rutas de supervisor (antes de acceder a S3), que lista `review/{campaign}/` paginando y responde 200 con `{"success":true,"items":[{"agent","assignmentId","updatedAt","count","csv"}]}` ordenado por `updatedAt` descendente, o `items` vacío si no hay registros.

#### Scenario: Supervisor consulta una campaña
- **WHEN** existe `review/prueba/erick/20261026T1530-ab12cd34.csv` con 2 filas y el supervisor envía la llave correcta
- **THEN** la respuesta incluye `{"agent":"erick","assignmentId":"20261026T1530-ab12cd34","count":2,...}` con el CSV

#### Scenario: Sin llave
- **WHEN** la solicitud no trae `X-Admin-Key` válida
- **THEN** el sistema responde 401 sin listar S3
