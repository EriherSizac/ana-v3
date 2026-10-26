# Spec Delta

## MODIFIED Requirements

### Requirement: Envío de la gestión
Al pulsar "Subir", la ventana SHALL enviar `POST /interactions` a la API de interacciones con `{ interactions: [ interacción ] }` y cabecera `X-Api-Key`. Si la respuesta es 404 y algún teléfono empieza con `+52`, MUST reintentarse una vez quitando ese prefijo.

#### Scenario: Contenido de la interacción
- **WHEN** el agente envía la gestión
- **THEN** la interacción incluye `credit_id` seleccionado, `campaign_name`, `user_id` de servicio fijo, `subdictamen`, `contactable`, `comments` y `phone_number` en formato `+52...`
- **AND** incluye `contact_date` (`YYYY-MM-DD`), `contact_time` (`HH:MM`) y `range_time` (`HH:00 - HH+1:00`) en hora de Ciudad de México, `action_channel` y `action` `whatsapp`, `inoutbound: "inbound"`
- **AND** `email_address`, `template_used`, `promise_date`, `promise_amount`, `promise_payment_plan` y `payment_made_date` van en `null`

#### Scenario: Gestión por la noche
- **WHEN** el agente sube una gestión el 2026-10-26 a las 21:10 hora de Ciudad de México
- **THEN** la interacción lleva `contact_date: "2026-10-26"`, `contact_time: "21:10"` y `range_time: "21:00 - 22:00"`

#### Scenario: Envío exitoso
- **WHEN** el CRM responde con estado 2xx
- **THEN** se muestra "✅ Gestión subida" y el modal se cierra a los 800 ms

#### Scenario: Envío fallido
- **WHEN** el CRM responde con error o hay fallo de red
- **THEN** se muestra "❌ No se pudo subir gestión" y en el modal "❌ Error: {status} {error}"
- **AND** el modal permanece abierto para reintentar

> Nota: el `user_id` es un identificador de servicio fijo en el código, no el agente que hizo la gestión.
