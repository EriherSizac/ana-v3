# Spec Delta

## MODIFIED Requirements

### Requirement: Flag de enforcement
Los chequeos de permisos normales (distintos de consola admin y de los chequeos explícitos de cada ruta) SHALL depender de `PERMISSIONS_ENFORCED`: con `"true"` MUST permitir la operación solo si el usuario es admin o tiene el permiso; con `"report"` SHALL permitirla y registrar `evt:"perm_would_deny"` con ruta, usuario y permiso cuando la negaría; con cualquier otro valor SHALL permitirla sin registro.

#### Scenario: Enforcement activo
- **WHEN** `PERMISSIONS_ENFORCED = "true"` y un usuario sin `ana:chats:conversation:view` llama `GET /conversations`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

#### Scenario: Modo reporte
- **WHEN** `PERMISSIONS_ENFORCED = "report"` y un usuario sin `ana:campaign:message:send` llama `GET /jobs/poll`
- **THEN** recibe sus jobs y CloudWatch registra `perm_would_deny` con la ruta, su username y el permiso

### Requirement: Rol de líder por nombre
El sistema SHALL marcar `isLeader = true` cuando algún `role_name` contiene "lider" tras normalizar a minúsculas y quitar diacríticos (p. ej. "Líder Zendere"). Un líder MUST recibir siempre upload, distribute, chats view, chats team view, team jobs view, team jobs manage y envío de campaña, aun si un rol los niega.

#### Scenario: Rol con acento
- **WHEN** el usuario tiene el rol "Líder DIDI VIP"
- **THEN** `isLeader` es `true` y sus permisos incluyen `ana:contacts:list:distribute` y `ana:team:jobs:manage`

#### Scenario: Líder envía su propio CSV
- **WHEN** un líder consulta `GET /me`
- **THEN** sus permisos incluyen `ana:campaign:message:send`

## ADDED Requirements

### Requirement: Superadmin por rol
Además del superadmin fijo, el sistema SHALL tratar como superadmin a un usuario si algún `role_name` contiene "superadmin" tras pasar a minúsculas y quitar diacríticos, espacios, guiones y guiones bajos (p. ej. "Superadmin", "Súper Admin", "super-admin"). Su acceso MUST ser el del superadmin fijo (`campaigns: ["*"]`, todos los permisos, `isAdmin` e `isLeader` en `true`) conservando sus `roleIds` y `roleNames` reales, y SHALL cachearse e invalidarse como cualquier acceso.

#### Scenario: Rol Superadmin
- **WHEN** un usuario distinto de `erick.silva` tiene el rol "Súper Admin"
- **THEN** `GET /me` devuelve `campaigns: ["*"]`, todos los permisos e `isAdmin: true`, y pasa los chequeos explícitos de cualquier ruta

#### Scenario: Pierde el rol
- **WHEN** se le quita el rol "Superadmin" en la API de Roles
- **THEN** a más tardar al vencer la caché de acceso deja de tener acceso total

#### Scenario: API de roles caída
- **WHEN** la API de Roles no responde y el usuario no tiene acceso en caché
- **THEN** no obtiene acceso de superadmin (solo el superadmin fijo conserva acceso total sin la API)

#### Scenario: Nombre parecido
- **WHEN** el usuario solo tiene el rol "Administrador Zendere"
- **THEN** no se le trata como superadmin
