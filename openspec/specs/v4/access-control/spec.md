# access-control Specification

## Purpose
Resolver el acceso efectivo de cada usuario del backend v4 (roles, campañas, permisos `ana:*`, banderas de administrador y líder) a partir de la API externa de Roles & Permisos de Pernexium y del almacén local rol→permisos, con caché en dos capas, y exponerlo en `GET /me`.

> Nota: con `PERMISSIONS_ENFORCED` en su valor por defecto (`false`), casi todos los chequeos de permiso normales permiten la operación; solo el permiso de consola admin y los "hard checks" explícitos (subida de CSV, vista/reasignación de jobs, "ver como") bloquean de verdad. Los permisos `ana:chats:message:reply`, `ana:campaign:message:send`, `ana:chats:team:view`, `ana:team:jobs:view` y `ana:team:jobs:manage` existen en el catálogo pero ninguna ruta los verifica.

## Requirements

### Requirement: Catálogo de permisos
El sistema SHALL reconocer exactamente estos permisos con formato `módulo:alcance:recurso:acción`: `ana:admin:console:manage`, `ana:contacts:list:upload`, `ana:contacts:list:distribute`, `ana:chats:conversation:view`, `ana:chats:team:view`, `ana:chats:message:reply`, `ana:campaign:message:send`, `ana:team:jobs:view` y `ana:team:jobs:manage`.

#### Scenario: Permiso fuera del catálogo
- **WHEN** un rol trae un permiso `ana:foo:bar:baz` que no está en el catálogo
- **THEN** el permiso puede aparecer en la lista resuelta pero ninguna ruta lo interpreta

### Requirement: Fuente de identidad externa
El sistema SHALL obtener los roles del usuario con `GET {ROLES_API_BASE}/users/{username}` y header `X-Api-Key`, leyendo de cada rol `role_id`, `role_name`, `campaign_name` y los permisos inline (`permissions[].permission_name`). Si la API responde no-2xx o falla la red, MUST tratar al usuario como sin roles.

#### Scenario: API de roles caída
- **WHEN** la API externa responde 500 para el usuario
- **THEN** el acceso resuelto tiene `roleIds: []`, `campaigns: []` y solo los permisos por defecto, y no se cachea

### Requirement: Composición de permisos efectivos
El sistema MUST calcular los permisos como: permisos por defecto (`ana:chats:conversation:view`, `ana:chats:message:reply`) ∪ grants explícitos del almacén local de cada rol ∪ permisos inline de la API externa que empiecen con `ana:` o `-ana:`. Un valor `-<permiso>` SHALL quitar ese permiso salvo que otro rol del usuario lo otorgue explícitamente.

#### Scenario: Deny de un permiso por defecto
- **WHEN** el único rol del usuario guarda `-ana:chats:message:reply`
- **THEN** el acceso resuelto no incluye `ana:chats:message:reply`

#### Scenario: Grant gana sobre deny
- **WHEN** un rol guarda `-ana:contacts:list:upload` y otro rol del mismo usuario guarda `ana:contacts:list:upload`
- **THEN** el acceso resuelto incluye `ana:contacts:list:upload`

### Requirement: Rol de líder por nombre
El sistema SHALL marcar `isLeader = true` cuando algún `role_name` contiene "lider" tras normalizar a minúsculas y quitar diacríticos (p. ej. "Líder Zendere"). Un líder MUST recibir siempre upload, distribute, chats view, chats team view, team jobs view y team jobs manage, aun si un rol los niega.

#### Scenario: Rol con acento
- **WHEN** el usuario tiene el rol "Líder DIDI VIP"
- **THEN** `isLeader` es `true` y sus permisos incluyen `ana:contacts:list:distribute` y `ana:team:jobs:manage`

### Requirement: Administrador por permiso explícito
El sistema SHALL marcar `isAdmin = true` solo si algún rol otorga explícitamente `ana:admin:console:manage` (almacén local o inline); en ese caso MUST conceder todos los permisos del catálogo. El permiso de consola admin SHALL exigirse siempre, sin importar `PERMISSIONS_ENFORCED`.

#### Scenario: Flag de enforcement apagado
- **WHEN** `PERMISSIONS_ENFORCED` es `false` y un usuario sin `ana:admin:console:manage` llama una ruta de administración
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

### Requirement: Superadmin fijo
El sistema MUST tratar al usuario `erick.silva` como superadmin sin consultar la API externa ni la caché: `roleNames: ["superadmin"]`, `campaigns: ["*"]`, todos los permisos, `isAdmin` e `isLeader` en `true`.

#### Scenario: Superadmin con API de roles caída
- **WHEN** `erick.silva` llama cualquier ruta mientras la API de roles no responde
- **THEN** obtiene acceso total

> Nota: el superadmin está codificado por nombre de usuario en el código; cualquier cuenta de Cognito con ese `cognito:username` obtiene acceso total.

### Requirement: Campañas del usuario
El sistema SHALL derivar `campaigns` como el conjunto sin duplicados de `campaign_name` de los roles del usuario. El valor `*` en `campaigns` MUST interpretarse como acceso global a campañas en las rutas que lo comprueban.

#### Scenario: Usuario con dos roles de la misma campaña
- **WHEN** el usuario tiene dos roles con `campaign_name = "didi_vip"`
- **THEN** `campaigns` es `["didi_vip"]`

### Requirement: Flag de enforcement
Los chequeos de permisos normales (distintos de consola admin) SHALL permitir la operación cuando `PERMISSIONS_ENFORCED` no es `"true"`; cuando es `"true"`, MUST permitirla solo si el usuario es admin o tiene el permiso.

#### Scenario: Enforcement activo
- **WHEN** `PERMISSIONS_ENFORCED = "true"` y un usuario sin `ana:chats:conversation:view` llama `GET /conversations`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

### Requirement: Caché de acceso en dos capas
El sistema SHALL cachear el acceso resuelto en memoria del contenedor 15 segundos (L1) y en la tabla `ana-backend-accesscache-<stage>` (PK `username`, atributos `access`, `roleIds`, `ttl`) 15 minutos (L2). MUST NOT cachear resoluciones con cero roles ni al superadmin.

#### Scenario: Acierto de caché L2
- **WHEN** un usuario resuelto hace 5 minutos llama desde otro contenedor
- **THEN** el sistema usa el acceso guardado sin llamar a la API externa

### Requirement: Invalidación por rol con tombstone
Al cambiar los permisos de un rol, el sistema SHALL recorrer paginadamente la caché L2 y escribir un tombstone (`tombstoneAt`, TTL 60 s, sin `access`) para cada usuario cuyo `roleIds` contenga el rol, y vaciar la L1 del contenedor actual. Una escritura de caché iniciada antes del tombstone MUST NOT sobrescribirlo.

#### Scenario: Resolución en vuelo durante la invalidación
- **WHEN** una resolución arranca, luego se invalida el rol y después la resolución intenta guardar
- **THEN** la escritura condicional falla en silencio y el siguiente request vuelve a resolver

> Nota: la L1 de otros contenedores calientes no se invalida, así que un cambio de permisos puede tardar hasta 15 s en verse; los usuarios cuyo acceso no está en L2 no se tocan.

### Requirement: Endpoint de acceso propio
El sistema SHALL exponer `GET /me` que responde 200 `{"access":{username,roleIds,roleNames,campaigns,permissions,isAdmin,isLeader}}` para el usuario autenticado.

#### Scenario: Consulta de acceso
- **WHEN** un agente llama `GET /me`
- **THEN** recibe su acceso resuelto con sus campañas y permisos
