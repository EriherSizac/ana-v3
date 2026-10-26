# Spec Delta

## ADDED Requirements

### Requirement: Aviso de asignación truncada
Si la última respuesta de `GET /jobs/poll` trae `truncated: true`, la vista "Mi asignación" SHALL mostrar "Mostrando N de M pendientes; envía los actuales para ver el resto." con N pendientes recibidos y M = `pendingTotal`. Sin truncado el aviso MUST ocultarse.

#### Scenario: Asignación muy grande
- **WHEN** el agente tiene 3000 pendientes y el poll entrega 2000
- **THEN** la vista muestra "Mostrando 2000 de 3000 pendientes; envía los actuales para ver el resto."
