# Spec Delta

## MODIFIED Requirements

### Requirement: Registro automático de interacción por respuesta
Para un teléfono nuevo, el monitor SHALL normalizarlo a `+52` + 10 dígitos, consultar en la API de interacciones `POST /client-info` (con reintento sin `+52` ante 404) y `GET /result-codes/{campaña}` con un límite de 10 segundos, y tomar el `credit_id` del primer resultado. Si hay `credit_id`, MUST registrar una interacción con `POST /interactions`.

#### Scenario: Teléfono con crédito
- **WHEN** el CRM devuelve un cliente con `credit_id` y la inserción responde OK
- **THEN** la interacción enviada lleva subdictamen `CLIENTE NO DEFINE`, `contactable: true`, `phone_number` de 10 dígitos, `inoutbound: "inbound"`, canal y acción `whatsapp`, comentario `Monitor: respuesta detectada en No leídos`, fecha/hora/rango actuales en hora de Ciudad de México y campos de promesa en `null`
- **AND** el teléfono se marca como procesado y la ventana muestra durante ~3.5 segundos el aviso "✅ Interacción enviada: {+52...} (credit_id {id})"

#### Scenario: Respuesta detectada por la noche
- **WHEN** el monitor detecta una respuesta el 2026-10-26 a las 22:30 hora de Ciudad de México
- **THEN** la interacción lleva `contact_date: "2026-10-26"`, `contact_time: "22:30"` y `range_time: "22:00 - 23:00"`

#### Scenario: Teléfono sin crédito
- **WHEN** la búsqueda de cliente no devuelve `credit_id`
- **THEN** el teléfono se marca como procesado y no se registra interacción

#### Scenario: Falla la inserción
- **WHEN** `POST /interactions` responde con error
- **THEN** se muestra el aviso "❌ Interacción NO enviada: {+52...}" y el teléfono no se marca como procesado

#### Scenario: Timeout consultando el CRM
- **WHEN** la consulta de cliente y catálogo tarda más de 10 segundos
- **THEN** el ciclo termina sin registrar interacción ni marcar el teléfono

> Nota: el catálogo de códigos de resultado se descarga pero no se usa; el subdictamen está fijo en el código (`whatsapp-monitor.js:539`).
