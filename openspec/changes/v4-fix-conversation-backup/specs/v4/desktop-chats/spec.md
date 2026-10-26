# Spec Delta

## MODIFIED Requirements

### Requirement: Lista de conversaciones
La lista SHALL cargarse de `GET /conversations` y mostrar por conversación el teléfono enmascarado como `***` más los últimos 4 dígitos (o `***` si tiene menos de 4), una línea con el último mensaje y el número de no leídos si es mayor a 0, con "Cargar más" mientras haya `nextToken`. Mientras carga MUST mostrar 6 esqueletos; si la carga falla, "No se pudieron cargar las conversaciones" con "Reintentar". La conversación activa se resalta.

#### Scenario: Enmascarado
- **WHEN** la conversación es `5215512341922@c.us`
- **THEN** la lista muestra "***1922"

#### Scenario: Falla la carga
- **WHEN** `GET /conversations` responde error
- **THEN** la lista muestra "No se pudieron cargar las conversaciones" y el botón "Reintentar"

#### Scenario: Más de una página
- **WHEN** el agente tiene más conversaciones que la primera página
- **THEN** al pulsar "Cargar más" se agregan las siguientes al final sin repetir

### Requirement: Actualización en vivo
Al recibir un mensaje entrante o al terminar con éxito un envío de campaña, la lista SHALL recargarse sin vaciarse (sin esqueletos). Si el mensaje pertenece a la conversación abierta en la sesión propia, MUST agregarse al hilo sin duplicar ids.

#### Scenario: Respuesta del contacto con el chat abierto
- **WHEN** el contacto responde mientras el agente tiene su chat abierto
- **THEN** el mensaje aparece al final del hilo sin recargar la vista

#### Scenario: Envío de campaña
- **WHEN** termina con éxito el envío de un job de campaña
- **THEN** la conversación de ese contacto aparece o sube en la lista sin recargar la vista

## ADDED Requirements

### Requirement: Mensajes anteriores
Si el historial de una conversación trae `nextToken`, el hilo SHALL mostrar arriba "Ver mensajes anteriores"; al pulsarlo MUST anteponer la página anterior conservando la posición de lectura.

#### Scenario: Chat largo
- **WHEN** el agente abre un chat de 700 mensajes y pulsa "Ver mensajes anteriores"
- **THEN** se agregan arriba los 200 mensajes previos sin mover la vista al final

### Requirement: Marcar como leída al abrir
Al abrir una conversación en su propia sesión, la app SHALL llamar `POST /conversations/{chatId}/read` sin bloquear la UI e ignorando errores, y quitar el conteo de no leídos de esa conversación en la lista. Viendo a otro agente MUST NOT llamarla.

#### Scenario: Abrir chat con no leídos
- **WHEN** el agente abre una conversación con 3 no leídos
- **THEN** el conteo desaparece de la lista y el respaldo queda con `unreadCount: 0`
