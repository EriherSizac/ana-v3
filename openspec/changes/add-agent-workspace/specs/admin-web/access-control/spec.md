# Spec Delta

## MODIFIED Requirements

### Requirement: Permisos de entrada a la consola
La app SHALL admitir solo usuarios con `isAdmin`, `isDeveloper` o alguno de los permisos `ana:admin:agents:manage`, `ana:contacts:list:upload` y `ana:campaign:message:send`. Cualquier otro usuario autenticado MUST ver la página "Sin acceso" y todas sus llamadas a rutas de negocio del BFF MUST responder 403.

#### Scenario: Agente sin permisos de administración
- **WHEN** un usuario con solo `ana:chats:conversation:view` y `ana:chats:message:reply` inicia sesión
- **THEN** la app muestra "Sin acceso" con su username y la opción de cerrar sesión

#### Scenario: Líder de campaña
- **WHEN** un usuario con rol de líder (que en v4 recibe `ana:contacts:list:upload`) inicia sesión
- **THEN** la app muestra el shell con las secciones que sus permisos habilitan

#### Scenario: Agente con permiso de envío
- **WHEN** un usuario con rol "Agente Prueba" (que en v4 recibe `ana:campaign:message:send`) inicia sesión
- **THEN** la app muestra el shell solo con "Mi asignación" y las rutas BFF de otras secciones le responden 403
