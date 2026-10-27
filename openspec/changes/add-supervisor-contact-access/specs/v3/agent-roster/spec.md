# Spec Delta

## MODIFIED Requirements

### Requirement: Lista derivada de agentes por campaña
La lista derivada SHALL guardarse en `campaign-agents/{campaign}.json` del bucket `ana-backend-storage-{stage}` como `{"schemaVersion":1,"campaign","generatedAt","agents":[{"username","cognitoUsername","roleIds","kind"}]}` por cada campaña del catálogo de v4, con `agents` vacío si no tiene agentes, `username` normalizado (orden), `cognitoUsername` tal como lo emite el pool y `kind` `agent` o `supervisor` (ausente = `agent`). Solo la sincronización de `v4/agent-roster` MUST escribirla.

#### Scenario: Campaña sin agentes
- **WHEN** ningún usuario cumple la definición para `ventas`, que existe en el catálogo
- **THEN** `campaign-agents/ventas.json` existe con `agents` vacío

#### Scenario: Supervisor en la lista
- **WHEN** `sara` tiene "Supervisor Prueba" y está elegible en el pool
- **THEN** `campaign-agents/prueba.json` la incluye con `kind:"supervisor"`

### Requirement: Consulta del roster
El sistema SHALL exponer `GET /admin/campaigns/{campaign}/roster` que responde 200 con `{"success":true,"data":{"campaign","generatedAt","agents":[{"username","enabled","override","kind"}],"inactiveOverrides":[...]}}`: `agents` = lista derivada ordenada con su estado efectivo, excepción (o `null`) y tipo; `inactiveOverrides` = excepciones de usuarios que ya no están en la lista.

#### Scenario: Campaña con una excepción
- **WHEN** la lista derivada de `prueba` tiene `ana.lopez` y `luis` y el roster deshabilita a `luis`
- **THEN** la respuesta muestra `ana.lopez` habilitada con `override:null` y `luis` deshabilitado con autor y fecha

#### Scenario: Lista ilegible
- **WHEN** la lista derivada o el roster son ilegibles o están vencidos
- **THEN** el sistema responde 500 con `{"success":false,"message":"Roster ilegible"}` sin modificarlos

#### Scenario: Supervisor en el roster
- **WHEN** la lista derivada de `prueba` incluye a `sara` con `kind:"supervisor"`
- **THEN** la respuesta la muestra con `kind:"supervisor"` y su estado efectivo

### Requirement: Autorización de la administración del roster
`POST /admin/campaigns/{campaign}/roster/agents` SHALL exigir admin o `ana:admin:agents:manage`; `GET /admin/campaigns/{campaign}/roster` SHALL exigir admin, `ana:admin:agents:manage`, o `ana:contacts:list:upload` y `ana:contacts:list:distribute`. En ambos la campaña normalizada (o `*`) debe estar entre las del usuario, según `/admin/*` de `v3/backend-api-security`; si no, MUST responder 403 sin acceder a S3.

#### Scenario: Líder de otra campaña
- **WHEN** un líder de `didi_vip` intenta actualizar el roster de `zendere`
- **THEN** el sistema responde 403 con `{"success":false,"message":"Sin permiso para esta campaña"}`

#### Scenario: Supervisor lee el roster
- **WHEN** un supervisor de `prueba` (carga y reparto, sin `ana:admin:agents:manage`) consulta el roster de `prueba`
- **THEN** el sistema responde 200 con el roster

#### Scenario: Supervisor intenta escribir
- **WHEN** el mismo supervisor envía `POST /admin/campaigns/prueba/roster/agents`
- **THEN** el sistema responde 403 con `{"success":false,"message":"Sin permiso"}`

## ADDED Requirements

### Requirement: Supervisores habilitados
Un integrante con `kind:"supervisor"` SHALL seguir la misma regla de habilitación efectiva y las mismas excepciones que un agente, de modo que la autenticación de agente del CLI, `GET /agent/campaigns`, la carga de administración y las rutas de "Mi asignación" lo acepten mientras esté habilitado.

#### Scenario: Supervisor usa el CLI
- **WHEN** `sara` es supervisora derivada de `prueba` sin excepción y llama a `GET /get/chats/sara/prueba` con su token
- **THEN** la autenticación de agente la acepta

#### Scenario: Supervisor deshabilitado
- **WHEN** el roster de `prueba` tiene `sara` con `enabled:false`
- **THEN** no está habilitada y la autenticación de agente la rechaza en modo estricto
