# Spec Delta

## Purpose

Que el CLI v3 siga consultando y enviando asignaciones tras la suspensión del PC o congelamientos de ventanas de WhatsApp.

## ADDED Requirements

### Requirement: Detección de reanudación
El CLI SHALL comparar `Date.now()` cada 5 s y tratar una brecha mayor a 30 s (o un reloj que retrocede) como reanudación. Al reanudar MUST despertar de inmediato la espera de poll, reconectar realtime (cerrando el socket anterior y reiniciando el backoff), refrescar en silencio el token Cognito si vence en menos de 5 min o ya venció, refrescar los settings remotos y revisar las ventanas de WhatsApp.

#### Scenario: PC suspendido 10 minutos
- **WHEN** el reloj avanza 10 min entre dos ticks del detector
- **THEN** el CLI llama `/get/chats` sin esperar el intervalo y abre un socket realtime nuevo

#### Scenario: Ticks normales
- **WHEN** los ticks llegan cada 5 s
- **THEN** no se dispara ninguna reanudación

### Requirement: Interacciones de UI acotadas
Toda interacción Playwright del loop principal que no sea de envío (widget de estado, bloqueo de pausa, sondeos) MUST tener límite de tiempo y nunca bloquear la espera de poll; los pasos de envío conservan sus propios timeouts.

#### Scenario: Widget congelado
- **WHEN** `page.evaluate` del widget de estado nunca resuelve
- **THEN** la espera de poll sigue avanzando y el siguiente `/get/chats` ocurre a tiempo

### Requirement: Latido del loop principal
El CLI SHALL registrar un latido en cada iteración y en cada tick de espera; si pasan más de 3× el intervalo esperado sin latido y no hay un envío en curso, MUST registrarlo y reiniciar el loop, retomando asignaciones desde el diario sin reenviar las ya enviadas.

#### Scenario: Iteración atascada
- **WHEN** una iteración no completa en más de 90 s y no se está enviando
- **THEN** el supervisor inicia una iteración nueva y la atascada no envía nada

#### Scenario: Envío largo
- **WHEN** el envío de una asignación dura más de 90 s
- **THEN** el loop no se reinicia

### Requirement: Salud de ventanas de WhatsApp
Al reanudar, el CLI SHALL sondear cada ventana con `page.evaluate` acotado; una ventana sin respuesta MUST recargarse (la de automatización nunca mientras envía) y una ventana o navegador cerrado MUST mostrar un mensaje recuperable sin terminar el proceso.

#### Scenario: Ventana cerrada
- **WHEN** la ventana manual se cerró durante la suspensión
- **THEN** el CLI muestra "cierra ANA y vuelve a abrirlo" y sigue consultando asignaciones

### Requirement: Realtime sin pong
El cliente realtime SHALL reconectar si no recibe pong durante 2 heartbeats consecutivos.

#### Scenario: Socket medio abierto
- **WHEN** pasan 2 heartbeats sin pong
- **THEN** el siguiente ping cierra el socket y abre uno nuevo
