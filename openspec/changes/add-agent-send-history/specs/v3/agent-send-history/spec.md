# Spec Delta

## Purpose

Registrar en el backend v3 el resultado de cada contacto que envía el CLI y mostrarlo en ANA Admin como historial de envíos del agente y de la campaña.

## ADDED Requirements

### Requirement: Llave de la asignación entregada
`GET /get/chats/{agentId}/{campaignId}` SHALL responder, además del CSV, la cabecera `X-Ana-Assignment-Key` con la llave S3 del archivo entregado. El cuerpo y el resto del comportamiento MUST NOT cambiar.

#### Scenario: Entrega con cabecera
- **WHEN** el CLI recibe `agents/prueba/erick-contacts-2026-10-29T10-00-00-000Z.csv`
- **THEN** la respuesta 200 trae `X-Ana-Assignment-Key: agents/prueba/erick-contacts-2026-10-29T10-00-00-000Z.csv` y el mismo CSV de siempre

### Requirement: Reporte de resultados desde el CLI
Tras cada intento de envío automático, el CLI SHALL encolar un resultado `{id, assignmentId, sourceKey, uploadId, rowIndex, credit, phone, status, errorCode, error, sentAt, messageHash, messagePreview}` con `status` `sent`, `no_whatsapp`, `error` o `por_revisar` e `id = assignmentId#rowIndex#attempt`. Un contacto interrumpido que pasa a `por_revisar` MUST reportarse igual. Encolar MUST NOT esperar a la red ni detener el envío si falla.

#### Scenario: Envío exitoso
- **WHEN** el CLI envía la fila 3 de la asignación `20261029T1000-ab12cd34`
- **THEN** encola `id` `20261029T1000-ab12cd34#3#1` con `status: sent`, teléfono `52` + 10 dígitos y los primeros 160 caracteres del mensaje
- **AND** continúa con la interacción del CRM sin esperar la respuesta del backend

#### Scenario: Contacto interrumpido
- **WHEN** al reanudar el registro local una fila estaba `in_flight`
- **THEN** el CLI encola su resultado con `status: por_revisar` y la misma llave

### Requirement: Bandeja de salida persistente
El CLI SHALL guardar los resultados pendientes en `results-outbox-<agent>.json` del directorio de datos con escritura atómica, enviarlos a `POST /agent/results` en lotes de hasta 100 por campaña y, ante error de red, 401, 403 o 5xx, reintentar con espera creciente (30 s a 10 min). MUST deduplicar por `id`, conservar lo pendiente tras reiniciar y descartar un lote respondido con 400.

#### Scenario: Backend caído
- **WHEN** `POST /agent/results` responde 503 dos veces y luego 200
- **THEN** los resultados permanecen en la bandeja, se reintentan y se quitan al recibir 200

#### Scenario: Reinicio con pendientes
- **WHEN** el CLI se cierra con 5 resultados sin enviar y se vuelve a abrir
- **THEN** al iniciar sesión envía esos 5 resultados una sola vez

### Requirement: Registro de resultados en el backend
El sistema SHALL exponer `POST /agent/results` con `cognitoAgentJwt`, token estricto de agente y roster de `campaign`. El agente MUST tomarse del token. Body `{campaign, items[1..100]}`; items inválidos se rechazan uno a uno (`rejected`). Los válidos se escriben por día MX de `sentAt` en `results/{campaign}/{agent}/{YYYY-MM-DD}/{hash}.json` sin sobrescribir; responde `{accepted, rejected}`.

#### Scenario: Lote válido
- **WHEN** el agente `erick` envía 2 items válidos de la campaña `prueba` con `sentAt` del 29/10/2026 MX
- **THEN** se escribe un objeto bajo `results/prueba/erick/2026-10-29/` y la respuesta es 200 con `accepted: 2`

#### Scenario: Reintento del mismo lote
- **WHEN** el CLI reenvía exactamente el mismo lote
- **THEN** responde 200 sin crear otro objeto

#### Scenario: Lote demasiado grande o sin roster
- **WHEN** el body trae 101 items, o el agente no está en el roster de la campaña
- **THEN** responde 400, o 403, sin escribir en S3

### Requirement: Consulta del historial de envíos
`GET /agent/results/{campaign}` (propio) y `GET /admin/campaigns/{campaign}/results` (permisos de Contactos y campaña en alcance, filtro `agent`) SHALL devolver filas deduplicadas por `id` (primero gana) con teléfono enmascarado, filtros `from`/`to` (máx. 31 días), `status`, `publicationId`, `q`, orden, cursor y agregados por publicación: publicados, enviados, sin WhatsApp, error, por revisar y pendientes.

#### Scenario: Agente consulta su semana
- **WHEN** el agente consulta `prueba` con `status=no_whatsapp`
- **THEN** recibe solo sus filas `no_whatsapp`, con `phone` como `**1234`, y los agregados de sus publicaciones del rango

#### Scenario: Pendientes de una publicación
- **WHEN** una publicación del rango tiene 10 contactos y hay 7 resultados distintos
- **THEN** su agregado muestra `published: 10` y `pending: 3`

#### Scenario: Líder fuera de alcance
- **WHEN** un líder sin la campaña en su alcance consulta `/admin/campaigns/otra/results`
- **THEN** responde 403 sin leer S3

### Requirement: Retención y aviso en vivo de resultados
Los objetos bajo `results/` SHALL expirar a los 180 días mediante una regla de ciclo de vida de `StorageBucket`. La regla del puente realtime MUST incluir el prefijo `results/` y v4 MUST traducir la creación de un lote (no `_compact.json`) a `results.changed` dirigido al agente.

#### Scenario: Lote nuevo
- **WHEN** se crea `results/prueba/erick/2026-10-29/abc.json`
- **THEN** las conexiones de `erick` reciben `results.changed` con `campaign: prueba`

### Requirement: Vista Historial de envíos
ANA Admin SHALL ofrecer "Historial de envíos": para el agente en `/mi-asignacion/historial` (enlazada desde Mi asignación) y para líderes y supervisores en `/historial-envios` con filtro de agente. MUST mostrar tarjetas por publicación con barra de avance y conteos, y una tabla por contacto (teléfono enmascarado, crédito, estado, fecha MX, mensaje) con filtros, orden y exportación CSV de lo filtrado.

#### Scenario: Exportar lo filtrado
- **WHEN** el agente filtra por `error` y pulsa "Exportar CSV"
- **THEN** descarga un CSV con solo las filas `error` del rango, con teléfonos enmascarados

#### Scenario: Recarga en vivo
- **WHEN** llega `results.changed` de la campaña elegida
- **THEN** la vista del agente vuelve a cargar el historial
