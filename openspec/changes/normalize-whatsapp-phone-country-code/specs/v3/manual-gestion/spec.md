# Spec Delta

## MODIFIED Requirements

### Requirement: Normalización de teléfono para el CRM
Para consultar cliente y registrar la gestión, el teléfono MUST normalizarse a formato `+52` + 10 dígitos a partir de sus dígitos: 10 dígitos reciben el prefijo `52`; 13 dígitos que empiezan con `521` se convierten a `52` + los últimos 10; 12 dígitos que empiezan con `52` se conservan. Cualquier otra combinación de longitud y prefijo SHALL producir un valor vacío.

#### Scenario: Número móvil con 521
- **WHEN** el teléfono detectado es `5215512345678`
- **THEN** el valor normalizado es `+525512345678`

#### Scenario: Número de 10 dígitos
- **WHEN** el teléfono detectado es `5512345678`
- **THEN** el valor normalizado es `+525512345678`

#### Scenario: Número con espacios y signos
- **WHEN** el teléfono detectado es `+52 1 55 1234-5678`
- **THEN** el valor normalizado es `+525512345678`

#### Scenario: Número extranjero
- **WHEN** el teléfono detectado es `14155550100`
- **THEN** el valor normalizado es vacío

#### Scenario: 521 con longitud inesperada
- **WHEN** el teléfono detectado es `52155123456789` (14 dígitos)
- **THEN** el valor normalizado es vacío
