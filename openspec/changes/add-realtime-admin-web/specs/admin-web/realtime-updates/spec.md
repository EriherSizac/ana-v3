# Spec Delta

## Purpose

Mantener actualizadas las secciones de ANA Admin (cargas, contactos por revisar, roster, Mi asignación y configuración) a partir de los avisos del canal realtime, sin recargar la página y sin pisar el trabajo sin guardar del usuario.

## ADDED Requirements

### Requirement: Conexión directa desde el navegador
Con sesión iniciada y `NEXT_PUBLIC_REALTIME_ENABLED` distinto de `false`, la consola SHALL abrir una sola conexión por pestaña a `NEXT_PUBLIC_REALTIME_URL` con `client=admin`, la versión de la app y el ID token de la sesión como subprotocolo, sin pasar por el BFF, y MUST cerrarla al cerrar sesión. El token MUST NOT registrarse en la consola del navegador.

#### Scenario: Login
- **WHEN** un supervisor inicia sesión y entra a la consola
- **THEN** la pestaña abre una conexión con `client=admin` y envía `ping`

#### Scenario: Navegación entre secciones
- **WHEN** el usuario pasa de Contactos a Agentes
- **THEN** la pestaña conserva la misma conexión

### Requirement: Mantenimiento de la conexión de la consola
La consola SHALL enviar `ping` al abrir y cada 5 minutos, considerar el canal activo tras el primer `pong`, reconectar con espera exponencial con jitter (1 s… 5 min; 15 min tras 403 o 5 fallos) y reconectar a los 110 minutos o al renovar el token, abriendo la nueva conexión antes de cerrar la anterior.

#### Scenario: Token renovado por Amplify
- **WHEN** la sesión obtiene un ID token nuevo
- **THEN** la consola abre otra conexión con él y, tras su `pong`, cierra la anterior

#### Scenario: Realtime apagado
- **WHEN** el servidor rechaza `$connect` con 403
- **THEN** la consola marca "Sin actualizaciones en vivo" y reintenta con esperas de hasta 15 min

### Requirement: Pestaña oculta
Si la pestaña permanece oculta más de 10 minutos, la consola SHALL cerrar la conexión; al volver a ser visible MUST reconectar y recargar la sección visible.

#### Scenario: Volver tras una hora
- **WHEN** el usuario regresa a una pestaña oculta durante una hora
- **THEN** la consola reconecta y recarga los datos de la sección actual una vez

### Requirement: Recarga por sección
Cada sección SHALL recargar por el BFF sus datos al recibir su evento, en máximo 1 s y agrupando eventos de ese segundo: historial y detalle de cargas con `uploads.changed` y `review.changed` de su campaña, revisión v4 con `review.changed`, Agentes con `roster.changed`, Mi asignación con `assignment.pending` y `publications.changed` de su campaña, y Configuración con `settings.changed`.

#### Scenario: Avance de una carga
- **WHEN** el supervisor tiene abierto el detalle de una carga de `prueba` y el desktop acusa envíos de esa carga
- **THEN** los contadores de la carga se actualizan en segundos sin recargar la página

#### Scenario: Reparto a un agente con Mi asignación abierta
- **WHEN** un supervisor reparte contactos de `prueba` al agente y este tiene "Mi asignación" abierta en `prueba` sin archivos cargados
- **THEN** el nuevo archivo pendiente aparece en la lista en segundos

#### Scenario: Evento de otra campaña
- **WHEN** la vista muestra `prueba` y llega `roster.changed` de `zendere`
- **THEN** la vista no recarga nada

### Requirement: Trabajo sin guardar protegido
Si la sección tiene trabajo del usuario sin guardar (archivos cargados en la tabla de Mi asignación, filas seleccionadas, un diálogo de confirmación abierto o un formulario modificado), un evento MUST NOT recargarla; SHALL mostrar el aviso "Hay cambios nuevos · Actualizar" que recarga al pulsarlo.

#### Scenario: Agente con contactos seleccionados
- **WHEN** el agente tiene 12 filas seleccionadas en Mi asignación y llega `assignment.pending`
- **THEN** la tabla y la selección no cambian y aparece "Hay cambios nuevos · Actualizar"

#### Scenario: Developer editando configuración
- **WHEN** un Developer tiene abierto el diálogo para guardar un valor y llega `settings.changed`
- **THEN** el diálogo sigue abierto y al cerrarlo la página muestra el aviso

### Requirement: Lectura al reconectar en la consola
Cada vez que la conexión queda confirmada después de haber estado inactiva, la consola SHALL recargar una vez la sección visible, aplicando la misma protección del trabajo sin guardar.

#### Scenario: Reconexión tras corte
- **WHEN** la red vuelve después de 5 minutos con el historial de cargas abierto
- **THEN** la consola reconecta y recarga el historial una vez

### Requirement: Canal inactivo en la consola
Con el canal inactivo, la consola SHALL recargar la sección visible al recuperar el foco la pestaña (máximo una vez por minuto) y MUST NOT hacer polling periódico.

#### Scenario: Volver a la pestaña sin canal
- **WHEN** el canal está inactivo y el usuario vuelve a la pestaña tras 3 minutos en otra
- **THEN** la sección visible se recarga una vez

### Requirement: Indicador de actualización en vivo
El encabezado SHALL mostrar "En vivo" con el canal activo y "Sin actualizaciones en vivo" con el canal inactivo o deshabilitado, sin bloquear ninguna acción de la consola.

#### Scenario: Canal caído
- **WHEN** la conexión se pierde
- **THEN** el encabezado muestra "Sin actualizaciones en vivo" y la consola sigue funcionando

### Requirement: Flag de build de realtime
Con `NEXT_PUBLIC_REALTIME_ENABLED=false`, la consola MUST NOT abrir conexiones y SHALL comportarse como canal inactivo.

#### Scenario: Despliegue con realtime apagado
- **WHEN** ANA Admin se despliega con `NEXT_PUBLIC_REALTIME_ENABLED=false`
- **THEN** ninguna pestaña abre WebSocket y el encabezado muestra "Sin actualizaciones en vivo"
