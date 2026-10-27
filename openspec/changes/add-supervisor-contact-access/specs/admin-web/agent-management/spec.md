# Spec Delta

## ADDED Requirements

### Requirement: Insignia de supervisor
En la sección Agentes, un usuario que figura en la lista derivada de la campaña con `kind:"supervisor"` SHALL mostrar en la columna de cada flota, junto a su estado ("Agente" o "Deshabilitado"), la insignia "Supervisor"; deshabilitar y rehabilitar MUST funcionar igual que para un agente.

#### Scenario: Supervisora habilitada
- **WHEN** el líder elige `didi_vip` y `sara` es supervisora derivada sin excepción en v3
- **THEN** la columna v3 de `sara` muestra "Agente" y la insignia "Supervisor"

#### Scenario: Deshabilitar a una supervisora
- **WHEN** el líder deshabilita a `sara` en v3 y confirma
- **THEN** la columna v3 muestra "Deshabilitado" y la insignia "Supervisor"
