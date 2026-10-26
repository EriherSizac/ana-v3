# crm-interactions Specification

## Purpose
Describe cómo el flujo de envío automático del CLI v3 (`v3/cli-whatsapp/index.js` y `agent-config.js`) registra cada intento de contacto en el CRM: obtención del `credit_id`, inserción de la interacción y marcado de teléfonos sin WhatsApp. El registro manual de gestiones desde el botón "Gestión" de la ventana manual queda fuera de este alcance y se describe en otra especificación.

## Requirements

### Requirement: API de interacciones
El CLI SHALL usar como base para las llamadas al CRM la variable `ANA_INTERACTIONS_API_URL` o, por defecto, `https://7uj0qjoby9.execute-api.us-east-2.amazonaws.com`, enviando `Content-Type: application/json` y una cabecera `X-Api-Key` en cada llamada.

#### Scenario: Override de URL
- **WHEN** se define `ANA_INTERACTIONS_API_URL`
- **THEN** `/client-info` e `/interactions` se llaman sobre esa base

> Nota: la API key está embebida en texto plano en el código fuente (`agent-config.js:56`, `agent-config.js:123`, `index.js:581`) y se distribuye dentro del instalador. El endpoint `PATCH /phone` usa la URL fija y no respeta `ANA_INTERACTIONS_API_URL`.

### Requirement: Nombre de campaña para el CRM
El CLI SHALL derivar el `campaign_name` enviado al CRM a partir de la campaña configurada por el agente: si contiene un guion, MUST tomar todo lo que sigue al primer guion; si no, la campaña completa.

#### Scenario: Campaña con prefijo
- **WHEN** la campaña configurada es `12-banco-norte`
- **THEN** el `campaign_name` enviado al CRM es `banco-norte`

#### Scenario: Campaña sin guion
- **WHEN** la campaña configurada es `prueba`
- **THEN** el `campaign_name` es `prueba`

### Requirement: credit_id desde el CSV
Para cada contacto procesado, el CLI SHALL usar como `credit_id` el valor del campo `credit` del contacto (columnas `credit`, `credito`, `credit_id` o `id_credito` del CSV) cuando no está vacío, y en ese caso MUST NOT consultar `/client-info`.

#### Scenario: Crédito en el CSV
- **WHEN** el contacto trae `credit` con valor `ABC123`
- **THEN** no se llama a `/client-info` y la interacción usa `credit_id: ABC123`

### Requirement: Búsqueda de credit_id por teléfono
Si el contacto no trae crédito, el CLI SHALL hacer `POST {base}/client-info` con `{campaign_name, search_type: "Telefono", search_value}`, donde `search_value` es el teléfono en formato `+52` + 10 dígitos. Si la respuesta es 404 y el valor empieza con `+52`, MUST reintentar una vez sin ese prefijo. SHALL tomar `result[0].credit_info.credit_id` de la respuesta exitosa; ante cualquier fallo, el `credit_id` queda vacío.

#### Scenario: Búsqueda por teléfono con reintento
- **WHEN** el contacto no trae crédito, su teléfono es `5215512345678` y `/client-info` responde 404 para `+525512345678`
- **THEN** el CLI reintenta con `search_value: 5512345678`
- **AND** si responde 200 con resultados usa el `credit_id` del primero

#### Scenario: Cliente no encontrado
- **WHEN** ninguna búsqueda devuelve resultados
- **THEN** se imprime "No se encontró credit_id para este teléfono" y la interacción se envía con `credit_id` vacío

### Requirement: Normalización de teléfono para el CRM
Para `/client-info`, el CLI SHALL normalizar el teléfono a partir de sus dígitos así: 10 dígitos → `+52` + dígitos; 13 dígitos que empiezan con `521` → `+52` + los últimos 10; 12 dígitos que empiezan con `52` → `+` + dígitos; cualquier otro caso → `+` + dígitos. Un teléfono sin dígitos MUST producir cadena vacía.

#### Scenario: Formato con 1 móvil
- **WHEN** el teléfono es `+52 1 55 1234 5678`
- **THEN** se busca como `+525512345678`

#### Scenario: Teléfono de 10 dígitos
- **WHEN** el teléfono es `5512345678`
- **THEN** se busca como `+525512345678`

