## ADDED Requirements

### Requirement: Identidad CRM del agente en GET /agent/campaigns
El backend v3 SHALL agregar a la respuesta de `GET /agent/campaigns` los campos `crmUserId` y `displayName` del agente autenticado, obtenidos de `GET {ROLES_API_BASE}/users/{username}` con la cabecera `X-Api-Key` = `ROLES_API_KEY`. `ROLES_API_BASE` MUST tener como default `https://8emg4wx2t8.execute-api.us-east-2.amazonaws.com` y la key MUST NOT registrarse ni commitearse.

#### Scenario: Agente registrado en Roles
- **WHEN** un agente autenticado llama `GET /agent/campaigns` y Roles devuelve `{user_id, name}`
- **THEN** la respuesta incluye `crmUserId` = `user_id` y `displayName` = `name`

### Requirement: Caché y fallos de la API de Roles
El resultado exitoso de Roles SHALL cachearse por username durante 10 minutos. Ante falta de key, error HTTP, error de red o `user_id` ausente o no UUID, `crmUserId` y `displayName` MUST ser `null`, el fallo MUST NOT cachearse y la respuesta MUST seguir siendo 200 con las campañas.

#### Scenario: Roles no disponible
- **WHEN** Roles responde con error o no responde
- **THEN** la respuesta es 200 con `crmUserId: null` y `displayName: null`

#### Scenario: Llamadas repetidas
- **WHEN** el mismo agente llama dos veces dentro de 10 minutos
- **THEN** Roles se consulta una sola vez
