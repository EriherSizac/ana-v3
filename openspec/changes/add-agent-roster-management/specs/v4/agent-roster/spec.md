# Spec Delta

## Purpose

Calcular en v4 la lista de agentes de cada campaña a partir de los roles del pool (la misma que consume v3), permitir que líderes y administradores deshabiliten agentes por campaña en v4 sobre el roster existente (tabla `agents` con heartbeat), y que esa habilitación determine quién recibe contactos repartidos.

## ADDED Requirements

### Requirement: Permiso de gestión de agentes
El catálogo de permisos v4 SHALL incluir `ana:admin:agents:manage`, asignable a roles por el almacén local de permisos y por permisos inline de la API de Roles. `GET /me` MUST incluirlo para admins (que tienen todo el catálogo) y para usuarios con rol de líder, cuyo alcance son sus campañas.

#### Scenario: Líder
- **WHEN** un usuario con rol `Líder DIDI VIP` consulta `GET /me`
- **THEN** `access.permissions` incluye `ana:admin:agents:manage`

#### Scenario: Rol con grant explícito
- **WHEN** el administrador asigna `ana:admin:agents:manage` a un rol con `PUT /admin/role-permissions/{roleId}`
- **THEN** el permiso se acepta como válido y los usuarios de ese rol lo reciben en `GET /me`

### Requirement: Sincronización de agentes derivados
Cada 5 minutos v4 SHALL calcular, con la definición y la lectura de roles de `v3/agent-roster` (pool con `ListUsers`, API de Roles con `X-Api-Key`, almacén local rol→permisos), la lista de agentes de cada campaña del catálogo y escribir `campaign-agents/{campaign}.json` en el bucket de v3. Roles de campañas fuera del catálogo se ignoran y se cuentan en el log `evt:"agent_sync"`.

#### Scenario: Usuario gana el rol
- **WHEN** a `ana.lopez` se le asigna un rol de `didi_vip` que otorga `ana:campaign:message:send`
- **THEN** a más tardar en la siguiente corrida (≤ 5 min) figura en `campaign-agents/didi_vip.json`

#### Scenario: Usuario pierde el rol
- **WHEN** se le quita a `luis` su único rol con envío en `didi_vip`
- **THEN** la siguiente corrida lo excluye de `campaign-agents/didi_vip.json` aunque tenga una excepción en algún roster

### Requirement: Fallo de la sincronización
Si falla `ListUsers`, `GET /users`, algún `GET /users/{username}`, el catálogo de campañas o el almacén de permisos, la corrida SHALL terminar sin escribir ninguna lista (se conservan las anteriores) y registrar `evt:"agent_sync","status":"failed"`; tres corridas fallidas seguidas MUST disparar una alarma. Nadie se agrega hasta una corrida exitosa.

#### Scenario: API de Roles caída
- **WHEN** `GET /users` responde 5xx
- **THEN** ninguna `campaign-agents/*.json` cambia y los agentes ya listados siguen habilitados mientras la lista tenga 24 h o menos

#### Scenario: Caída prolongada
- **WHEN** la API de Roles falla durante más de 24 h
- **THEN** los lectores tratan las listas como vencidas (error de roster) y se mantiene la alarma activa

### Requirement: Alcance de escritura de la sincronización
La función de sincronización SHALL tener permiso de escritura solo sobre `campaign-agents/*` del bucket de v3 y MUST NOT escribir `rosters/`, `agents/` ni otro prefijo; ninguna otra función de v4 MUST escribir `campaign-agents/`.

#### Scenario: Política IAM
- **WHEN** se revisa la política de la función de sincronización
- **THEN** solo permite `s3:PutObject` sobre `arn:aws:s3:::ana-backend-storage-{stage}/campaign-agents/*`

### Requirement: Excepciones administrativas en el roster v4
Cada entrada `(campaign, operatorId)` de la tabla de roster SHALL admitir `enabled` (booleano), `enabledUpdatedAt` (ISO 8601) y `enabledUpdatedBy` (username) como excepción; `operatorId` es el username de Cognito tal como lo emite el pool. Una entrada puede existir sin heartbeat previo.

#### Scenario: Deshabilitar a quien nunca se conectó
- **WHEN** un líder deshabilita a `ana.lopez` en `didi_vip` y ella nunca ha enviado heartbeat
- **THEN** existe la entrada `(didi_vip, ana.lopez)` con `enabled:false` y sin `lastSeen`

### Requirement: Regla de habilitación v4
Un agente SHALL estar habilitado en v4 para la campaña X solo si su username normalizado figura en `campaign-agents/{X}.json` vigente (regla de lectura de `v3/agent-roster`) y su entrada v4 no tiene `enabled:false`. Lista inexistente = sin agentes; lista ilegible o vencida MUST tratarse como error.

#### Scenario: Agente derivado sin excepción en v4
- **WHEN** `Ana.Lopez` (username del pool) figura como `ana.lopez` en la lista de `didi_vip` y no tiene entrada `enabled`
- **THEN** está habilitada en v4 con `operatorId` `Ana.Lopez`

