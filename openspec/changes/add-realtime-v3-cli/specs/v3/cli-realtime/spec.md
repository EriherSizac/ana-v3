# Spec Delta

## Purpose

Mantener al CLI v3 conectado al canal realtime de ANA para que empiece una asignación publicada y aplique cambios de configuración al momento, dejando el polling de asignaciones y de configuración solo como respaldo.

## ADDED Requirements

### Requirement: Conexión del CLI al canal
Tras iniciar sesión con Cognito y con el canal habilitado, el proceso principal del CLI SHALL conectarse a `ANA_REALTIME_URL` (por defecto la URL de prod) con `client=cli`, su versión y el ID token de la sesión como subprotocolo, y MUST cerrar la conexión con Ctrl+C o al cerrar la sesión. El token MUST NOT imprimirse ni escribirse en disco.

#### Scenario: Arranque con sesión
- **WHEN** el agente inicia sesión en el CLI
- **THEN** el CLI abre la conexión con `client=cli&v=<versión>` y envía `ping`

#### Scenario: Sin sesión Cognito
- **WHEN** el CLI no tiene ID token
- **THEN** no abre la conexión y espera 30 segundos entre polls como hoy

### Requirement: Canal activo del CLI
El CLI SHALL considerar el canal activo solo tras el primer `pong` de la conexión, y MUST considerarlo inactivo al cerrarse el socket o si un `pong` no llega en 30 s.

#### Scenario: Pong perdido
- **WHEN** el CLI envía `ping` y no recibe `pong` en 30 s
- **THEN** marca el canal inactivo, cierra el socket y reconecta con backoff

### Requirement: Reconexión del CLI
Al perder la conexión, el CLI SHALL reintentar con espera exponencial con jitter (1 s, 2 s, 4 s… hasta 5 min) y, tras un rechazo 403 o 5 fallos seguidos, hasta 15 min; también MUST reconectar a los 110 minutos o al renovar el ID token, abriendo la conexión nueva antes de cerrar la anterior.

#### Scenario: Renovación del token
- **WHEN** la sesión del CLI renueva el ID token
- **THEN** el CLI abre otra conexión con el token nuevo y, tras su `pong`, cierra la anterior

#### Scenario: Realtime apagado
- **WHEN** el servidor rechaza `$connect` con 403
- **THEN** el CLI sigue con polls cada 30 segundos y reintenta la conexión con esperas de hasta 15 min

### Requirement: Latido del CLI
Con la conexión abierta, el CLI SHALL enviar `{"action":"ping"}` cada 5 minutos, también durante ciclos de envío y pausas por lote.

#### Scenario: Pausa por lote de 30 minutos
- **WHEN** el CLI está en la pausa por lote
- **THEN** la conexión sigue abierta porque el CLI envía `ping` cada 5 minutos

### Requirement: Filtro de avisos de asignación
El CLI SHALL tratar como aviso de asignación solo `assignment.published` cuya `campaign`, normalizada en minúsculas, coincida con la campaña de la sesión; cualquier otro evento MUST ignorarse para el poll.

#### Scenario: Aviso de otra campaña
- **WHEN** el agente recibe `assignment.published` de `zendere` y su sesión es de `prueba`
- **THEN** el CLI sigue esperando sin consultar

### Requirement: Avisos fuera de la espera
Un aviso de asignación recibido durante un ciclo de envío o la pausa por lote MUST NOT interrumpirlos; el CLI SHALL registrar que hubo aviso y hacer el siguiente poll sin espera al terminar el ciclo.

#### Scenario: Aviso a mitad de ciclo
- **WHEN** llega `assignment.published` mientras el CLI envía el contacto 5 de 20
- **THEN** el ciclo continúa igual y, al terminarlo, el CLI consulta de inmediato en lugar de esperar 2 minutos

### Requirement: Lectura inmediata de configuración del CLI
Al recibir `settings.changed` con `ref.scope: "cli"`, el CLI SHALL leer `GET /agent/settings` en máximo 1 s y aplicar el resultado como cualquier lectura periódica; otros `scope` MUST ignorarse.

#### Scenario: Developer cambia un flag
- **WHEN** un Developer activa `noWhatsappConsultRegistration`
- **THEN** las ventanas del CLI usan `true` en la siguiente acción que dependa del flag, en segundos

### Requirement: Intervalo de configuración con canal activo
Mientras el canal esté activo, la lectura periódica de `GET /agent/settings` SHALL hacerse cada 15 minutos; con el canal inactivo MUST hacerse cada 5 minutos, y este requisito prevalece sobre el intervalo de `v3/cli-remote-settings`.

#### Scenario: Canal activo
- **WHEN** el canal está activo y no llegan eventos durante 30 minutos
- **THEN** el CLI leyó la configuración 2 veces en ese lapso

### Requirement: Lectura al reconectar del CLI
Cada vez que una conexión queda confirmada, el CLI SHALL leer `GET /agent/settings` y, si está esperando el siguiente poll, terminar la espera y consultar asignaciones.

#### Scenario: Reconexión tras corte de red
- **WHEN** el CLI reconecta después de 10 minutos sin red mientras esperaba el poll
- **THEN** consulta asignaciones y configuración de inmediato

### Requirement: Estado del canal en el widget
Mientras espera el siguiente poll con el canal activo, el widget de estado de las ventanas SHALL mostrar "En vivo · respaldo en <tiempo>"; con el canal inactivo MUST mostrar "Próximo poll: <tiempo>" como hoy.

#### Scenario: Canal activo
- **WHEN** el CLI espera el poll de respaldo con el canal activo
- **THEN** las ventanas muestran "En vivo · respaldo en 1m 45s"

### Requirement: Flag local de realtime del CLI
Con `ANA_REALTIME=off`, el CLI MUST NOT conectarse al canal y SHALL esperar 30 segundos entre polls y leer la configuración cada 5 minutos.

#### Scenario: Equipo con realtime desactivado
- **WHEN** el CLI arranca con `ANA_REALTIME=off`
- **THEN** no abre conexión WebSocket y consulta asignaciones cada 30 segundos
