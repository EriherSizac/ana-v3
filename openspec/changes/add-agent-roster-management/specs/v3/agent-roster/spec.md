# Spec Delta

## Purpose

Definir el roster de agentes habilitados por campaña del backend v3 (almacenamiento en S3, forma del JSON y regla de habilitación) que reemplaza al `credentials.csv` como fuente de pertenencia, y las rutas con las que ANA Admin lo administra.

## ADDED Requirements

### Requirement: Normalización de campaña y agente
El sistema SHALL normalizar campaña y username quitando espacios laterales y convirtiendo a minúsculas antes de leer o escribir el roster. La campaña normalizada MUST cumplir `^[a-z0-9][a-z0-9._-]{0,63}$` y el username `^[a-z0-9][a-z0-9._@+-]{0,127}$`; un valor que no cumpla se rechaza con 400 sin acceder a S3.

#### Scenario: Valores con mayúsculas y espacios
- **WHEN** se administra el agente ` Erick.Silva ` en la campaña `DIDI_VIP `
- **THEN** el sistema usa el agente `erick.silva` y la campaña `didi_vip`

#### Scenario: Campaña con barra
- **WHEN** la campaña es `ventas/norte`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Campaña inválida"}`

### Requirement: Ubicación del roster
El sistema SHALL guardar un objeto por campaña en el bucket `ana-backend-storage-{stage}` con llave `rosters/{campaign}.json` (campaña normalizada) y `Content-Type: application/json`. El prefijo `rosters/` MUST NOT usarse para otros objetos y el roster MUST NOT guardarse bajo `agents/`.

#### Scenario: Llave del roster
- **WHEN** se habilita un agente en la campaña `prueba`
- **THEN** el roster queda en `rosters/prueba.json`

### Requirement: Forma del documento de roster
El roster SHALL ser JSON `{"schemaVersion":1,"campaign","updatedAt","updatedBy","agents":{"<username>":{"enabled","updatedAt","updatedBy"}}}`: `campaign` y las llaves de `agents` normalizadas, `enabled` booleano, fechas ISO 8601 UTC y `updatedBy` el username normalizado de quien hizo el cambio. Los agentes deshabilitados MUST conservarse con `enabled:false`.

#### Scenario: Documento tras dos cambios
- **WHEN** `erick.silva` habilita a `ana.lopez` y luego la deshabilita en `prueba`
- **THEN** `rosters/prueba.json` contiene `"agents":{"ana.lopez":{"enabled":false,"updatedAt":"<fecha del segundo cambio>","updatedBy":"erick.silva"}}`

### Requirement: Regla de habilitación del roster
Un agente SHALL considerarse habilitado en una campaña solo si `rosters/{campaign}.json` existe, es JSON válido con `schemaVersion` igual a 1 y `agents[<username normalizado>].enabled` es exactamente `true`. Si el objeto no existe, la campaña no tiene agentes habilitados; si es ilegible o de otra versión, todo lector MUST tratarlo como error y no habilitar a nadie.

#### Scenario: Campaña sin roster
- **WHEN** no existe `rosters/ventas.json`
- **THEN** ningún agente está habilitado en `ventas`

#### Scenario: Roster de versión desconocida
- **WHEN** `rosters/prueba.json` tiene `"schemaVersion":2`
- **THEN** el lector reporta error de roster y no considera habilitado a ningún agente

#### Scenario: Valor no booleano
- **WHEN** un agente tiene `"enabled":"true"` (texto)
- **THEN** el agente no está habilitado

### Requirement: Consulta del roster
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/roster` que responde 200 con `{"success":true,"data":{"campaign","updatedAt","updatedBy","agents":[{"username","enabled","updatedAt","updatedBy"}]}}`, con `agents` ordenado por username y vacío (y `updatedAt`/`updatedBy` nulos) si la campaña no tiene roster.

#### Scenario: Campaña con roster
- **WHEN** un usuario autorizado consulta el roster de `prueba` con dos agentes
- **THEN** el sistema responde 200 con ambos agentes, habilitados y deshabilitados

#### Scenario: Roster ilegible
- **WHEN** el objeto existe pero no es JSON válido o su versión no es 1
- **THEN** el sistema responde 500 con `{"success":false,"message":"Roster ilegible"}` sin modificarlo

### Requirement: Actualización del roster
El sistema SHALL exponer `POST /admin/campaigns/{campaign}/roster/agents` con body `{"agents":[{"username","enabled"}]}` (1 a 200 entradas, sin usernames repetidos tras normalizar) que inserta o actualiza cada entrada, conserva las demás y responde 200 con el roster completo en el mismo formato que la consulta.

#### Scenario: Alta de dos agentes
- **WHEN** se envía `{"agents":[{"username":"Ana.Lopez","enabled":true},{"username":"luis","enabled":true}]}` para `prueba`
- **THEN** `rosters/prueba.json` incluye a `ana.lopez` y `luis` habilitados con `updatedBy` igual al usuario del token, y la respuesta es 200

#### Scenario: Body inválido
- **WHEN** el body no es JSON, `agents` está vacío, tiene más de 200 entradas, repite un username o algún `enabled` no es booleano
- **THEN** el sistema responde 400 con `{"success":false,"message":<causa>}` sin escribir en S3

### Requirement: Escritura concurrente del roster
Cada actualización SHALL hacerse como lectura-modificación-escritura condicional sobre el objeto (solo si no cambió desde la lectura, o solo si no existe al crearlo), reintentando hasta 3 veces ante conflicto; si los reintentos se agotan MUST responder 409 sin perder cambios de otros escritores.

#### Scenario: Dos supervisores a la vez
- **WHEN** dos solicitudes actualizan agentes distintos del mismo roster al mismo tiempo
- **THEN** el roster final contiene los cambios de ambas

#### Scenario: Conflicto persistente
- **WHEN** las 3 escrituras condicionales fallan por cambios concurrentes
- **THEN** el sistema responde 409 con `{"success":false,"message":"El roster cambió, intenta de nuevo"}`

### Requirement: Autorización de la administración del roster
Las rutas del roster SHALL exigir que el usuario del token sea admin o tenga `ana:admin:agents:manage` con la campaña normalizada (o `*`) entre sus campañas, según la autorización de `/admin/*` de `v3/backend-api-security`; si no, MUST responder 403 sin acceder a S3.

#### Scenario: Líder de otra campaña
- **WHEN** un líder de `didi_vip` intenta actualizar el roster de `zendere`
- **THEN** el sistema responde 403 con `{"success":false,"message":"Sin permiso para esta campaña"}`

### Requirement: Roster fuera de rutas públicas
El contenido del roster MUST NOT ser legible ni modificable por rutas sin autenticación ni por rutas protegidas solo con `X-Admin-Key`; solo las rutas `/admin/*` lo exponen y los lectores internos (autenticación de agente) lo leen directamente de S3.

#### Scenario: Lectura con llave de administración
- **WHEN** se llama a `GET /admin/campaigns/prueba/roster` con solo `X-Admin-Key`
- **THEN** la solicitud es rechazada con 401 por falta de token
