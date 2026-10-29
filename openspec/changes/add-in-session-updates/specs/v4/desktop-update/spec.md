# Spec Delta

## Purpose

El chequeo periódico deja de bloquear la interfaz a media sesión.

## MODIFIED Requirements

### Requirement: Chequeo periódico y overlay a media sesión
El updater SHALL volver a consultar el feed cada 30 minutos mientras la app esté abierta. Una versión encontrada después de la pantalla de arranque MUST seguir el flujo no bloqueante de `v4/desktop-in-session-update` (aviso fijo, pausa de jobs, cuenta de 60 s e instalación silenciosa); la app ya no reemplaza la interfaz por un overlay bloqueante a media sesión.

#### Scenario: Equipo que nunca cierra la app
- **WHEN** se publica una versión nueva mientras el operador trabaja
- **THEN** en máximo 30 minutos aparece el aviso no bloqueante, se instala la versión y la app se reinicia sola

#### Scenario: Pantalla de arranque
- **WHEN** la versión nueva se detecta antes de pasar la pantalla de arranque
- **THEN** se mantiene la pantalla bloqueante de siempre
