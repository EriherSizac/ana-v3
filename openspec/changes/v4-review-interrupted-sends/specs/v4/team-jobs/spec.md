# Spec Delta

## ADDED Requirements

### Requirement: Por revisar en el resumen
`GET /jobs/summary` SHALL incluir en cada operador el conteo `review` de sus jobs `review` vigentes de la campaña (tras aplicar el paso a revisión de los `sending` vencidos) y listar también a los operadores que solo tienen jobs por revisar. `total` MUST seguir contando solo pendientes.

#### Scenario: Agente con interrumpidos
- **WHEN** `a1` tiene 3 pendientes y 2 jobs `review` en la campaña
- **THEN** el resumen trae `a1` con `pending: 3` y `review: 2`, y `total` suma 3
