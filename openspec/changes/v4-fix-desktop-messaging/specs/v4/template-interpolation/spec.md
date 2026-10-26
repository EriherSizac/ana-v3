# Spec Delta

## MODIFIED Requirements

### Requirement: Formato de moneda
Los campos cuyo nombre contiene `balance`, `amount`, `saldo` o `monto` (sin distinguir mayúsculas) SHALL formatearse como moneda MXN con locale `es-MX`. Los modificadores `:dinero`, `:money` o `:$` MUST forzar el formato y `:num`, `:numero` o `:plain` desactivarlo. El valor MUST interpretarse con la misma regla de separadores que las expresiones (coma decimal si termina en coma y 1 o 2 dígitos; si no, comas de miles). Un valor sin dígitos se devuelve tal cual.

#### Scenario: Saldo automático
- **WHEN** la plantilla es `{saldo}` y el valor es "1234.5"
- **THEN** el mensaje muestra "$1,234.50"

#### Scenario: Forzar número plano
- **WHEN** la plantilla es `{saldo:num}` y el valor es "1234.5"
- **THEN** el mensaje muestra "1234.5"

#### Scenario: Coma decimal
- **WHEN** la plantilla es `{saldo}` y el valor es "1234,56" o "1.234,56"
- **THEN** el mensaje muestra "$1,234.56"

#### Scenario: Comas de miles
- **WHEN** la plantilla es `{saldo}` y el valor es "12,345"
- **THEN** el mensaje muestra "$12,345.00"
