# Spec Delta

## Purpose

Permitir que líderes y administradores habiliten o deshabiliten agentes ANA por campaña en el backend v4, sobre el roster existente de agentes (tabla `agents` con heartbeat), y que esa habilitación determine quién recibe contactos repartidos.

## ADDED Requirements

### Requirement: Permiso de gestión de agentes
El catálogo de permisos v4 SHALL incluir `ana:admin:agents:manage`, asignable a roles por el almacén local de permisos y por permisos inline de la API de Roles. `GET /me` MUST incluirlo para admins (que tienen todo el catálogo) y para usuarios con rol de líder, cuyo alcance son sus campañas.

#### Scenario: Líder
- **WHEN** un usuario con rol `Líder DIDI VIP` consulta `GET /me`
- **THEN** `access.permissions` incluye `ana:admin:agents:manage`

#### Scenario: Rol con grant explícito
- **WHEN** el administrador asigna `ana:admin:agents:manage` a un rol con `PUT /admin/role-permissions/{roleId}`
- **THEN** el permiso se acepta como válido y los usuarios de ese rol lo reciben en `GET /me`

### Requirement: Habilitación administrativa en el roster
Cada entrada `(campaign, operatorId)` de la tabla de roster SHALL admitir `enabled` (booleano), `enabledUpdatedAt` (ISO 8601) y `enabledUpdatedBy` (username); `operatorId` es el username de Cognito tal como lo emite el pool. Una entrada puede existir sin heartbeat previo (creada por la habilitación).

#### Scenario: Agente habilitado que nunca se conectó
- **WHEN** un líder habilita a `ana.lopez` en `didi_vip` y ella nunca ha enviado heartbeat
- **THEN** existe la entrada `(didi_vip, ana.lopez)` con `enabled:true` y sin `lastSeen`

### Requirement: Heartbeat preserva la habilitación
`POST /agents/heartbeat` SHALL actualizar solo `lastSeen` de la entrada (creándola si no existe) y MUST NOT borrar ni modificar `enabled`, `enabledUpdatedAt` ni `enabledUpdatedBy`.

#### Scenario: Heartbeat de un agente deshabilitado
- **WHEN** `luis` está deshabilitado en `didi_vip` y su desktop envía heartbeat
- **THEN** la entrada conserva `enabled:false` y actualiza `lastSeen`

### Requirement: Consulta administrativa del roster
El sistema SHALL exponer `GET /admin/agent-roster?campaign=<c>` (JWT) que responde 200 con `{"campaign","managed","agents":[{"operatorId","enabled","enabledUpdatedAt","enabledUpdatedBy","lastSeen","active"}]}`, donde `enabled` es `null` si nunca se gestionó y `managed` indica si la campaña tiene alguna entrada con `enabled` definido.

#### Scenario: Campaña sin gestión
- **WHEN** ninguna entrada de `zendere` tiene `enabled`
- **THEN** la respuesta tiene `"managed":false` y cada agente `"enabled":null`

#### Scenario: Falta campaign
- **WHEN** no se envía `campaign`
- **THEN** el sistema responde 400 con `{"error":"falta campaign"}`

### Requirement: Actualización administrativa del roster
El sistema SHALL exponer `POST /admin/agent-roster` (JWT) con body `{"campaign","agents":[{"operatorId","enabled"}]}` (1 a 100 entradas, `enabled` booleano) que fija `enabled`, `enabledUpdatedAt` y `enabledUpdatedBy` (usuario del token) sin tocar `lastSeen`; la campaña MUST existir en el catálogo de campañas, si no responde 400.

#### Scenario: Deshabilitar a un agente
- **WHEN** un líder de `didi_vip` envía `{"campaign":"didi_vip","agents":[{"operatorId":"luis","enabled":false}]}`
- **THEN** la entrada queda con `enabled:false` y la respuesta 200 devuelve el roster actualizado

#### Scenario: Campaña inexistente
- **WHEN** la campaña no existe en el catálogo
- **THEN** el sistema responde 400 con `{"error":"la campaña \"<c>\" no existe"}`

### Requirement: Autorización de la gestión del roster v4
Las rutas `/admin/agent-roster` SHALL permitirse a admins sobre cualquier campaña y a usuarios con `ana:admin:agents:manage` solo sobre campañas propias (o `*`), con chequeo que no depende del flag `PERMISSIONS_ENFORCED`; en otro caso MUST responder 403.

#### Scenario: Agente sin permiso
- **WHEN** un agente sin el permiso llama a `POST /admin/agent-roster`
- **THEN** el sistema responde 403 con `{"error":"sin permiso"}` aunque `PERMISSIONS_ENFORCED` sea `false`

### Requirement: Reparto restringido a agentes habilitados
En una campaña gestionada, el reparto automático (`distribute` sin `assignments`) SHALL usar solo los agentes elegibles del Dashboard que además tengan `enabled:true`, tanto en la vista previa del presign como en el procesamiento del CSV. En campañas no gestionadas MUST conservarse el comportamiento actual.

#### Scenario: Agente activo pero deshabilitado
- **WHEN** el Dashboard devuelve `ana.lopez` y `luis` como elegibles en `didi_vip` (gestionada) y solo `ana.lopez` está habilitada
- **THEN** todos los jobs del CSV se asignan a `ana.lopez`

#### Scenario: Ninguno habilitado
- **WHEN** la campaña está gestionada y ningún elegible está habilitado
- **THEN** los jobs se asignan al usuario que subió el CSV, como cuando no hay agentes elegibles

### Requirement: Reparto explícito solo a agentes habilitados
En una campaña gestionada, `POST /uploads/presign` con `assignments` SHALL rechazar con 400 `{"error":"agente no habilitado: <operatorId>"}` cualquier destinatario que no tenga `enabled:true` en esa campaña, sin generar URL.

#### Scenario: Reparto a un agente deshabilitado
- **WHEN** se pide un presign con `assignments:{"luis":1}` y `luis` está deshabilitado en la campaña gestionada
- **THEN** el sistema responde 400 y no devuelve URL
