# Spec Delta

## Purpose

Permitir a líderes y administradores de ANA ver los usuarios del pool de Cognito compartido con sus roles y campañas, y habilitarlos o deshabilitarlos como agentes ANA por campaña y por flota (v3 y v4) desde ANA Admin, sin crear ni modificar usuarios del pool.

## ADDED Requirements

### Requirement: Sección Agentes
ANA Admin SHALL ofrecer la sección "Agentes" (`/agentes`) solo a usuarios admin o con `ana:admin:agents:manage`; las rutas del BFF de esta sección MUST responder 403 a cualquier otro usuario.

#### Scenario: Usuario con solo carga de contactos
- **WHEN** un usuario con `ana:contacts:list:upload` pero sin `ana:admin:agents:manage` abre `/agentes`
- **THEN** la app muestra "Sin acceso" y la sección no aparece en la navegación

### Requirement: Listado de usuarios del pool
El BFF SHALL listar los usuarios del pool `us-east-2_UepfOyKpd` con `username`, nombre, correo y estado en Cognito (`enabled`, `status`), paginados de 50 en 50 y con búsqueda por texto sobre username, nombre y correo. La sección MUST NOT ofrecer alta, edición, borrado ni reseteo de contraseña de usuarios.

#### Scenario: Búsqueda
- **WHEN** el líder escribe `lopez` en el buscador
- **THEN** la tabla muestra solo usuarios cuyo username, nombre o correo contienen `lopez`

#### Scenario: Sin acciones de directorio
- **WHEN** el líder abre el detalle de un usuario
- **THEN** no hay controles para crear, editar, borrar ni resetear la contraseña del usuario

### Requirement: Roles y campañas de la API de Roles
Para cada usuario listado la sección SHALL mostrar sus roles (`role_name`) y campañas (`campaign_name`) de la API de Roles. Si la API de Roles falla, MUST mostrar la lista de usuarios con un aviso "Roles no disponibles" en lugar de bloquearla.

#### Scenario: API de Roles caída
- **WHEN** la API de Roles responde 5xx
- **THEN** la tabla muestra los usuarios, las columnas de roles indican "Roles no disponibles" y las acciones de habilitación siguen disponibles

### Requirement: Estado de agente por campaña y flota
Con una campaña elegida en un selector con búsqueda (campañas de `GET /api/campaigns`), la tabla SHALL mostrar por usuario su estado en v3 (habilitado / deshabilitado / sin alta en el roster) y en v4 (habilitado / deshabilitado / sin gestión, con última actividad del heartbeat), y permitir filtrar por esos estados y por "con rol en la campaña".

#### Scenario: Elegir campaña
- **WHEN** el líder elige `didi_vip`
- **THEN** la tabla muestra para cada usuario su estado en el roster v3 de `didi_vip` y en el roster v4 de `didi_vip`

#### Scenario: Una flota no disponible
- **WHEN** el backend v3 responde error al consultar el roster
- **THEN** la columna v3 muestra "No disponible" con opción de reintentar y la columna v4 se muestra normalmente

### Requirement: Habilitar o deshabilitar un agente
La sección SHALL permitir habilitar o deshabilitar a un usuario en la campaña elegida para una flota (v3 o v4), confirmando con `ConfirmDialog` (destructivo al deshabilitar) y aplicándolo con el token del usuario en el roster de esa flota; la fila MUST reflejar el estado devuelto por el backend o mostrar el error inline.

#### Scenario: Habilitar en v3
- **WHEN** el líder confirma "Habilitar en v3" para `ana.lopez` en `didi_vip`
- **THEN** el BFF actualiza el roster v3 de `didi_vip` y la fila muestra "Habilitado" con fecha y autor del cambio

#### Scenario: Deshabilitar en v4
- **WHEN** el líder confirma "Deshabilitar en v4" para `luis`
- **THEN** el roster v4 de la campaña queda con `luis` deshabilitado y la fila lo refleja

### Requirement: Acciones masivas
Con uno o más usuarios seleccionados la sección SHALL mostrar una barra de acciones masivas para habilitar o deshabilitar en v3, v4 o ambas, con un único `ConfirmDialog` que resume la cantidad y la flota; al terminar MUST informar cuántos cambios se aplicaron y cuáles fallaron por flota.

#### Scenario: Fallo parcial
- **WHEN** se habilitan 10 usuarios en ambas flotas y v4 falla
- **THEN** el resultado indica 10 aplicados en v3 y 10 fallidos en v4, y las filas muestran el estado real de cada flota

### Requirement: Usuarios deshabilitados en Cognito
Un usuario con `enabled:false` en Cognito SHALL mostrarse marcado como "Deshabilitado en Cognito" y no MUST poder habilitarse como agente en ninguna flota; el BFF MUST rechazar esa habilitación con 409. Deshabilitarlo como agente sí se permite.

#### Scenario: Habilitar usuario deshabilitado en el pool
- **WHEN** se intenta habilitar a un usuario deshabilitado en Cognito
- **THEN** el control está deshabilitado con el motivo, y una llamada directa al BFF responde 409 `conflict`

### Requirement: Aviso de usuario sin rol en la campaña
Al habilitar a un usuario que no tiene ningún rol de la API de Roles con esa campaña (o `*`), el `ConfirmDialog` SHALL advertir que el usuario no tiene rol en la campaña y que en v4 el desktop puede no ofrecerle esa campaña; la habilitación MUST seguir permitida tras confirmar.

#### Scenario: Usuario sin rol
- **WHEN** el líder habilita en `didi_vip` a un usuario cuyos roles solo son de `zendere`
- **THEN** el diálogo muestra la advertencia y, al confirmar, la habilitación se aplica

### Requirement: Usuarios inexistentes en el pool
El BFF SHALL rechazar con 400 la habilitación de un username que no exista en el pool, y la sección MUST listar aparte (como "fuera del pool") las entradas de roster cuyo username ya no existe en el pool, permitiendo solo deshabilitarlas.

#### Scenario: Entrada huérfana
- **WHEN** el roster v3 de `prueba` tiene a `viejo.agente` y ese usuario ya no existe en el pool
- **THEN** aparece en "fuera del pool" con estado y opción "Deshabilitar"
