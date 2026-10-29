# Spec Delta

## Purpose

Que el desktop v4 recupere token, realtime, jobs y WhatsApp tras la suspensión del PC sin intervención del operador.

## ADDED Requirements

### Requirement: Señales de reanudación
El desktop SHALL tratar `powerMonitor` `resume` y `unlock-screen`, y como respaldo una brecha de reloj mayor a 30 s entre ticks de 5 s, como reanudación; las señales MUST coalescerse (una recuperación a la vez; señales en los 15 s siguientes se ignoran) y solo actuar con un operador autenticado.

#### Scenario: Resume y unlock seguidos
- **WHEN** llegan `resume` y `unlock-screen` con 2 s de diferencia
- **THEN** se ejecuta una sola recuperación

### Requirement: Recuperación tras reanudar
La recuperación SHALL, en orden y con timeout y manejo de errores propio por paso: refrescar el token vía `tokenBroker`, reconectar realtime con backoff reiniciado, consultar jobs y settings remotos de inmediato, sondear `getState` de whatsapp-web.js con timeout y re-enviar el heartbeat. Un paso colgado o fallido MUST NOT impedir los siguientes.

#### Scenario: Token colgado
- **WHEN** `tokenBroker` no responde en 15 s
- **THEN** la recuperación continúa con realtime, jobs, WhatsApp y heartbeat

### Requirement: Reinicio de WhatsApp conservando sesión
Si WhatsApp estaba conectado antes de suspender y al reanudar `getState` no es `CONNECTED` (o no responde), el desktop SHALL esperar hasta 60 s a que termine el envío en curso y reiniciar el cliente por la ruta existente que conserva la sesión; si antes estaba desconectado, en QR o inactivo MUST NOT reiniciarlo.

#### Scenario: Conexión perdida al dormir
- **WHEN** antes de suspender estaba `CONNECTED` y al reanudar `getState` excede el timeout
- **THEN** el cliente se reinicia sin borrar la sesión guardada

#### Scenario: Sesión abierta en otra PC
- **WHEN** antes de suspender el estado era `disconnected`
- **THEN** no se reinicia WhatsApp y se mantiene el mensaje de reconexión manual
