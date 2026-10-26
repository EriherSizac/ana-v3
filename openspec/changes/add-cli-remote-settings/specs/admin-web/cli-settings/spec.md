# Spec Delta

## Purpose

Dar a los usuarios con rol Developer una página de ANA Admin para ver y cambiar la configuración remota del CLI v3, con confirmación y auditoría visible, sin exponerla al resto de usuarios.

## ADDED Requirements

### Requirement: Página Configuración solo para Developer
ANA Admin SHALL mostrar la sección "Configuración" (`/configuracion`) en la navegación solo a usuarios con `isDeveloper`; para cualquier otro usuario la sección MUST estar oculta, su URL MUST mostrar "Sin acceso" y las rutas `/api/cli-settings` del BFF MUST responder 403.

#### Scenario: Líder sin rol Developer
- **WHEN** un líder abre `/configuracion`
- **THEN** la app muestra "Sin acceso" y la navegación no incluye "Configuración"

#### Scenario: Developer
- **WHEN** un usuario con rol `Developer` inicia sesión
- **THEN** la navegación incluye "Configuración"

### Requirement: Vista de la configuración del CLI
La página SHALL listar cada configuración del catálogo que devuelve v3 `GET /admin/cli-settings` con su nombre legible, descripción, valor efectivo y valor por defecto, y mostrar quién y cuándo la cambió por última vez (o "Sin cambios" si nunca se guardó), con Skeleton mientras carga.

#### Scenario: Flag de consulta sin WhatsApp
- **WHEN** el Developer abre la página por primera vez
- **THEN** ve "Registrar consulta de números sin WhatsApp" desactivado, por defecto "Desactivado" y "Sin cambios"

### Requirement: Cambio de una configuración
Al cambiar un toggle, la página SHALL pedir confirmación con `ConfirmDialog` indicando que el cambio aplica a todos los CLIs v3 en hasta 5 minutos, y al confirmar enviar solo esa llave a v3 `POST /admin/cli-settings` con el token del usuario; la página MUST mostrar el valor y la auditoría que devuelve el backend, o el error inline sin cambiar el toggle.

#### Scenario: Activar el registro
- **WHEN** el Developer activa el toggle y confirma
- **THEN** el valor queda activado y la página muestra su username y la fecha del cambio

#### Scenario: Conflicto
- **WHEN** v3 responde 409 porque otra persona guardó al mismo tiempo
- **THEN** la página muestra "La configuración cambió; recarga para ver el valor actual" y conserva el valor anterior
