# Spec Delta

## ADDED Requirements

### Requirement: Por revisar en el panel de pendientes
El panel "Envíos pendientes" SHALL mostrar junto a cada agente "N por revisar" cuando el resumen trae `review` mayor a 0, y el texto "Resuélvelos desde ANA Admin." La reasignación MUST seguir moviendo solo pendientes.

#### Scenario: Líder ve interrumpidos
- **WHEN** un agente de la campaña tiene 2 jobs por revisar
- **THEN** el panel muestra "2 por revisar" para ese agente sin botón para moverlos
