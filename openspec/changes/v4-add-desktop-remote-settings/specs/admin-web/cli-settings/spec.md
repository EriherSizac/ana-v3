# Spec Delta

## ADDED Requirements

### Requirement: Configuración del desktop v4
La página "Configuración" SHALL mostrar, separada de la del CLI v3, la sección "Desktop v4" con cada llave de v4 `GET /admin/desktop-settings`: nombre, descripción, control (interruptor o número con sus límites), valor por defecto y último cambio ("Sin cambios" si nunca cambió), con Skeleton mientras carga. Las rutas del BFF de esta sección MUST responder 403 a usuarios sin `isDeveloper`.

#### Scenario: Developer abre la página
- **WHEN** un Developer abre `/configuracion`
- **THEN** ve la sección "Desktop v4" con "Separación mínima entre mensajes (segundos)" en 120 y por defecto 120

### Requirement: Cambio de la configuración del desktop v4
Al cambiar un valor, la página SHALL pedir confirmación con `ConfirmDialog` mostrando el valor anterior y el nuevo y que aplica a todos los desktops v4 en hasta 5 minutos; al confirmar MUST enviar solo esa llave con la versión leída a v4 `PUT /admin/desktop-settings` con el token del usuario y mostrar el resultado o el error inline sin cambiar el control.

#### Scenario: Bajar el máximo por ventana
- **WHEN** el Developer cambia "Máximo de mensajes por ventana" de 7 a 5 y confirma
- **THEN** el valor queda en 5 y la página muestra su username y la fecha del cambio

#### Scenario: Valor fuera de límites
- **WHEN** el Developer escribe 10 en "Separación mínima entre mensajes (segundos)"
- **THEN** la página muestra el límite permitido (60 a 600) y no permite guardar

#### Scenario: Conflicto
- **WHEN** v4 responde 409 porque otra persona guardó al mismo tiempo
- **THEN** la página muestra "La configuración cambió; recarga para ver el valor actual" y conserva el valor anterior
