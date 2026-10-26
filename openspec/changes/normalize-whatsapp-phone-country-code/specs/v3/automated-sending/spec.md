# Spec Delta

## MODIFIED Requirements

### Requirement: Apertura del chat del contacto
Para cada contacto, el CLI SHALL extraer los dígitos de `phone` y abrir `https://web.whatsapp.com/send?phone=<teléfono>` en la ventana de automatización (timeout 30 s y espera adicional de 3 s). Si los dígitos son 10, `52` + 10 o `521` + 10, `<teléfono>` MUST ser `52` + los 10 dígitos nacionales; en otro caso SHALL usarse los dígitos tal cual. Mientras procesa el contacto, MUST mostrar un overlay "Enviando Mensaje — Por favor espera..." que se retira al terminar.

#### Scenario: Contacto sin teléfono
- **WHEN** el campo `phone` del contacto está vacío o no tiene dígitos
- **THEN** no se abre ningún chat y el resultado es `status: error` con "Contacto sin teléfono (phone vacío o no mapeado desde CSV)"

#### Scenario: Teléfono de 10 dígitos
- **WHEN** el teléfono es `5512345678`
- **THEN** se abre `https://web.whatsapp.com/send?phone=525512345678`

#### Scenario: Teléfono con prefijo móvil 521
- **WHEN** el teléfono es `5215512345678`
- **THEN** se abre `https://web.whatsapp.com/send?phone=525512345678`

#### Scenario: Teléfono con formato
- **WHEN** el teléfono es `+52 (55) 1234-5678`
- **THEN** se abre `https://web.whatsapp.com/send?phone=525512345678`

#### Scenario: Teléfono ya canónico
- **WHEN** el teléfono es `525512345678`
- **THEN** se abre `https://web.whatsapp.com/send?phone=525512345678`

#### Scenario: Número no mexicano
- **WHEN** el teléfono es `+1 415 555 0100`
- **THEN** se abre `https://web.whatsapp.com/send?phone=14155550100` sin modificar los dígitos