### Requirement: Heartbeat preserva la habilitación
`POST /agents/heartbeat` SHALL actualizar solo `lastSeen` de la entrada (creándola si no existe) y MUST NOT borrar ni modificar `enabled`, `enabledUpdatedAt` ni `enabledUpdatedBy`.

#### Scenario: Heartbeat de un agente deshabilitado
- **WHEN** `luis` está deshabilitado en `didi_vip` y su desktop envía heartbeat
- **THEN** la entrada conserva `enabled:false` y actualiza `lastSeen`

### Requirement: Consulta administrativa del roster
El sistema SHALL exponer `GET /admin/agent-roster?campaign=<c>` (JWT) que responde 200 con `{"campaign","generatedAt","agents":[{"operatorId","enabled","override","lastSeen","active"}],"inactiveOverrides":[...]}`: `agents` = lista derivada con estado efectivo y excepción (o `null`); `inactiveOverrides` = excepciones de usuarios fuera de la lista.

#### Scenario: Campaña sin excepciones
- **WHEN** la lista de `zendere` tiene dos agentes y ninguna entrada tiene `enabled`
- **THEN** ambos aparecen con `enabled:true` y `override:null`

#### Scenario: Falta campaign
- **WHEN** no se envía `campaign`
- **THEN** el sistema responde 400 con `{"error":"falta campaign"}`

### Requirement: Actualización administrativa del roster
El sistema SHALL exponer `POST /admin/agent-roster` (JWT) con `{"campaign","agents":[{"operatorId","enabled"}]}` (1 a 100, `enabled` booleano) que fija la excepción y su autor sin tocar `lastSeen`. La campaña MUST existir en el catálogo (si no, 400) y `enabled:true` para alguien fuera de la lista derivada MUST responder 409 sin escribir.

#### Scenario: Deshabilitar a un agente
- **WHEN** un líder de `didi_vip` envía `{"campaign":"didi_vip","agents":[{"operatorId":"luis","enabled":false}]}`
- **THEN** la entrada queda con `enabled:false` y la respuesta 200 devuelve el roster actualizado

#### Scenario: Habilitar a quien no es agente
- **WHEN** se envía `enabled:true` para un usuario sin rol de envío en la campaña
- **THEN** el sistema responde 409 con `{"error":"no es agente de la campaña: <operatorId>"}`

#### Scenario: Campaña inexistente
- **WHEN** la campaña no existe en el catálogo
- **THEN** el sistema responde 400 con `{"error":"la campaña \"<c>\" no existe"}`

### Requirement: Autorización de la gestión del roster v4
Las rutas `/admin/agent-roster` SHALL permitirse a admins sobre cualquier campaña y a usuarios con `ana:admin:agents:manage` solo sobre campañas propias (o `*`), con chequeo que no depende del flag `PERMISSIONS_ENFORCED`; en otro caso MUST responder 403.

#### Scenario: Agente sin permiso
- **WHEN** un agente sin el permiso llama a `POST /admin/agent-roster`
- **THEN** el sistema responde 403 con `{"error":"sin permiso"}` aunque `PERMISSIONS_ENFORCED` sea `false`

### Requirement: Reparto restringido a agentes habilitados
Con `AGENT_ROSTER_FILTER` en `true`, el reparto automático (`distribute` sin `assignments`) SHALL usar solo los elegibles del Dashboard que además estén habilitados según la regla v4, en el presign y en el trigger. Sin habilitados o con la lista en error, los jobs van al usuario que subió el CSV. Con el flag apagado MUST conservarse el comportamiento actual.

#### Scenario: Activo en el Dashboard pero deshabilitado
- **WHEN** el Dashboard devuelve `ana.lopez` y `luis` en `didi_vip` y `luis` tiene `enabled:false`
- **THEN** todos los jobs del CSV se asignan a `ana.lopez`

#### Scenario: Activo sin rol de envío
- **WHEN** el Dashboard devuelve `pedro`, que no figura en la lista derivada de `didi_vip`
- **THEN** `pedro` no recibe jobs

#### Scenario: Flag apagado
- **WHEN** `AGENT_ROSTER_FILTER` no es `true`
- **THEN** el reparto usa los elegibles del Dashboard como antes del cambio

### Requirement: Reparto explícito solo a agentes habilitados
Con `AGENT_ROSTER_FILTER` en `true`, `POST /uploads/presign` con `assignments` SHALL rechazar con 400 `{"error":"agente no habilitado: <operatorId>"}` cualquier destinatario no habilitado según la regla v4, sin generar URL; si la lista está en error MUST responder 503 `{"error":"roster no disponible"}`.

#### Scenario: Reparto a un agente deshabilitado
- **WHEN** se pide un presign con `assignments:{"luis":1}` y `luis` está deshabilitado en la campaña
- **THEN** el sistema responde 400 y no devuelve URL
