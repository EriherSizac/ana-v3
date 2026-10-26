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
