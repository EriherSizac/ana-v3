# Spec Delta

## MODIFIED Requirements

### Requirement: Resolución de credit_id
El sistema SHALL tomar `credit_id` de la primera columna no vacía entre `credit`, `credito`, `credit_id` e `id_credito` de la fila; si no hay, MUST buscarlo con `POST {INTERACTIONS_API_BASE}/client-info` (`campaign_name`, `search_type: "Telefono"`, teléfono `+` seguido del número normalizado con las mismas reglas de México que usa el desktop), reintentando sin `+52` ante 404, y usar `""` si no se encuentra, falla o el teléfono no se puede normalizar.

#### Scenario: CRM guarda teléfonos sin prefijo
- **WHEN** la búsqueda con `+525512345678` responde 404 y con `5512345678` encuentra al cliente
- **THEN** se usa el `credit_id` del primer resultado

#### Scenario: Teléfono con 044
- **WHEN** la fila no trae crédito y el teléfono es `0445512345678`
- **THEN** la búsqueda se hace con `+525512345678`
