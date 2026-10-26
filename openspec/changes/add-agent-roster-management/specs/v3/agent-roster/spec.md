# Spec Delta

## Purpose

Definir quién es agente ANA de una campaña en v3: la lista se deriva automáticamente de los usuarios del pool de Cognito con un rol de la campaña que otorga `ana:campaign:message:send`, y el roster por campaña solo guarda las excepciones (deshabilitaciones) que decide un administrador. Reemplaza al `credentials.csv` como fuente de pertenencia y fija el contrato que leen la autenticación del CLI y la carga de contactos.

## ADDED Requirements

### Requirement: Normalización de campaña y agente
El sistema SHALL normalizar campaña y username quitando espacios laterales y convirtiendo a minúsculas antes de derivar, leer o escribir. La campaña normalizada MUST cumplir `^[a-z0-9][a-z0-9._-]{0,63}$` y el username `^[a-z0-9][a-z0-9._@+-]{0,127}$`; un valor que no cumpla se rechaza con 400 sin acceder a S3.

#### Scenario: Valores con mayúsculas y espacios
- **WHEN** se administra el agente ` Erick.Silva ` en la campaña `DIDI_VIP `
- **THEN** el sistema usa el agente `erick.silva` y la campaña `didi_vip`

#### Scenario: Campaña con barra
- **WHEN** la campaña es `ventas/norte`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Campaña inválida"}`

### Requirement: Definición de agente de una campaña
Un usuario SHALL ser agente de la campaña X si existe en el pool `us-east-2_UepfOyKpd` con `Enabled` verdadero y estado `CONFIRMED` o `FORCE_CHANGE_PASSWORD`, y tiene en la API de Roles al menos un rol cuyo `campaign_name` normalizado es X y que otorga `ana:campaign:message:send`. Un rol con `campaign_name` `*` MUST NOT hacer agente a nadie; ser líder o admin no basta.

#### Scenario: Agente con rol de envío
- **WHEN** `ana.lopez` está habilitada y `CONFIRMED` en el pool y tiene el rol `Agente DIDI VIP` (`campaign_name` `DIDI_VIP`) que otorga `ana:campaign:message:send`
- **THEN** `ana.lopez` es agente de `didi_vip`

#### Scenario: Líder sin envío explícito
- **WHEN** `luis` solo tiene `Líder DIDI VIP` y ese rol no otorga `ana:campaign:message:send` de forma explícita
- **THEN** `luis` no es agente de `didi_vip`

#### Scenario: Rol global
- **WHEN** `erick.silva` solo tiene `Developer` con `campaign_name` `*`
- **THEN** no es agente de ninguna campaña

#### Scenario: Usuario deshabilitado en Cognito
- **WHEN** un usuario con rol de envío en `prueba` tiene `Enabled:false` o estado `RESET_REQUIRED` en el pool
- **THEN** no es agente de `prueba`

#### Scenario: Usuario nuevo con contraseña temporal
- **WHEN** el usuario está en `FORCE_CHANGE_PASSWORD` y tiene rol de envío en `prueba`
- **THEN** es agente de `prueba`

### Requirement: Permiso de envío de un rol
Todo rol SHALL otorgar `ana:campaign:message:send` por defecto (permiso por defecto de v4), salvo que su catálogo local de v4 (por `role_id`) o sus permisos inline (`permissions[].permission_name`) traigan `-ana:campaign:message:send`. Los roles de líder (nombre con "líder"/"lider") o que otorgan `ana:admin:console:manage` MUST otorgarlo solo con el permiso explícito.

#### Scenario: Rol de agente sin configuración
- **WHEN** el rol `Agente DIDI VIP` no tiene entradas en el catálogo local de v4 ni permisos `ana:*` inline
- **THEN** el rol otorga envío y sus usuarios son agentes de `didi_vip`

#### Scenario: Envío desactivado en el rol
- **WHEN** el catálogo local de v4 del rol `c288ee3e-…` incluye `-ana:campaign:message:send`
- **THEN** el rol no otorga envío

#### Scenario: Líder con envío explícito
- **WHEN** el rol `Líder DIDI VIP` tiene `ana:campaign:message:send` explícito en el catálogo local
- **THEN** sus usuarios son agentes de `didi_vip`

#### Scenario: Admin sin envío explícito
- **WHEN** un rol de `prueba` otorga `ana:admin:console:manage` y no trae `ana:campaign:message:send` explícito
- **THEN** ese rol no hace agente de `prueba` a sus usuarios

### Requirement: Lectura de roles desde la API de Roles
La derivación SHALL leer roles con `X-Api-Key`: `GET /users` para enumerar usuarios y `GET /users/{username}` como fuente de cada usuario candidato, normalizando cada rol a `role_id` (`role_id` o `id`), `role_name` (`role_name` o `name`) y `campaign_name` (`campaign_name` o `campaign`). MUST NOT llamar `/roles/{id}/permissions` ni leer `.id`/`.name` de un permiso.

#### Scenario: Forma del listado
- **WHEN** `GET /users` devuelve roles `{"id","name","campaign"}`
- **THEN** la derivación los normaliza a `role_id`, `role_name` y `campaign_name` y usa `GET /users/{username}` para sus permisos inline

### Requirement: Lista derivada de agentes por campaña
La lista derivada SHALL guardarse en `campaign-agents/{campaign}.json` del bucket `ana-backend-storage-{stage}` como `{"schemaVersion":1,"campaign","generatedAt","agents":[{"username","cognitoUsername","roleIds"}]}` por cada campaña del catálogo de v4, con `agents` vacío si no tiene agentes, `username` normalizado (orden) y `cognitoUsername` tal como lo emite el pool. Solo la sincronización de `v4/agent-roster` MUST escribirla.

