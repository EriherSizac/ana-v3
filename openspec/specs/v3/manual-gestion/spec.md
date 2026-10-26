# manual-gestion Specification

## Purpose
Flujo "Subir gestión" y consulta de "Historial" desde la ventana manual: el agente registra en el CRM de Pernexium una interacción (dictamen/subdictamen) para el chat abierto, usando el catálogo de códigos de resultado de la campaña y la búsqueda de cliente por teléfono, y puede consultar las conversaciones respaldadas.

## Requirements

### Requirement: Detección del teléfono del chat abierto
La ventana manual SHALL obtener el teléfono del chat abierto a partir del encabezado del chat, de los identificadores de mensajes del chat o del chat seleccionado en la lista lateral, ignorando grupos. Un candidato MUST tener al menos 10 dígitos y contener `+` o empezar con `52` para considerarse teléfono.

#### Scenario: Chat con número visible
- **WHEN** el encabezado del chat muestra `+52 1 55 1234 5678`
- **THEN** se detecta el teléfono `5215512345678`

#### Scenario: Chat no detectable
- **WHEN** no hay chat abierto, o el contacto está guardado con nombre y no se encuentra un número con `+`/`52`
- **THEN** se muestra la notificación "⚠️ No pude detectar el chat. Abre un chat y vuelve a intentar." durante 3 segundos y no se abre el modal

### Requirement: Normalización de teléfono para el CRM
Para consultar cliente y registrar la gestión, el teléfono MUST normalizarse a formato `+52` + 10 dígitos: un prefijo `521` con 13 o más dígitos se convierte a `52` + resto; un número de 10 dígitos recibe el prefijo `52`; números que no empiezan con `52` o con menos de 12 dígitos SHALL producir un valor vacío.

#### Scenario: Número móvil con 521
- **WHEN** el teléfono detectado es `5215512345678`
- **THEN** el valor normalizado es `+525512345678`

#### Scenario: Número de 10 dígitos
- **WHEN** el teléfono detectado es `5512345678`
- **THEN** el valor normalizado es `+525512345678`

#### Scenario: Número extranjero
- **WHEN** el teléfono detectado es `14155550100`
- **THEN** el valor normalizado es vacío

### Requirement: Nombre de campaña para el CRM
El nombre de campaña enviado al CRM SHALL derivarse de la campaña configurada del agente eliminando todo lo anterior al primer guion (`-`), inclusive; si no hay guion se usa tal cual.

#### Scenario: Campaña con prefijo
- **WHEN** la campaña configurada es `px-monte_auto`
- **THEN** el nombre de campaña usado en el CRM es `monte_auto`

### Requirement: Carga de catálogo y cliente
Al abrir el modal "⬆️ Subir gestión", la ventana SHALL consultar en paralelo a la API de interacciones el catálogo `GET /result-codes/{campaña}` y la búsqueda de cliente `POST /client-info` con cuerpo `{ campaign_name, search_type: "Telefono", search_value: <+52...> }`. Ante un 404 con valor `+52...`, la búsqueda MUST reintentarse una vez sin ese prefijo. El catálogo SHALL cachearse en memoria por campaña durante la vida del proceso.

#### Scenario: Cliente encontrado
- **WHEN** el agente abre el modal en un chat cuyo teléfono existe en el CRM
- **THEN** el subtítulo muestra "Campaña: {campaña} | Tel: {+52...}"
- **AND** se listan los créditos del cliente como opciones (nombre completo, `credit_id` y producto), con el primero preseleccionado

#### Scenario: Cliente no encontrado
- **WHEN** la búsqueda devuelve una lista vacía o un error
- **THEN** el modal muestra "No se encontró información de cliente para este teléfono." y no ofrece formulario de envío

#### Scenario: Reintento sin prefijo
- **WHEN** `POST /client-info` con `+525512345678` responde 404
- **THEN** se reintenta con `5512345678` y, si responde OK, se usan esos resultados

> Nota: la versión de búsqueda de cliente del flujo manual no envía la cabecera `X-Api-Key`, a diferencia de la del monitor y la automatización (`whatsapp-manual.js:2225`); `GET /result-codes` tampoco la envía. Un catálogo vacío devuelto con respuesta JSON también queda cacheado hasta reiniciar el CLI.

### Requirement: Formulario de gestión
El modal SHALL presentar: selección de crédito (radio), selector de subdictamen con solo los códigos marcados `is_visible`, mostrados como "DICTAMEN - subdictamen", campo libre "Comentarios" y selector "Contactable" (Sí/No, por defecto Sí). El modal MUST poder cerrarse con "×", "Cancelar" o haciendo clic fuera.

#### Scenario: Catálogo con códigos ocultos
- **WHEN** el catálogo incluye códigos con `is_visible` falso
- **THEN** esos códigos no aparecen en el selector de subdictamen

