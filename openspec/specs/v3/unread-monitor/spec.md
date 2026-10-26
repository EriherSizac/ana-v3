# unread-monitor Specification

## Purpose
Ventana monitor de WhatsApp Web (Chromium visible, sesión propia) que mantiene activo el filtro "No leídos", detecta respuestas entrantes de deudores y registra automáticamente una interacción "CLIENTE NO DEFINE" en el CRM por cada teléfono con crédito encontrado. La ventana queda bloqueada para que el agente no la manipule.

## Requirements

### Requirement: Arranque de la ventana monitor
El CLI SHALL abrir la ventana monitor después de inicializar la ventana de automatización cuando la bandera `enableMonitorWindow` está activa (valor por defecto `true`). La ventana MUST usar un perfil persistente propio `whatsapp-session-monitor` en el directorio de datos del CLI, en modo visible, modo app sobre `https://web.whatsapp.com`, viewport 1280x720 y DevTools deshabilitado, y SHALL esperar hasta 300 segundos a que aparezca la lista de chats.

#### Scenario: Sin sesión vinculada
- **WHEN** el perfil monitor no tiene sesión de WhatsApp
- **THEN** se muestra el QR y la consola pide escanearlo con otro teléfono/cuenta

#### Scenario: Sesión existente
- **WHEN** al cargar ya aparece la lista de chats
- **THEN** la ventana se bloquea de inmediato (salvo modo sin bloqueo) y continúa con la activación del filtro

### Requirement: Opciones de línea de comandos del monitor
La ventana monitor SHALL aceptar los argumentos `--monitor-no-lock` (no bloquear la ventana), `--monitor-clear-data` (borrar caché, cookies, localStorage, sessionStorage, Cache Storage e IndexedDB antes de cargar), `--monitor-alt-profile` (usar el perfil `whatsapp-session-monitor-alt`) y `--monitor-non-persistent` (contexto temporal sin perfil persistente). El CLI MUST además aceptar `--reset-monitor-session` y `--reset-monitor-alt-session` para borrar el perfil correspondiente al iniciar.

#### Scenario: Perfil alternativo
- **WHEN** el CLI se ejecuta con `--monitor-alt-profile`
- **THEN** la ventana monitor usa la sesión guardada en `whatsapp-session-monitor-alt`

#### Scenario: Modo sin bloqueo
- **WHEN** el CLI se ejecuta con `--monitor-no-lock`
- **THEN** la ventana monitor no muestra el overlay de bloqueo y el agente puede interactuar con ella

### Requirement: Bloqueo de la ventana monitor
Salvo con `--monitor-no-lock`, la ventana monitor SHALL cubrirse con un overlay a pantalla completa (fondo negro al 20 %, cursor "no permitido") que intercepta clics y menú contextual. El overlay MUST activarse tras intentar activar el filtro "No leídos", reaparecer si se elimina (cada 1.2 segundos) y reaplicarse en cada recarga. F12, Ctrl+Shift+I/J/C, Cmd+Alt+I/J/C y el menú contextual SHALL bloquearse desde antes de cargar WhatsApp.

#### Scenario: Agente intenta hacer clic en la ventana monitor
- **WHEN** el agente hace clic en cualquier parte de la ventana bloqueada
- **THEN** el clic no llega a WhatsApp Web

#### Scenario: Recarga de la página
- **WHEN** WhatsApp Web recarga la página del monitor
- **THEN** los ayudantes se reinstalan y el overlay de bloqueo vuelve a aplicarse

### Requirement: Filtro "No leídos" siempre activo
La ventana monitor SHALL activar el filtro de chats "No leídos" de WhatsApp Web al conectar (esperando hasta 60 segundos a que exista la barra de filtros, con un límite total de 25 segundos para el intento) y MUST reactivarlo si se desactiva, comprobando cada 5 segundos, ante cambios del DOM y antes de cada ciclo de detección.

