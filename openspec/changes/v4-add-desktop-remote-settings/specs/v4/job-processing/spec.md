# Spec Delta

## MODIFIED Requirements

### Requirement: Ritmo anti-bloqueo
Los envíos SHALL agruparse por archivo de origen, un archivo a la vez y en orden de aparición. Antes de cada job MUST esperarse al menos `sendMinGapSeconds` desde el anterior y no superar `sendMaxPerWindow` envíos en cualquier ventana de `sendWindowMinutes`, según la configuración remota vigente (por defecto 2 minutos, 7 envíos y 20 minutos); durante la espera se emite cada segundo la fase `waiting` con el tiempo restante. Todo intento, exitoso o fallido, cuenta para el ritmo.

#### Scenario: Octavo mensaje
- **WHEN** con la configuración por defecto ya se enviaron 7 mensajes en los últimos 20 minutos
- **THEN** el siguiente espera a que el más antiguo salga de la ventana

#### Scenario: Gap mínimo
- **WHEN** con la configuración por defecto acaba de enviarse un mensaje
- **THEN** el siguiente no sale antes de 2 minutos

#### Scenario: Ritmo ajustado remotamente
- **WHEN** la configuración vigente tiene `sendMinGapSeconds: 180`
- **THEN** el siguiente mensaje no sale antes de 3 minutos del anterior
