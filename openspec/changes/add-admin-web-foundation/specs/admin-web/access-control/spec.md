# Spec Delta

## Purpose

Decidir en el servidor qué puede ver y hacer cada usuario de ANA Admin a partir de su acceso efectivo ANA (permisos `ana:*`, campañas, admin, líder y roles), y proteger los secretos y las llamadas del BFF hacia los backends v3 y v4.

## ADDED Requirements

### Requirement: Acceso efectivo desde v4 GET /me
El BFF SHALL obtener el acceso efectivo del usuario llamando a `GET /me` del backend v4 con el id token del propio usuario y usar de su respuesta `username`, `permissions`, `campaigns`, `roleNames`, `isAdmin` e `isLeader`. Puede cachearlo por usuario hasta 60 segundos; un fallo o timeout (5 s) MUST responder 503 y no se cachea.

#### Scenario: Acceso resuelto
- **WHEN** un usuario autenticado llama a `GET /api/me`
- **THEN** el BFF responde 200 con `{"username","permissions","campaigns","roleNames","isAdmin","isLeader","isDeveloper"}` tomados de v4 `GET /me`

#### Scenario: v4 no disponible
- **WHEN** v4 `GET /me` responde 5xx o no responde en 5 segundos
- **THEN** el BFF responde 503 con `{"error":{"code":"access_unavailable","message":"No se pudo verificar tu acceso. Intenta de nuevo."}}` y no concede ningún permiso

### Requirement: Rol Developer
El BFF SHALL considerar a un usuario Developer cuando alguno de sus `roleNames` contenga `developer` sin distinguir mayúsculas ni acentos, y exponerlo como `isDeveloper`. Este rol no MUST conceder por sí mismo ningún permiso `ana:*`.

#### Scenario: Rol con mayúsculas
- **WHEN** `roleNames` incluye `"Developer"`
- **THEN** `isDeveloper` es `true`

#### Scenario: Sin rol Developer
- **WHEN** ningún rol contiene `developer`
- **THEN** `isDeveloper` es `false`

### Requirement: Permisos de entrada a la consola
La app SHALL admitir solo usuarios con `isAdmin`, `isDeveloper` o alguno de los permisos `ana:admin:agents:manage` y `ana:contacts:list:upload`. Cualquier otro usuario autenticado MUST ver la página "Sin acceso" y todas sus llamadas a rutas de negocio del BFF MUST responder 403.

#### Scenario: Agente sin permisos de administración
- **WHEN** un agente con solo `ana:chats:conversation:view` y `ana:chats:message:reply` inicia sesión
- **THEN** la app muestra "Sin acceso" con su username y la opción de cerrar sesión

#### Scenario: Líder de campaña
- **WHEN** un usuario con rol de líder (que en v4 recibe `ana:contacts:list:upload`) inicia sesión
- **THEN** la app muestra el shell con las secciones que sus permisos habilitan

### Requirement: Alcance por campaña
Para usuarios que no son admin ni tienen `*` en `campaigns`, el BFF SHALL rechazar con 403 cualquier operación sobre una campaña fuera de `campaigns`. La lista de campañas seleccionables MUST provenir de v4 `GET /agents/campaigns` (catálogo ∩ campañas del usuario) expuesta como `GET /api/campaigns`.

#### Scenario: Campaña ajena
- **WHEN** un líder de `didi_vip` llama a una ruta del BFF con `campaign=zendere`
- **THEN** el BFF responde 403 con `{"error":{"code":"forbidden","message":"Campaña no permitida"}}` sin llamar a los backends

#### Scenario: Lista de campañas
- **WHEN** el usuario llama a `GET /api/campaigns`
- **THEN** el BFF responde con las campañas que devuelve v4 `GET /agents/campaigns` para ese usuario

### Requirement: Navegación filtrada por permisos
El shell SHALL mostrar cada sección solo si el usuario tiene el permiso que la sección exige (declarado por cada change que la agrega) y cualquier acceso directo por URL a una sección no permitida MUST mostrar "Sin acceso" en lugar del contenido.

#### Scenario: URL directa sin permiso
- **WHEN** un usuario sin el permiso de una sección abre su URL
- **THEN** la app muestra "Sin acceso" y el BFF responde 403 a las llamadas de esa sección

### Requirement: Propagación de identidad a los backends
Las acciones sobre datos de ANA (rosters, contactos, configuración) SHALL llegar a v3 y v4 con el id token del usuario en `Authorization: Bearer`, sin llaves compartidas ni credenciales de servicio. Solo las lecturas de directorio (Cognito `ListUsers`, API de Roles) MAY usar credenciales de servidor, y siempre después de autorizar al usuario.

#### Scenario: Llamada a v3
- **WHEN** el BFF ejecuta una acción del usuario contra una ruta `/admin/...` de v3
- **THEN** la solicitud lleva el id token del usuario y no lleva `X-Admin-Key`

### Requirement: Secretos solo en servidor
La llave de la API de Roles, las credenciales AWS y cualquier otra llave MUST existir solo en variables de entorno del servidor (nunca `NEXT_PUBLIC_*`) y no aparecer en el bundle del navegador, en respuestas del BFF ni en logs.

#### Scenario: Bundle del navegador
- **WHEN** se inspecciona el build de producción del cliente
- **THEN** no contiene la llave de la API de Roles ni credenciales AWS

### Requirement: Errores uniformes del BFF
El BFF SHALL responder errores como `{"error":{"code","message"}}` con mensaje en español apto para el usuario y códigos `unauthenticated` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `invalid_request` (400), `access_unavailable` o `upstream_unavailable` (503) e `internal` (500), sin trazas ni detalles internos de backends.

#### Scenario: Error interno de un backend
- **WHEN** un backend responde 500 con detalle técnico
- **THEN** el BFF responde 503 `upstream_unavailable` con un mensaje genérico y registra el detalle solo en el log del servidor
