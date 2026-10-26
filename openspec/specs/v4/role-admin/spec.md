# role-admin Specification

## Purpose
Administrar desde el backend v4 los permisos locales de ANA por rol: listar los roles conocidos en la API externa de Roles & Permisos y leer o reemplazar la lista de permisos `ana:*` (grants y denies) que el almacén local asocia a cada rol.

## Requirements

### Requirement: Acceso exclusivo de administradores
Las rutas `GET /admin/roles`, `GET /admin/role-permissions/{roleId}` y `PUT /admin/role-permissions/{roleId}` MUST exigir `isAdmin` (permiso `ana:admin:console:manage` o superadmin), independientemente de `PERMISSIONS_ENFORCED`, y responder 403 `{"error":"sin permiso"}` en caso contrario.

#### Scenario: Líder intenta editar permisos
- **WHEN** un usuario con rol "Líder X" pero sin `ana:admin:console:manage` llama `PUT /admin/role-permissions/r1`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}` y no modifica nada

### Requirement: Listado de roles
`GET /admin/roles` SHALL responder 200 `{"roles":[{role_id,role_name,campaign_name}]}` uniendo sin duplicados (por id) los roles de `GET /roles/hierarchy` (superior y subordinado) y los roles asignados en `GET /users` de la API externa, ordenados por `role_name`. Si una fuente falla, MUST continuar con la otra.

#### Scenario: Una fuente caída
- **WHEN** `/roles/hierarchy` responde 500 y `/users` responde bien
- **THEN** el sistema responde 200 solo con los roles obtenidos de `/users`

#### Scenario: Rol sin campaña
- **WHEN** un rol de la jerarquía no trae `campaign_name`
- **THEN** aparece con `campaign_name: "*"`

> Nota: un rol sin jerarquía y sin usuarios asignados no aparece en el listado; si ambas fuentes fallan la respuesta es 200 con `roles: []`, indistinguible de "no hay roles".

### Requirement: Lectura de permisos de un rol
`GET /admin/role-permissions/{roleId}` SHALL responder 200 `{"roleId","permissions":[...]}` con la lista guardada en `ana-backend-roleperms-<stage>` bajo `PK = "ROLEPERMS"`, `SK = "ROLE#<roleId>"`, o `[]` si no existe.

#### Scenario: Rol sin configuración local
- **WHEN** se consulta un `roleId` nunca configurado
- **THEN** el sistema responde 200 con `permissions: []`

### Requirement: Reemplazo total de permisos de un rol
`PUT /admin/role-permissions/{roleId}` con body `{"permissions":[...],"roleName"?}` SHALL conservar solo los valores que, sin un `-` inicial, pertenezcan al catálogo, reemplazar por completo el registro del rol (deduplicado, con `roleId`, `roleName`, `updatedAt` ISO) e invalidar el acceso cacheado de los usuarios con ese rol. MUST responder 200 `{"roleId","permissions"}` con la lista filtrada.

#### Scenario: Grants, denies y basura
- **WHEN** se envía `{"permissions":["ana:contacts:list:upload","-ana:chats:message:reply","foo"]}`
- **THEN** se guardan `ana:contacts:list:upload` y `-ana:chats:message:reply`, se descarta `foo` sin error y la respuesta los refleja

#### Scenario: Lista vacía
- **WHEN** se envía `{"permissions":[]}` o se omite el campo
- **THEN** el rol queda sin permisos locales (vuelve a solo los permisos por defecto)

> Nota: los valores descartados no se reportan al cliente; la respuesta no está deduplicada aunque lo guardado sí; un elemento no-string en `permissions` provoca 500.