#### Scenario: Datos de promesa de pago
- **WHEN** el agente quiere registrar una promesa de pago
- **THEN** el formulario no ofrece campos de fecha, monto ni plan de promesa, ni fecha de pago

### Requirement: Envío de la gestión
Al pulsar "Subir", la ventana SHALL enviar `POST /interactions` a la API de interacciones con `{ interactions: [ interacción ] }` y cabecera `X-Api-Key`. Si la respuesta es 404 y algún teléfono empieza con `+52`, MUST reintentarse una vez quitando ese prefijo.

#### Scenario: Contenido de la interacción
- **WHEN** el agente envía la gestión
- **THEN** la interacción incluye `credit_id` seleccionado, `campaign_name`, `user_id` de servicio fijo, `subdictamen`, `contactable`, `comments` y `phone_number` en formato `+52...`
- **AND** incluye `contact_date` (`YYYY-MM-DD`), `contact_time` (`HH:MM` local), `range_time` (`HH:00 - HH+1:00`), `action_channel` y `action` `whatsapp`, `inoutbound: "inbound"`
- **AND** `email_address`, `template_used`, `promise_date`, `promise_amount`, `promise_payment_plan` y `payment_made_date` van en `null`

#### Scenario: Envío exitoso
- **WHEN** el CRM responde con estado 2xx
- **THEN** se muestra "✅ Gestión subida" y el modal se cierra a los 800 ms

#### Scenario: Envío fallido
- **WHEN** el CRM responde con error o hay fallo de red
- **THEN** se muestra "❌ No se pudo subir gestión" y en el modal "❌ Error: {status} {error}"
- **AND** el modal permanece abierto para reintentar

> Nota: `contact_date` se calcula en UTC mientras `contact_time` usa la hora local; entre las 18:00 y 23:59 hora de México la fecha registrada corresponde al día siguiente (`whatsapp-manual.js:2287`). El `user_id` es un identificador de servicio fijo en el código, no el agente que hizo la gestión.

### Requirement: Lista de historial de chats respaldados
El botón "📜 Ver Historial" SHALL abrir el modal "Historial de Chats" que consulta `GET {API ANA}/backups/chats/{campaign}/{agent_id}` y lista cada conversación respaldada con los últimos 10 dígitos del teléfono, vista previa del último mensaje, fecha de última actualización (formato es-MX) y total de mensajes. El modal MUST permitir filtrar por dígitos del teléfono.

#### Scenario: Sin respaldos
- **WHEN** el backend no devuelve chats
- **THEN** el modal muestra "No hay conversaciones respaldadas"

#### Scenario: Filtrar por número
- **WHEN** el agente escribe `1234` en el filtro
- **THEN** solo se muestran las conversaciones cuyo teléfono contiene `1234` (se ignoran caracteres no numéricos del filtro)

### Requirement: Ver conversación respaldada
Desde la lista, el botón "📜 Ver" SHALL obtener la conversación con `GET {API ANA}/backups/chat/{campaign}/{agent_id}/{teléfono}` (teléfono en formato `521` + 10 dígitos) y mostrarla en una burbuja modal de solo lectura con cada mensaje marcado "📤 Yo" o "📥 {contacto}", su marca de tiempo, texto y tipo, desplazada al mensaje más reciente. La burbuja MUST cerrarse con "×", clic fuera o Escape.

#### Scenario: Conversación con mensajes
- **WHEN** el backend devuelve mensajes para el teléfono
- **THEN** la burbuja muestra "Historial de Mensajes" con el teléfono, la fecha de última actualización y el número de mensajes

#### Scenario: Conversación vacía o inexistente
- **WHEN** el backend responde sin éxito o sin mensajes
- **THEN** se muestra una notificación "No hay historial disponible" / "No hay mensajes respaldados para este número"

> Nota: el texto de los mensajes y la vista previa se insertan como HTML sin escapar (`whatsapp-manual.js:3246`, `whatsapp-manual.js:2896`), por lo que un mensaje del deudor con marcado HTML se renderiza dentro de la ventana manual. Si la configuración del respaldo no está cargada, la consulta usa una campaña y agente de desarrollo fijos en el código (`whatsapp-manual.js:2758`).

### Requirement: Abrir chat desde el historial
Los botones "💬 Abrir" (lista) y "💬 Abrir chat" (burbuja) SHALL navegar la ventana manual a `https://web.whatsapp.com/send?phone=52{10 dígitos}`, cerrando el modal.

#### Scenario: Abrir chat de una conversación respaldada
- **WHEN** el agente pulsa "💬 Abrir" en una fila con teléfono `5512345678`
- **THEN** la ventana navega a `https://web.whatsapp.com/send?phone=525512345678` y WhatsApp abre ese chat tras recargar
