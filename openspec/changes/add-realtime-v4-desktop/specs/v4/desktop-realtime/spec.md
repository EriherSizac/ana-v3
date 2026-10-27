# Spec Delta

## Purpose

Mantener al desktop v4 conectado al canal realtime de ANA para que reaccione al momento a jobs nuevos o reasignados y a cambios de configuración, dejando el polling de jobs y de configuración solo como respaldo.

## ADDED Requirements

### Requirement: Conexión del desktop al canal
Con sesión iniciada, el canal habilitado y una URL configurada (`ANA_REALTIME_URL` del entorno o la URL execute-api de prod embebida al compilar), el main SHALL conectarse a ella con `client=desktop`, la versión de la app y el ID token vigente como subprotocolo, y MUST cerrar la conexión al cerrar sesión, cambiar de usuario o salir. El token MUST NOT escribirse en logs.

#### Scenario: Login
- **WHEN** el agente inicia sesión en el desktop
- **THEN** el main abre la conexión con `client=desktop&v=<versión>` y envía `ping`

#### Scenario: Cierre de sesión
- **WHEN** el agente cierra sesión
- **THEN** la conexión se cierra y no se reabre hasta el siguiente login

### Requirement: Conexión confirmada
El main SHALL considerar el canal activo solo después de recibir el primer `pong` de la conexión y MUST considerarlo inactivo al cerrarse el socket o si un `pong` no llega en 30 s tras un `ping`.

#### Scenario: Pong perdido
- **WHEN** el main envía `ping` y no recibe `pong` en 30 s
- **THEN** marca el canal inactivo, cierra el socket y reconecta con backoff

### Requirement: Reconexión con backoff
Al perder la conexión, el main SHALL reintentar con espera exponencial con jitter (1 s, 2 s, 4 s… hasta 5 min) y, tras un rechazo 403 o 5 fallos seguidos, hasta 15 min; MUST reiniciar la espera tras una conexión confirmada.

#### Scenario: Corte de red
- **WHEN** la PC pierde red 3 minutos
- **THEN** el main reintenta con esperas crecientes y, al volver la red, reconecta en máximo 5 minutos

#### Scenario: Realtime apagado en el servidor
- **WHEN** el servidor rechaza `$connect` con 403
- **THEN** el main sigue con el polling de 5 s y reintenta con esperas de hasta 15 min

### Requirement: Reconexión planeada
El main SHALL abrir una conexión nueva a los 110 minutos de la actual o cuando el `TokenBroker` obtenga un token nuevo, y MUST cerrar la anterior solo después de confirmar la nueva.

#### Scenario: Renovación del token
- **WHEN** el `TokenBroker` renueva el ID token
- **THEN** el main abre otra conexión con el token nuevo y, tras su `pong`, cierra la anterior

### Requirement: Latido del desktop
Con la conexión abierta, el main SHALL enviar `{"action":"ping"}` cada 5 minutos.

#### Scenario: Sin eventos durante una hora
- **WHEN** no hay eventos durante 60 minutos
- **THEN** la conexión sigue abierta porque el main envió un `ping` cada 5 minutos

### Requirement: Consulta inmediata ante jobs.changed
Al recibir `jobs.changed`, el main SHALL consultar `GET /jobs/poll` en máximo 1 s, agrupando eventos que lleguen en ese segundo en una sola consulta; si hay un envío en curso, MUST consultar al terminar el envío en lugar de interrumpirlo.

#### Scenario: Reparto desde ANA Admin
- **WHEN** un supervisor reparte contactos al agente
- **THEN** aparecen en "Mi asignación" en menos de 3 segundos

#### Scenario: Ráfaga de eventos
- **WHEN** llegan 5 `jobs.changed` en medio segundo
- **THEN** el main hace una sola consulta `GET /jobs/poll`

### Requirement: Lectura inmediata de configuración
Al recibir `settings.changed` con `ref.scope: "desktop"`, el main SHALL leer `GET /settings` en máximo 1 s y aplicar el resultado como cualquier lectura periódica; otros `scope` MUST ignorarse.

#### Scenario: Cambio de ritmo
- **WHEN** un Developer cambia `sendMinGapSeconds` a 180
- **THEN** el desktop aplica 180 s en el siguiente cálculo de espera, sin esperar 5 minutos

### Requirement: Lectura al reconectar
Cada vez que una conexión queda confirmada, el main SHALL hacer una consulta `GET /jobs/poll` y una lectura `GET /settings`, para recuperar lo que cambió mientras estuvo desconectado.

#### Scenario: Reconexión tras corte
- **WHEN** el main reconecta después de 10 minutos sin red
- **THEN** consulta jobs y configuración una vez sin esperar al siguiente ciclo

### Requirement: Intervalos de respaldo
Mientras el canal esté activo, la consulta periódica de jobs SHALL hacerse cada 2 minutos en lugar de cada 5 s y la de configuración cada 15 minutos en lugar de cada 5; con el canal inactivo MUST usarse 5 s y 5 minutos, y este requisito prevalece sobre los intervalos de `v4/job-processing` y `v4/desktop-remote-settings`.

#### Scenario: Canal activo sin eventos
- **WHEN** el canal está activo y no llegan eventos durante 10 minutos
- **THEN** el main consultó `GET /jobs/poll` unas 5 veces

#### Scenario: Canal caído
- **WHEN** la conexión se cae
- **THEN** la siguiente consulta de jobs ocurre en máximo 5 segundos

### Requirement: Flag local de realtime
Con la variable de entorno `ANA_REALTIME=off`, el main MUST NOT conectarse al canal y SHALL usar los intervalos de 5 s y 5 minutos.

#### Scenario: PC con realtime desactivado
- **WHEN** el desktop arranca con `ANA_REALTIME=off`
- **THEN** no abre ninguna conexión WebSocket y consulta jobs cada 5 segundos

#### Scenario: Build sin URL del canal
- **WHEN** el desktop arranca sin `ANA_REALTIME_URL` y sin URL embebida
- **THEN** no abre ninguna conexión WebSocket y consulta jobs cada 5 segundos y configuración cada 5 minutos

### Requirement: Actualización de acceso forzada en el desktop
Al recibir `session.refresh`, el main SHALL cerrar la conexión con código 4001, volver a leer `GET /me` para el permiso de respuesta manual, avisar al renderer para que vuelva a leer `GET /me` y recalcule sus pestañas, consultar `GET /jobs/poll` y `GET /settings`, y reconectar tras una espera aleatoria de 0 a 10 s que MUST NOT contar como fallo de conexión.

#### Scenario: Permisos del rol cambiados
- **WHEN** un admin quita `ana:chats:message:reply` al rol del agente y el desktop recibe `session.refresh` con `reason: "permissions"`
- **THEN** el desktop deja de permitir la respuesta manual y el renderer actualiza sus pestañas sin reiniciar la app

#### Scenario: Reconexión tras la actualización forzada
- **WHEN** el desktop procesó un `session.refresh`
- **THEN** abre una conexión nueva en máximo 10 s con la espera de backoff sin cambios
