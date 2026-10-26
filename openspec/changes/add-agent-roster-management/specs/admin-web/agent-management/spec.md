# Spec Delta

## Purpose

Permitir a líderes y administradores de ANA ver los usuarios del pool de Cognito compartido con sus roles y campañas, ver qué usuarios son agentes de cada campaña (derivado de sus roles con permiso de envío) y deshabilitarlos o rehabilitarlos por campaña y por flota (v3 y v4) desde ANA Admin, sin crear ni modificar usuarios del pool ni sus roles.

## ADDED Requirements

### Requirement: Sección Agentes
ANA Admin SHALL ofrecer la sección "Agentes" (`/agentes`) solo a usuarios admin o con `ana:admin:agents:manage`; las rutas del BFF de esta sección MUST responder 403 a cualquier otro usuario.

#### Scenario: Usuario con solo carga de contactos
- **WHEN** un usuario con `ana:contacts:list:upload` pero sin `ana:admin:agents:manage` abre `/agentes`
- **THEN** la app muestra "Sin acceso" y la sección no aparece en la navegación

### Requirement: Listado de usuarios del pool
El BFF SHALL listar los usuarios del pool `us-east-2_UepfOyKpd` con `username`, nombre, correo y estado en Cognito (`enabled`, `status`), paginados de 50 en 50 y con búsqueda por texto sobre username, nombre y correo. La sección MUST NOT ofrecer alta, edición, borrado ni reseteo de contraseña de usuarios, ni cambios de roles.

#### Scenario: Búsqueda
- **WHEN** el líder escribe `lopez` en el buscador
- **THEN** la tabla muestra solo usuarios cuyo username, nombre o correo contienen `lopez`

#### Scenario: Sin acciones de directorio
- **WHEN** el líder abre el detalle de un usuario
- **THEN** no hay controles para crear, editar, borrar, resetear la contraseña ni cambiar roles del usuario

### Requirement: Roles y campañas de la API de Roles
Para cada usuario listado la sección SHALL mostrar sus roles (`role_name`) y campañas (`campaign_name`) de la API de Roles (`GET /users/{username}` con permisos inline, sin `/roles/{id}/permissions`). Si la API de Roles falla, MUST mostrar la lista de usuarios con el aviso "Roles no disponibles" en lugar de bloquearla.

#### Scenario: API de Roles caída
- **WHEN** la API de Roles responde 5xx
- **THEN** la tabla muestra los usuarios y las columnas de roles indican "Roles no disponibles"

### Requirement: Estado de agente por campaña y flota
Con una campaña elegida (selector con búsqueda sobre `GET /api/campaigns`), la tabla SHALL mostrar por usuario en v3 y en v4: "Agente" (habilitado), "Deshabilitado" (con autor y fecha) o "No es agente" (sin rol de la campaña con `ana:campaign:message:send`, o deshabilitado en Cognito), más la fecha de la última sincronización y, en v4, la última actividad.

#### Scenario: Elegir campaña
- **WHEN** el líder elige `didi_vip`
- **THEN** cada usuario muestra su estado en v3 y v4 según la lista derivada y las excepciones de `didi_vip`

#### Scenario: Una flota no disponible
- **WHEN** el backend v3 responde error al consultar el roster
- **THEN** la columna v3 muestra "No disponible" con opción de reintentar y la columna v4 se muestra normalmente

#### Scenario: Sincronización atrasada
- **WHEN** la última sincronización tiene más de 30 minutos
- **THEN** la página muestra "Lista de agentes desactualizada desde <fecha>"

### Requirement: Deshabilitar o rehabilitar un agente
La sección SHALL permitir deshabilitar a un agente en la campaña para una flota (`ConfirmDialog` destructivo) y rehabilitar a uno deshabilitado, aplicándolo con el token del usuario en el roster de esa flota; la fila MUST reflejar el estado devuelto o el error inline. Para "No es agente" MUST NOT ofrecer habilitar y debe indicar el motivo.

#### Scenario: Deshabilitar en v3
- **WHEN** el líder confirma "Deshabilitar en v3" para `ana.lopez` en `didi_vip`
- **THEN** la fila muestra "Deshabilitado" con fecha y autor del cambio

#### Scenario: Usuario sin rol de envío
- **WHEN** el líder abre un usuario con estado "No es agente" en `didi_vip`
- **THEN** no hay control de habilitar y se muestra "Sin rol con permiso de envío en la campaña"

### Requirement: Acciones masivas
Con uno o más agentes seleccionados la sección SHALL mostrar una barra para deshabilitar o rehabilitar en v3, v4 o ambas, con un único `ConfirmDialog` que resume cantidad y flota; al terminar MUST informar cuántos cambios se aplicaron y cuáles fallaron por flota.

#### Scenario: Fallo parcial
- **WHEN** se deshabilitan 10 agentes en ambas flotas y v4 falla
- **THEN** el resultado indica 10 aplicados en v3 y 10 fallidos en v4, y las filas muestran el estado real de cada flota

### Requirement: Excepciones sin efecto
La sección SHALL listar aparte, como "Excepciones sin efecto", las excepciones del roster de usuarios que ya no son agentes de la campaña (perdieron el rol o están deshabilitados en Cognito), con autor y fecha, indicando que no dan acceso.

#### Scenario: Usuario que perdió el rol
- **WHEN** el roster v3 de `prueba` tiene una excepción de `viejo.agente` y ya no tiene rol de envío en `prueba`
- **THEN** aparece en "Excepciones sin efecto" y no en la tabla como agente
