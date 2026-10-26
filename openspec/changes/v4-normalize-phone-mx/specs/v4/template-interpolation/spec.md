# Spec Delta

## MODIFIED Requirements

### Requirement: Normalización de teléfono
El teléfono SHALL reducirse a dígitos y quitar un prefijo `00`. Con lada `52` MUST producir `52` + 10 dígitos para 10 dígitos, `52`+10, `521`+10, `044`+10, `045`+10, `01`+10 y `1`+10; un número escrito con `+` o `00` y otra lada se conserva como extranjero; cualquier otra forma es inválida. Con otra lada se antepone si falta. Solo MUST aceptarse un resultado de 11 a 15 dígitos; el número real lo resuelve WhatsApp.

#### Scenario: Número local mexicano
- **WHEN** el teléfono es "55 1234 5678" con lada 52
- **THEN** se consulta WhatsApp con "525512345678"

#### Scenario: Celular legado con 1
- **WHEN** el teléfono es "+52 1 55 1234 5678"
- **THEN** se normaliza a "525512345678"

#### Scenario: Prefijo nacional de celular
- **WHEN** el teléfono es "044 55 1234 5678" o "045 55 1234 5678" con lada 52
- **THEN** se normaliza a "525512345678"

#### Scenario: Uno sin lada
- **WHEN** el teléfono es "1 55 1234 5678" con lada 52
- **THEN** se normaliza a "525512345678"

#### Scenario: Número extranjero con más
- **WHEN** el teléfono es "+1 305 555 1234" con lada 52
- **THEN** se conserva como "13055551234"

#### Scenario: Teléfono inválido
- **WHEN** el teléfono es "12345" con lada 52
- **THEN** la normalización no produce número