#### Scenario: El filtro se desactiva
- **WHEN** el botón de filtro "No leídos" deja de estar presionado
- **THEN** la ventana lo vuelve a presionar en el siguiente chequeo

#### Scenario: El filtro no aparece a tiempo
- **WHEN** la barra de filtros no aparece en 25 segundos
- **THEN** se registra una advertencia en consola y el monitor continúa (bloqueo y bucle se inician igualmente)

### Requirement: Ciclo de detección de chats no leídos
Cada 5 segundos, sin ciclos concurrentes, el monitor SHALL buscar el primer chat de la lista marcado como no leído (por etiqueta accesible "mensajes no leídos"/"unread"/"No leídos" o texto equivalente), hacer clic en él para abrirlo y extraer su teléfono del identificador del chat (10–15 dígitos) o, en su defecto, del título o texto de la fila. El ciclo MUST omitirse si no hay configuración de agente o si hay un overlay de login visible.

#### Scenario: Sin chats no leídos
- **WHEN** ningún chat aparece como no leído
- **THEN** el ciclo termina sin acciones y registra "Sin chats no leídos detectables"

#### Scenario: Mismo chat que el ciclo anterior
- **WHEN** el primer chat no leído es el mismo que se procesó en el ciclo inmediatamente anterior
- **THEN** el ciclo termina sin volver a procesarlo

#### Scenario: Teléfono ya procesado en la sesión
- **WHEN** los últimos 10 dígitos del teléfono ya fueron procesados desde que arrancó el monitor
- **THEN** no se consulta el CRM ni se registra interacción

> Nota: abrir el chat lo marca como leído en WhatsApp, por lo que solo se procesa un chat por ciclo (máximo ~12 por minuto) y un chat cuyo registro falle ya no vuelve a aparecer en "No leídos" hasta que llegue otro mensaje (`whatsapp-monitor.js:382`). El registro de teléfonos procesados vive solo en memoria y se pierde al reiniciar el CLI.

### Requirement: Registro automático de interacción por respuesta
Para un teléfono nuevo, el monitor SHALL normalizarlo a `+52` + 10 dígitos, consultar en la API de interacciones `POST /client-info` (con reintento sin `+52` ante 404) y `GET /result-codes/{campaña}` con un límite de 10 segundos, y tomar el `credit_id` del primer resultado. Si hay `credit_id`, MUST registrar una interacción con `POST /interactions`.

#### Scenario: Teléfono con crédito
- **WHEN** el CRM devuelve un cliente con `credit_id` y la inserción responde OK
- **THEN** la interacción enviada lleva subdictamen `CLIENTE NO DEFINE`, `contactable: true`, `phone_number` de 10 dígitos, `inoutbound: "inbound"`, canal y acción `whatsapp`, comentario `Monitor: respuesta detectada en No leídos`, fecha/hora/rango actuales y campos de promesa en `null`
- **AND** el teléfono se marca como procesado y la ventana muestra durante ~3.5 segundos el aviso "✅ Interacción enviada: {+52...} (credit_id {id})"

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

### Requirement: Login del monitor
La ventana monitor MUST reutilizar la configuración de agente guardada por la ventana de automatización y SHALL NOT solicitar credenciales en el flujo actual.

#### Scenario: Arranque del monitor
- **WHEN** la ventana monitor se abre
- **THEN** no aparece overlay de login; si falta la configuración de agente solo se registra una advertencia y el bucle no procesa chats

> Nota: existe un overlay "Iniciar Sesión (Monitor)" con verificación `POST /auth/verify` y timeout de 15/20 segundos que nunca se invoca (código muerto, `whatsapp-monitor.js:30`).

### Requirement: Cierre del monitor
El CLI SHALL detener el bucle de detección y cerrar el navegador del monitor al terminar el proceso principal o al apagarse.

#### Scenario: Apagado del CLI
- **WHEN** el CLI se cierra
- **THEN** el intervalo de 5 segundos se detiene y se cierra el navegador o contexto del monitor
