# Spec Delta

## ADDED Requirements

### Requirement: Renderizado de datos externos como texto
La ventana manual MUST mostrar como texto plano, nunca interpretado como HTML, todo valor que provenga del backend de ANA, de la API de interacciones/CRM o del DOM de WhatsApp en el Historial y en el modal "⬆️ Subir gestión": cuerpo y vista previa de mensajes, nombres de contacto o cliente, teléfonos, marcas de tiempo, tipo de mensaje, `credit_id`, producto, dictamen, subdictamen y mensajes de error.

#### Scenario: Mensaje del deudor con marcado HTML
- **WHEN** una conversación respaldada contiene el mensaje `<img src=x onerror=alert(1)>`
- **THEN** la burbuja del historial muestra literalmente el texto `<img src=x onerror=alert(1)>`
- **AND** no se crea ningún elemento `img` ni se ejecuta código en la página

#### Scenario: Vista previa con marcado HTML
- **WHEN** el listado de respaldos devuelve `last_message_preview` igual a `<b>hola</b><script>x()</script>`
- **THEN** la fila muestra ese texto literal y no aplica negritas ni ejecuta el script

#### Scenario: Nombre de contacto con comillas y etiquetas
- **WHEN** el nombre del contacto de un mensaje es `"><svg onload=x()>`
- **THEN** la etiqueta "📥 {contacto}" muestra el texto literal sin alterar la estructura de la burbuja

#### Scenario: Datos del CRM con marcado HTML
- **WHEN** `POST /client-info` devuelve `full_name` igual a `<i>Juan</i>` y el catálogo incluye un subdictamen `A"><b>B`
- **THEN** el modal de gestión muestra ambos valores como texto literal
- **AND** al enviar la gestión el `subdictamen` enviado es exactamente `A"><b>B`

#### Scenario: Error con marcado HTML
- **WHEN** la carga de datos de gestión falla con un mensaje de error que contiene etiquetas HTML
- **THEN** el modal muestra el mensaje como texto literal

### Requirement: Teléfono saneado al abrir chat desde el historial
Antes de navegar a `https://web.whatsapp.com/send?phone=52{10 dígitos}`, la ventana manual MUST reducir el teléfono a sus dígitos y usar los últimos 10; si no quedan 10 dígitos SHALL NOT navegar y MUST mostrar una notificación de error.

#### Scenario: Teléfono con caracteres no numéricos
- **WHEN** el respaldo trae `contact_phone` igual a `521551234567"8`
- **THEN** la ventana navega a `https://web.whatsapp.com/send?phone=525512345678`

#### Scenario: Teléfono inválido
- **WHEN** el respaldo trae `contact_phone` con menos de 10 dígitos
- **THEN** la ventana no navega y muestra una notificación de error

## MODIFIED Requirements

### Requirement: Lista de historial de chats respaldados
El botón "📜 Ver Historial" SHALL abrir el modal "Historial de Chats" que consulta `GET {API ANA}/backups/chats/{campaign}/{agent_id}` y lista cada conversación respaldada con los últimos 10 dígitos del teléfono, vista previa del último mensaje, fecha de última actualización (formato es-MX) y total de mensajes. El modal MUST permitir filtrar por dígitos del teléfono.

#### Scenario: Sin respaldos
- **WHEN** el backend no devuelve chats
- **THEN** el modal muestra "No hay conversaciones respaldadas"

#### Scenario: Filtrar por número
- **WHEN** el agente escribe `1234` en el filtro
- **THEN** solo se muestran las conversaciones cuyo teléfono contiene `1234` (se ignoran caracteres no numéricos del filtro)

#### Scenario: Vista previa mostrada como texto
- **WHEN** la vista previa del último mensaje contiene `<`, `>`, `&` o comillas
- **THEN** la fila muestra esos caracteres literalmente

### Requirement: Ver conversación respaldada
Desde la lista, el botón "📜 Ver" SHALL obtener la conversación con `GET {API ANA}/backups/chat/{campaign}/{agent_id}/{teléfono}` (teléfono en formato `521` + 10 dígitos) y mostrarla en una burbuja modal de solo lectura con cada mensaje marcado "📤 Yo" o "📥 {contacto}", su marca de tiempo, texto y tipo, desplazada al mensaje más reciente. La burbuja MUST cerrarse con "×", clic fuera o Escape.

#### Scenario: Conversación con mensajes
- **WHEN** el backend devuelve mensajes para el teléfono
- **THEN** la burbuja muestra "Historial de Mensajes" con el teléfono, la fecha de última actualización y el número de mensajes

#### Scenario: Conversación vacía o inexistente
- **WHEN** el backend responde sin éxito o sin mensajes
- **THEN** se muestra una notificación "No hay historial disponible" / "No hay mensajes respaldados para este número"

#### Scenario: Mensaje multilínea con marcado
- **WHEN** un mensaje respaldado contiene saltos de línea y texto como `<a href="x">pago</a>`
- **THEN** la burbuja conserva los saltos de línea y muestra el texto literal, sin crear un enlace

> Nota: si la configuración del respaldo no está cargada, la consulta usa una campaña y agente de desarrollo fijos en el código (`whatsapp-manual.js:2758`).