### Requirement: Inserción de la interacción
Después de cada intento de envío (`sent`, `no_whatsapp` o `error`), el CLI SHALL hacer `POST {base}/interactions` con cuerpo `{interactions: [ {...} ]}` con una interacción. Si la respuesta es 404 y algún teléfono del payload empieza con `+52`, MUST reintentar sin ese prefijo. El resultado SHALL registrarse en consola y un fallo MUST NOT interrumpir el ciclo; no hay más reintentos ni cola persistente.

#### Scenario: Falla de red al insertar
- **WHEN** la llamada a `/interactions` lanza un error de red
- **THEN** el CLI imprime "Interacción NO enviada" con el error y continúa con el siguiente contacto

#### Scenario: Respuesta de error
- **WHEN** `/interactions` responde 400
- **THEN** el CLI imprime el estado y el cuerpo de la respuesta y continúa

> Nota: como `phone_number` nunca lleva `+52` en este flujo, el reintento por 404 no se activa.

### Requirement: Campos de la interacción automática
La interacción SHALL contener `credit_id`, `campaign_name`, `user_id` fijo, `subdictamen`, `contact_date` (`YYYY-MM-DD`), `contact_time` (`HH:MM` local), `range_time` (`HH:00 - HH+1:00` local), `action_channel` y `action` = `whatsapp`, `contactable`, `phone_number` (últimos 10 dígitos), `comments` = `product=<p>; discount=<d>; total_balance=<t>` e `inoutbound` = `outbound`. Los campos de email, plantilla, promesa y pago MUST enviarse en `null`.

#### Scenario: Campos nulos
- **WHEN** se inserta cualquier interacción automática
- **THEN** `email_address`, `template_used`, `promise_date`, `promise_amount`, `promise_payment_plan` y `payment_made_date` son `null`

#### Scenario: Envío exitoso
- **WHEN** el mensaje se envía con estado `sent` a `5215512345678` a las 10:15
- **THEN** la interacción lleva `phone_number: "5512345678"`, `contact_time: "10:15"` y `range_time: "10:00 - 11:00"`

> Nota: el `user_id` es un UUID fijo embebido en `index.js:350`, no el agente que inició sesión. `contact_date` se calcula en UTC mientras `contact_time` y `range_time` usan hora local, por lo que pueden discrepar cerca de medianoche (`index.js:492`).

### Requirement: Subdictamen y contactabilidad
El CLI SHALL fijar `subdictamen` en "No tiene Whatsapp" cuando el estado es `no_whatsapp` y en "Se envía WhatsApp" en cualquier otro caso, y MUST fijar `contactable` en `true` solo cuando el estado es `sent`.

#### Scenario: Envío exitoso
- **WHEN** el estado es `sent`
- **THEN** `subdictamen` es "Se envía WhatsApp" y `contactable` es `true`

#### Scenario: Número sin WhatsApp
- **WHEN** el estado es `no_whatsapp`
- **THEN** `subdictamen` es "No tiene Whatsapp" y `contactable` es `false`

#### Scenario: Error de UI
- **WHEN** el estado es `error`
- **THEN** `subdictamen` es "Se envía WhatsApp" y `contactable` es `false`

### Requirement: Marcado de teléfono sin WhatsApp
Cuando el estado es `no_whatsapp` y se conocen un `credit_id` no vacío y el teléfono de 10 dígitos, el CLI SHALL hacer `PATCH https://7uj0qjoby9.execute-api.us-east-2.amazonaws.com/phone` con `{credit_id, campaign_name, current_phone: <10 dígitos>, phone: {has_whatsapp: false, whatsapp_contactable: false}}`. Un error en esta llamada MUST registrarse sin interrumpir el ciclo.

#### Scenario: Teléfono sin WhatsApp con crédito conocido
- **WHEN** el envío a un contacto con `credit_id` conocido termina en `no_whatsapp`
- **THEN** el CLI envía el PATCH y registra "Teléfono actualizado sin WhatsApp" si la respuesta es exitosa

#### Scenario: Sin credit_id
- **WHEN** el estado es `no_whatsapp` pero no se encontró `credit_id`
- **THEN** no se envía el PATCH
