# Spec Delta

## ADDED Requirements

### Requirement: Plantilla por defecto de cargas sin plantilla
En "Mi asignación", si la plantilla de un archivo es la plantilla por defecto `{mensaje}` y las columnas de su primer job no incluyen `mensaje` ni `message`, el editor de ese archivo SHALL mostrarse vacío y marcado como obligatorio, de modo que el agente escriba el mensaje antes de enviar.

#### Scenario: Carga de ANA Admin sin plantilla
- **WHEN** un supervisor reparte desde ANA Admin un CSV con `telefono,nombre,saldo` sin plantilla
- **THEN** el agente ve el editor vacío con "Escribe el mensaje antes de enviar." y "Enviar" deshabilitado hasta escribirlo

#### Scenario: CSV con columna mensaje
- **WHEN** el CSV trae columna `mensaje`
- **THEN** el editor muestra `{mensaje}` como hasta ahora