#### Scenario: Campaña sin agentes
- **WHEN** ningún usuario cumple la definición para `ventas`, que existe en el catálogo
- **THEN** `campaign-agents/ventas.json` existe con `agents` vacío

### Requirement: Excepciones del roster por campaña
El roster SHALL guardarse en `rosters/{campaign}.json` como `{"schemaVersion":2,"campaign","updatedAt","updatedBy","overrides":{"<username>":{"enabled","updatedAt","updatedBy"}}}`, con `enabled` booleano y `updatedBy` el username normalizado de quien cambió. Solo guarda excepciones: un agente sin entrada está habilitado. El prefijo `rosters/` MUST NOT usarse para otros objetos ni guardarse bajo `agents/`.

#### Scenario: Deshabilitación registrada
- **WHEN** `erick.silva` deshabilita a `ana.lopez` en `prueba`
- **THEN** `rosters/prueba.json` contiene `"overrides":{"ana.lopez":{"enabled":false,"updatedAt":"<fecha>","updatedBy":"erick.silva"}}`

### Requirement: Regla de habilitación efectiva
Un agente SHALL estar habilitado en X solo si figura en `campaign-agents/{X}.json` (JSON válido, `schemaVersion` 1, `generatedAt` de hace 24 h o menos) y en `rosters/{X}.json` no tiene `enabled:false`. Lista inexistente = sin agentes. Lista ilegible, de otra versión o vencida, o roster ilegible o de versión distinta de 2, MUST ser error y no habilitar a nadie.

#### Scenario: Agente derivado sin excepción
- **WHEN** `ana.lopez` está en la lista derivada de `prueba` y no hay roster
- **THEN** está habilitada en `prueba`

#### Scenario: Agente deshabilitado por un administrador
- **WHEN** `ana.lopez` está en la lista derivada y el roster la tiene con `enabled:false`
- **THEN** no está habilitada

#### Scenario: Pierde el rol con excepción guardada
- **WHEN** `luis` tiene `enabled:true` en el roster pero ya no figura en la lista derivada
- **THEN** no está habilitado; si recupera el rol, vuelve a estar habilitado salvo que su entrada diga `enabled:false`

#### Scenario: Lista vencida
- **WHEN** `generatedAt` de `campaign-agents/prueba.json` tiene más de 24 h
- **THEN** el lector reporta error de roster y no habilita a nadie

#### Scenario: Valor no booleano
- **WHEN** una excepción tiene `"enabled":"false"` (texto)
- **THEN** el roster es ilegible y el lector reporta error

### Requirement: Consulta del roster
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/roster` que responde 200 con `{"success":true,"data":{"campaign","generatedAt","agents":[{"username","enabled","override"}],"inactiveOverrides":[...]}}`: `agents` = lista derivada ordenada con su estado efectivo y excepción (o `null`); `inactiveOverrides` = excepciones de usuarios que ya no están en la lista.

#### Scenario: Campaña con una excepción
- **WHEN** la lista derivada de `prueba` tiene `ana.lopez` y `luis` y el roster deshabilita a `luis`
- **THEN** la respuesta muestra `ana.lopez` habilitada con `override:null` y `luis` deshabilitado con autor y fecha

#### Scenario: Lista ilegible
- **WHEN** la lista derivada o el roster son ilegibles o están vencidos
- **THEN** el sistema responde 500 con `{"success":false,"message":"Roster ilegible"}` sin modificarlos

### Requirement: Actualización del roster
El sistema SHALL exponer `POST /admin/campaigns/{campaign}/roster/agents` con `{"agents":[{"username","enabled"}]}` (1 a 200, sin repetidos tras normalizar) que guarda cada excepción, conserva las demás y responde como la consulta. `enabled:false` se acepta para cualquier username válido; `enabled:true` para uno fuera de la lista derivada MUST responder 409 sin escribir.

#### Scenario: Deshabilitar y rehabilitar
- **WHEN** se envía `enabled:false` y luego `enabled:true` para `ana.lopez`, que está en la lista derivada
- **THEN** queda habilitada con la excepción `enabled:true` y `updatedBy` del último cambio

#### Scenario: Habilitar a quien no es agente
- **WHEN** se envía `enabled:true` para `luis`, que no tiene rol de envío en `prueba`
- **THEN** el sistema responde 409 con `{"success":false,"message":"No es agente de la campaña","data":{"agents":["luis"]}}`

#### Scenario: Body inválido
- **WHEN** el body no es JSON, `agents` está vacío, tiene más de 200 entradas, repite un username o algún `enabled` no es booleano
- **THEN** el sistema responde 400 con `{"success":false,"message":<causa>}` sin escribir en S3

### Requirement: Escritura concurrente del roster
Cada actualización SHALL hacerse como lectura-modificación-escritura condicional sobre `rosters/{campaign}.json` (solo si no cambió desde la lectura, o solo si no existe al crearlo), reintentando hasta 3 veces ante conflicto; si los reintentos se agotan MUST responder 409 sin perder cambios de otros escritores.

#### Scenario: Dos supervisores a la vez
- **WHEN** dos solicitudes cambian excepciones distintas del mismo roster al mismo tiempo
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
`rosters/` y `campaign-agents/` MUST NOT ser legibles ni modificables por rutas sin autenticación ni por rutas protegidas solo con `X-Admin-Key`; solo las rutas `/admin/*` los exponen y los lectores internos (autenticación de agente, carga de contactos) los leen directamente de S3.

#### Scenario: Lectura con llave de administración
- **WHEN** se llama a `GET /admin/campaigns/prueba/roster` con solo `X-Admin-Key`
- **THEN** la solicitud es rechazada con 401 por falta de token
