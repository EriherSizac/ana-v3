# agent-presence Specification

## Purpose
Registrar la presencia de los agentes del desktop v4 por campaña mediante heartbeat, exponer a líderes y administradores el roster con indicador de actividad y ofrecer la lista de campañas elegibles del usuario cruzando el catálogo de campañas de PostgreSQL con las campañas de sus roles.

> Nota: el roster de heartbeat (`ana-backend-agents-<stage>`) ya no se usa para repartir contactos; el reparto consulta la API del Dashboard (ver `v4/csv-ingestion`).

## Requirements

### Requirement: Heartbeat de agente
`POST /agents/heartbeat` con `{campaign}` SHALL requerir `campaign` (400 `{"error":"falta campaign"}`) y que el usuario sea admin, tenga `*` o tenga esa campaña en sus roles (403 `{"error":"campaña no permitida"}`). MUST guardar `{campaign, operatorId, lastSeen: epochMs}` en `ana-backend-agents-<stage>` (clave `campaign` + `operatorId`) y responder 200 `{"ok":true}`.

#### Scenario: Agente conecta WhatsApp
- **WHEN** un agente de `didi_vip` envía `{"campaign":"didi_vip"}`
- **THEN** su registro queda con `lastSeen` = ahora

#### Scenario: API de roles caída
- **WHEN** la API externa no responde y el usuario queda sin campañas
- **THEN** el heartbeat responde 403 `{"error":"campaña no permitida"}`

### Requirement: Roster persistente con actividad
El roster MUST ser persistente (sin TTL). Al listarlo, cada entrada SHALL devolverse como `{campaign, operatorId, lastSeen, active}`, con `active = true` si `lastSeen` es de los últimos 10 minutos.

#### Scenario: Agente desconectado
- **WHEN** el último heartbeat de un agente fue hace 30 minutos
- **THEN** aparece en el roster con `active: false`

### Requirement: Consulta del roster
`GET /agents?campaign=` SHALL, para admin o usuario con `*`, requerir `campaign` (400 `{"error":"falta campaign"}`) y devolver ese roster; para cualquier otro usuario, devolver el roster de la campaña pedida si es suya o de todas sus campañas si se omite, y MUST responder 403 `{"error":"campaña no permitida"}` si no queda ninguna. Responde 200 `{"agents":[...]}`.

#### Scenario: Líder sin parámetro
- **WHEN** un líder de `didi_vip` y `bancoppel` llama `GET /agents`
- **THEN** recibe los agentes de ambas campañas

> Nota: la ruta no exige rol de líder ni permiso alguno: cualquier agente puede ver el roster de sus propias campañas.

### Requirement: Campañas elegibles del usuario
`GET /agents/campaigns` SHALL responder 200 `{"campaigns":[...]}` con los nombres de `SELECT name FROM campaigns` (sin duplicados, ordenados) si el usuario es admin o tiene `*`, o con la intersección entre ese catálogo y las campañas de sus roles en caso contrario.

#### Scenario: Líder con campaña fuera de catálogo
- **WHEN** un líder tiene roles de `didi_vip` y `vieja`, y el catálogo solo contiene `didi_vip`
- **THEN** la respuesta es `{"campaigns":["didi_vip"]}`

### Requirement: Caché del catálogo de campañas
El catálogo de PostgreSQL SHALL cachearse en memoria del contenedor 10 minutos; si la consulta falla MUST servirse la última lista conocida o, si nunca se obtuvo, una lista vacía. La conexión usa `DATABASE_URL` o `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`, con TLS sin verificación de CA.

#### Scenario: Base de datos caída en frío
- **WHEN** PostgreSQL no responde en un contenedor recién iniciado
- **THEN** `GET /agents/campaigns` responde 200 con `campaigns: []`

> Nota: TLS se configura con `rejectUnauthorized: false`, sin validar el certificado del servidor.
