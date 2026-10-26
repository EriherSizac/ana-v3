# desktop-chats Specification

## Purpose
Describe la pestaña "Chats" de la app de escritorio v4: panel de conexión de WhatsApp, lista de conversaciones con números enmascarados, hilo de mensajes con media respaldada en S3, actualización en vivo por mensajes entrantes, respuesta manual con texto o archivo, indicador "escribiendo…" en vivo, registro de apertura de chat y modal "Registrar gestión" hacia el CRM. La vista de conversaciones de otros agentes y la reasignación se describen en `v4/team-viewer`; las rutas `/conversations*`, `/media/url` e `/interactions/*` pertenecen al backend.

> Nota: los textos de contactos y mensajes se renderizan como texto escapado por React (sin HTML crudo). La lista no se refresca sola: solo se actualiza al recibir un mensaje entrante o al responder; los envíos de campaña no aparecen hasta otra recarga.

## Requirements

### Requirement: Panel de conexión de WhatsApp
Cuando el operador ve sus propias conversaciones y WhatsApp no está conectado, la lista SHALL mostrar el QR si existe o el botón "Conectar WhatsApp", el mensaje de progreso, el enlace "Limpiar sesión y reconectar" y el último error o aviso de conflicto. El encabezado MUST mostrar un indicador con "Conectado", "Escanea QR", "Autenticando…" o "Desconectado".

#### Scenario: Conectado
- **WHEN** WhatsApp está conectado
- **THEN** el panel de conexión desaparece y el indicador dice "Conectado"

#### Scenario: Conectando sin señal aún
- **WHEN** el operador pulsa "Conectar WhatsApp" y aún no hay progreso
- **THEN** el botón muestra "Iniciando… Ns" y debajo "Puede tardar unos segundos…"

### Requirement: Lista de conversaciones
La lista SHALL cargarse de `GET /conversations` y mostrar por conversación solo el teléfono enmascarado como `***` más los últimos 4 dígitos (o `***` si tiene menos de 4) y una línea con el último mensaje. Mientras carga MUST mostrar 6 esqueletos; si la carga falla, una lista vacía. La conversación activa se resalta.

#### Scenario: Enmascarado
- **WHEN** la conversación es `5215512341922@c.us`
- **THEN** la lista muestra "***1922"

#### Scenario: Falla la carga
- **WHEN** `GET /conversations` responde error
- **THEN** la lista queda vacía sin mensaje de error

### Requirement: Hilo de mensajes
Al abrir una conversación el hilo SHALL cargarse de `GET /conversations/{chatId}/messages` con burbujas propias a la derecha y ajenas a la izquierda, respetando saltos de línea. Sin conversación activa MUST mostrarse "Selecciona una conversación". Un mensaje con llave de media SHALL pedir una URL temporal a `GET /media/url`: imagen en miniatura ampliable con clic, otro tipo como enlace "Descargar archivo", y "media no disponible" si falla.

#### Scenario: Imagen recibida
- **WHEN** el hilo contiene una imagen respaldada
- **THEN** se muestra la miniatura y al hacer clic se abre a pantalla completa

### Requirement: Actualización en vivo
Al recibir un mensaje entrante la lista SHALL recargarse sin vaciarse (sin esqueletos). Si el mensaje pertenece a la conversación abierta en la sesión propia, MUST agregarse al hilo sin duplicar ids.

#### Scenario: Respuesta del contacto con el chat abierto
- **WHEN** el contacto responde mientras el agente tiene su chat abierto
- **THEN** el mensaje aparece al final del hilo sin recargar la vista

### Requirement: Respuesta manual
En su propia sesión el agente SHALL responder con texto (Enter o "Enviar"; se ignora texto vacío) o con un archivo adjunto (📎), usando el texto escrito como pie. El envío manual MUST salir sin demora artificial, persistirse en `PUT /messages` (archivo también respaldado en S3) y agregarse al hilo si fue exitoso.

#### Scenario: Envío de texto
- **WHEN** el agente escribe "Hola" y presiona Enter
- **THEN** el mensaje se envía, aparece en el hilo y el campo se vacía

#### Scenario: Falla el envío
- **WHEN** WhatsApp no está conectado y el agente envía
- **THEN** el campo se vacía y el mensaje no aparece en el hilo, sin aviso de error

> Nota: el texto se borra antes de conocer el resultado, por lo que una respuesta fallida se pierde sin aviso; lo mismo ocurre con archivos.

### Requirement: Indicador escribiendo en vivo
Mientras el agente escribe, la app SHALL enviar el estado "escribiendo…" al chat como máximo cada 1.5 segundos y MUST limpiarlo tras 4 segundos sin teclear, al perder el foco del campo o al enviar.

#### Scenario: Pausa al escribir
- **WHEN** el agente deja de teclear 4 segundos
- **THEN** el contacto deja de ver "escribiendo…"

### Requirement: Registro de apertura de chat
Al abrir una conversación en su propia sesión, la app SHALL notificar `POST /interactions/open` con el chatId, sin bloquear la UI e ignorando errores. La deduplicación por chat y día MUST quedar a cargo del backend; la app notifica en cada apertura.

#### Scenario: Reapertura del mismo chat
- **WHEN** el agente abre el mismo chat tres veces en el día
- **THEN** la app envía tres notificaciones y el backend decide cuántas registrar

#### Scenario: Viendo a otro agente
- **WHEN** un admin abre un chat de otro agente
- **THEN** no se notifica apertura

### Requirement: Registrar gestión
En su propia sesión, "Registrar gestión" SHALL abrir un modal con Resultado buscable ("Promesa de pago" por defecto, "Negociación", "No contactado", "Número equivocado", "Se niega a pagar", "Ya pagó", "Otro"), "Se logró contacto" (activo por defecto) y Comentarios. Con "Promesa de pago" MUST mostrar fecha y monto. "Registrar" envía `POST /interactions/manual`; se cierra al éxito o muestra el error.

#### Scenario: Promesa registrada
- **WHEN** el agente elige "Promesa de pago", fecha 2026-11-05 y monto 1500
- **THEN** se envía la fecha como "2026-11-05" (sin hora ni zona) y el monto como número

#### Scenario: Error del backend
- **WHEN** el backend rechaza la gestión
- **THEN** el modal muestra el error devuelto o "no se pudo registrar la gestión"

> Nota: si el agente captura fecha o monto y luego cambia el resultado, esos valores ocultos se envían igual. Cambiar de conversación cierra el modal; clic fuera también.
