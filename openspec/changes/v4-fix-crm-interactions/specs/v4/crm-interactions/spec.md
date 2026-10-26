# Spec Delta

## MODIFIED Requirements

### Requirement: Idempotencia del reporte por job
Antes de llamar al CRM, el sistema MUST reservar condicionalmente el marcador `{operatorId: "REPORT#<usuario>", jobId}` (TTL 7 días) como `pending`. Si ya existe como `done` SHALL responder 200 `{"reported":false,"reason":"ya reportado"}`, y si está `pending` desde hace menos de 2 minutos, `{"reported":false,"reason":"en curso"}`, sin llamar al CRM. Tras insertar MUST marcarlo `done`; si la inserción falla MUST liberarlo y responder `{"reported":false,"retryable":true}`.

#### Scenario: Reintento del desktop
- **WHEN** el desktop reporta dos veces el mismo `jobId` y la primera inserción fue exitosa
- **THEN** solo la primera llamada inserta la interacción

#### Scenario: CRM caído y reintento
- **WHEN** la primera llamada recibe un error del CRM y el desktop reintenta minutos después
- **THEN** la primera responde `retryable: true` y el reintento inserta la interacción una sola vez

#### Scenario: Reserva abandonada
- **WHEN** una invocación reservó el marcador y terminó por timeout sin liberarlo
- **THEN** un reporte del mismo `jobId` 2 minutos después puede volver a reservarlo e insertar

### Requirement: Registro al abrir un chat
`POST /interactions/open` con `{chatId}` SHALL requerir `chatId` (400 `{"error":"falta chatId"}`), leer `campaign` y `contact` de la conversación del operador (sin campaña: 200 `{"reported":false,"reason":"conversación sin campaña"}`) y registrar una vez por chat y día de Ciudad de México (marcador `OPEN#<usuario>` / `<chatId>#<YYYY-MM-DD>`, TTL 2 días, con las mismas reglas de reserva y liberación que el reporte por job) una interacción inbound "Atención WhatsApp" contactable.

#### Scenario: Segunda apertura el mismo día
- **WHEN** el agente abre el mismo chat dos veces en el día
- **THEN** la segunda llamada responde `{"reported":false,"reason":"ya registrado hoy"}`

#### Scenario: Teléfono desde el chatId
- **WHEN** el contacto guardado no trae `phone` ni `telefono`
- **THEN** se usan los dígitos del `chatId` (p. ej. `5215513023544@c.us`) para el teléfono y la búsqueda de crédito

#### Scenario: Apertura por la noche
- **WHEN** el agente abre un chat a las 17:00 y otra vez a las 19:00 del mismo día en Ciudad de México
- **THEN** la segunda apertura responde "ya registrado hoy"

#### Scenario: CRM falla en la apertura
- **WHEN** la inserción de la apertura falla y el agente vuelve a abrir el chat ese día
- **THEN** la segunda apertura registra la interacción

## ADDED Requirements

### Requirement: Fecha y hora de Ciudad de México
Toda interacción que el backend envía al CRM MUST llevar `contact_date` (`YYYY-MM-DD`), `contact_time` (`HH:MM`) y `range_time` (`HH:00 - HH+1:00`, con `23:00 - 00:00` en la última hora) calculados en la zona `America/Mexico_City` a partir del instante del evento, sin depender de la zona horaria configurada en la Lambda.

#### Scenario: Envío por la tarde-noche
- **WHEN** se reporta un envío el 2026-11-05 a las 19:30 hora de Ciudad de México (01:30 UTC del 6)
- **THEN** la interacción lleva `contact_date: "2026-11-05"`, `contact_time: "19:30"` y `range_time: "19:00 - 20:00"`

#### Scenario: Última hora del día
- **WHEN** se registra una gestión a las 23:45 hora de Ciudad de México
- **THEN** `range_time` es `"23:00 - 00:00"` y `contact_date` es ese mismo día

### Requirement: Idempotencia opcional de la gestión manual
`POST /interactions/manual` SHALL aceptar `requestId` opcional (UUID); con él, el sistema MUST aplicar el marcador `MANUAL#<usuario>` / `<requestId>` (TTL 2 días) con las reglas de reserva, confirmación y liberación del reporte por job, de modo que dos envíos con el mismo `requestId` registren una sola interacción. Sin `requestId` cada llamada registra una interacción nueva.

#### Scenario: Doble clic en Registrar
- **WHEN** el desktop envía dos veces la misma gestión con el mismo `requestId`
- **THEN** el CRM recibe una sola interacción y la segunda respuesta es `{"reported":false,"reason":"ya reportado"}`
