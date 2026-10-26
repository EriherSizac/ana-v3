# Spec Delta

## MODIFIED Requirements

### Requirement: Campos de la interacción automática
La interacción SHALL contener `credit_id`, `campaign_name`, `user_id` fijo, `subdictamen`, `contact_date` (`YYYY-MM-DD`), `contact_time` (`HH:MM`) y `range_time` (`HH:00 - HH+1:00`) en hora de Ciudad de México, `action_channel` y `action` = `whatsapp`, `contactable`, `phone_number` (últimos 10 dígitos), `comments` = `product=<p>; discount=<d>; total_balance=<t>` e `inoutbound` = `outbound`. Los campos de email, plantilla, promesa y pago MUST enviarse en `null`.

#### Scenario: Campos nulos
- **WHEN** se inserta cualquier interacción automática
- **THEN** `email_address`, `template_used`, `promise_date`, `promise_amount`, `promise_payment_plan` y `payment_made_date` son `null`

#### Scenario: Envío exitoso
- **WHEN** el mensaje se envía con estado `sent` a `5215512345678` a las 10:15 hora de Ciudad de México
- **THEN** la interacción lleva `phone_number: "5512345678"`, `contact_time: "10:15"` y `range_time: "10:00 - 11:00"`

#### Scenario: Envío por la noche
- **WHEN** el mensaje se envía el 2026-10-26 a las 19:40 hora de Ciudad de México (2026-10-27T01:40Z)
- **THEN** la interacción lleva `contact_date: "2026-10-26"`, `contact_time: "19:40"` y `range_time: "19:00 - 20:00"`

> Nota: el `user_id` es un UUID fijo embebido en `index.js:350`, no el agente que inició sesión.

## ADDED Requirements

### Requirement: Fecha y hora de las interacciones del CLI
Toda interacción que el CLI registra en el CRM (envío automático, Gestión, monitor de no leídos y modal de números sin WhatsApp) SHALL calcular `contact_date`, `contact_time` y `range_time` a partir del mismo instante y en la zona `America/Mexico_City`, sin depender de la zona horaria configurada en el equipo. Las horas MUST usar formato de 24 horas de `00` a `23`.

#### Scenario: Equipo configurado en otra zona
- **WHEN** el equipo del agente está configurado en UTC y se registra una interacción en el instante 2026-10-27T01:40Z
- **THEN** la interacción lleva `contact_date: "2026-10-26"`, `contact_time: "19:40"` y `range_time: "19:00 - 20:00"`

#### Scenario: Último minuto del día
- **WHEN** se registra una interacción a las 23:59 hora de Ciudad de México
- **THEN** `contact_date` es la fecha de ese día y `range_time` es `"23:00 - 00:00"`

#### Scenario: Medianoche
- **WHEN** se registra una interacción a las 00:05 hora de Ciudad de México
- **THEN** `contact_time` es `"00:05"` y `range_time` es `"00:00 - 01:00"`

#### Scenario: Fecha y hora coherentes
- **WHEN** se registra cualquier interacción
- **THEN** `contact_date` y `contact_time` corresponden al mismo instante y a la misma zona
