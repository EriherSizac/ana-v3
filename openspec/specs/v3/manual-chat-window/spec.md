# manual-chat-window Specification

## Purpose
Ventana persistente de WhatsApp Web (Chromium visible, modo app) donde el agente de cobranza responde manualmente a los deudores. Restringe la interfaz de WhatsApp para limitar acciones fuera de "solo responder" e inyecta botones propios (Subir gestión, Ver Historial, Números sin WhatsApp, Respaldar Chats).

## Requirements

### Requirement: Arranque de la ventana manual
El CLI SHALL abrir la ventana manual después de inicializar la ventana de automatización, solo cuando la bandera `enableManualWindow` está activa (por defecto `true`). La ventana SHALL usar un perfil persistente de Chromium propio (`whatsapp-session-manual` en el directorio de datos del CLI), visible, en modo app sobre `https://web.whatsapp.com`, con viewport de 1280x720 y DevTools deshabilitado.

#### Scenario: Ubicación del perfil
- **WHEN** la variable `ANA_DATA_DIR` no está definida
- **THEN** el perfil se guarda en `%APPDATA%\ANA\whatsapp-session-manual`

#### Scenario: Primer arranque sin sesión de WhatsApp
- **WHEN** el perfil manual no tiene sesión de WhatsApp vinculada
- **THEN** la ventana muestra el código QR de WhatsApp Web y la consola pide escanearlo "con OTRO teléfono/cuenta"
- **AND** el CLI espera hasta 300 segundos a que aparezca la lista de chats antes de considerar la ventana lista

#### Scenario: Arranque con sesión previa
- **WHEN** el perfil manual ya tiene sesión vinculada
- **THEN** la ventana carga directamente la lista de chats y aplica restricciones y botones
- **AND** al final del arranque la página se recarga una vez para activar el respaldo automático de conversaciones

#### Scenario: Falta configuración de agente
- **WHEN** no existe el archivo de configuración del agente (`.agent-config.json`) con `agent_id` y `campaign`
- **THEN** la ventana se abre igualmente, pero la consola advierte que primero se debe validar credenciales en la ventana automática
- **AND** los botones de Subir gestión, Ver Historial y Números sin WhatsApp no se inyectan y el respaldo automático no se activa

### Requirement: Autenticación de la ventana manual
La ventana manual MUST reutilizar la configuración de agente (`agent_id`, `campaign`) guardada por la ventana de automatización y SHALL NOT pedir credenciales por sí misma en el flujo actual.

#### Scenario: Apertura con credenciales ya validadas
- **WHEN** la ventana manual arranca y existe configuración de agente
- **THEN** no se muestra ningún overlay de login ni "palabra del día" en la ventana manual
- **AND** la consola registra el usuario y la campaña cargados

> Nota: existe en el código un overlay de login "Iniciar Sesión (Manual)" / "Verificación Diaria" que valida contra `POST /auth/verify` con `{ user, campaign, dailyPassword }`, pero no se invoca en ningún punto (código muerto, `whatsapp-manual.js:23`).

### Requirement: Bloqueo de teclado y menú contextual
La ventana manual SHALL bloquear, desde antes de cargar WhatsApp y en cada recarga, todas las teclas de función (F1–F12) excepto F5, y toda combinación que use Ctrl, Cmd o Alt, con la única excepción de Ctrl+V / Cmd+V sin Shift ni Alt (pegar). El menú contextual del navegador (clic derecho) MUST quedar bloqueado en toda la página.

#### Scenario: Intento de abrir DevTools
- **WHEN** el agente presiona F12, Ctrl+Shift+I, Ctrl+Shift+J o Ctrl+Shift+C
- **THEN** el evento se cancela y DevTools no se abre

#### Scenario: Pegar texto en el cuadro de mensaje
- **WHEN** el agente presiona Ctrl+V en el cuadro de escritura
- **THEN** el pegado se permite normalmente

#### Scenario: Copiar texto
- **WHEN** el agente presiona Ctrl+C, Ctrl+A, Ctrl+Z u otra combinación con Ctrl/Alt
- **THEN** la combinación se cancela

#### Scenario: Recargar con F5
- **WHEN** el agente presiona F5
- **THEN** la página se recarga y las protecciones y restricciones se reaplican al terminar la carga

> Nota: en Windows la tecla AltGr se reporta como Ctrl+Alt, por lo que caracteres que dependen de AltGr en teclados latinoamericanos/españoles (p. ej. `@`) también quedan bloqueados (`whatsapp-manual.js:549`).

### Requirement: Restricciones de interfaz de WhatsApp
La ventana manual SHALL ocultar o deshabilitar de forma continua los controles de WhatsApp que no son necesarios para responder, reaplicando las restricciones cada 5 segundos y ante cambios del DOM (con un mínimo de 1.5 segundos entre aplicaciones). La selección de texto MUST estar deshabilitada en toda la página excepto en campos editables.

#### Scenario: Controles ocultos
- **WHEN** WhatsApp Web termina de cargar en la ventana manual
- **THEN** no están disponibles llamadas, videollamadas, mensajes de voz, nuevo chat, el menú de tres puntos, el menú desplegable de cada chat ni los contadores de no leídos
- **AND** la navegación lateral (Estado, Canales, Comunidades, Contenido multimedia, Ajustes, Perfil) y los detalles del perfil del contacto quedan ocultos

#### Scenario: Agente abre un chat
- **WHEN** el agente selecciona un chat de la lista
- **THEN** el chat se abre y puede escribir y enviar mensajes desde el pie del chat
- **AND** el encabezado del chat aparece atenuado (opacidad 0.6) y no es clicable, salvo el botón de búsqueda

#### Scenario: Agente intenta interactuar con un mensaje
- **WHEN** el agente hace clic o clic derecho sobre una burbuja de mensaje, o presiona Delete/Backspace fuera de un campo editable
- **THEN** la acción se cancela (sin responder, reaccionar, reenviar, fijar, destacar ni eliminar)
- **AND** se permite abrir fotos en el visor y descargar audios adjuntos

#### Scenario: Visor de imagen
- **WHEN** el agente abre una foto
- **THEN** los botones de zoom, ir al mensaje, responder, destacar, fijar, reaccionar, reenviar y menú del visor quedan deshabilitados
- **AND** el botón Cerrar sigue activo

#### Scenario: Clic derecho en la lista de chats
- **WHEN** el agente hace clic derecho o clic en la flecha de menú de un chat de la lista
- **THEN** la acción se cancela, impidiendo archivar o eliminar chats

### Requirement: Contactos permitidos
La ventana manual SHALL aceptar una lista de contactos permitidos; cuando la lista no está vacía MUST bloquear el cuadro de búsqueda de chats (solo lectura) y mostrar un panel "Contactos en automatización" con el número de contactos.

#### Scenario: Arranque desde el CLI
- **WHEN** el CLI abre la ventana manual
- **THEN** la lista de contactos permitidos se pasa vacía
- **AND** el cuadro de búsqueda queda habilitado y el panel de contactos no se muestra

> Nota: como el CLI siempre pasa una lista vacía (`index.js:392`), la restricción "solo contactos permitidos" no se aplica en producción; el agente puede buscar y abrir cualquier chat existente.

### Requirement: Indicadores visuales fijos
La ventana manual SHALL mostrar un indicador fijo "💬 Modo Manual - Solo Respuestas" en la esquina superior derecha, y los botones inyectados en posiciones fijas: "📜 Ver Historial" (inferior izquierda), "⬆️ Subir gestión" (inferior, a la derecha del historial), "ℹ️" de números sin WhatsApp (inferior derecha) y "☁️ Respaldar Chats" (superior izquierda). Los botones MUST recrearse si desaparecen del DOM (verificación cada 5 segundos o por observación del DOM; el de respaldo cada 1 segundo).

#### Scenario: WhatsApp re-renderiza la página
- **WHEN** WhatsApp Web elimina los elementos inyectados al re-renderizar
- **THEN** los botones e indicador se vuelven a insertar en pocos segundos

### Requirement: Botón de números sin WhatsApp
La ventana manual SHALL ofrecer un botón "ℹ️" que abre un modal "Números sin WhatsApp" con el total y los últimos 4 dígitos enmascarados (`**** 1234`) de los teléfonos con estado `no_whatsapp` en el archivo local `resultados.csv`, deduplicados por sus últimos 10 dígitos. Al abrir el modal, la ventana MUST registrar en la API de interacciones (`POST /interactions`) una interacción por cada teléfono listado, hasta un máximo de 200.

#### Scenario: Hay números sin WhatsApp
- **WHEN** el agente hace clic en el botón ℹ️ y `resultados.csv` contiene filas con estado `no_whatsapp`
- **THEN** el modal muestra "Total: N" y una píldora por número enmascarado
- **AND** se envía en segundo plano un lote de interacciones con subdictamen `Consulta No Whatsapp`, `contactable: false`, `credit_id` vacío, teléfono de 10 dígitos, `inoutbound: inbound`, canal `whatsapp` y comentario `opened_no_whatsapp_info_modal`

#### Scenario: No hay números sin WhatsApp
- **WHEN** el archivo no existe o no tiene filas `no_whatsapp`
- **THEN** el modal indica que no hay números marcados y no se envía ninguna interacción

#### Scenario: Cerrar el modal
- **WHEN** el agente hace clic en "×" o fuera del modal
- **THEN** el modal se cierra

> Nota: cada apertura del modal vuelve a registrar interacciones para todos los números listados, por lo que abrirlo varias veces genera interacciones duplicadas en el CRM (`whatsapp-manual.js:431`). El CSV se parsea separando por comas sin soporte de comillas.

### Requirement: Descargas de archivos
La ventana manual SHALL aceptar descargas y guardarlas en la carpeta `Downloads` del usuario, creando la carpeta si no existe y agregando un sufijo ` (n)` al nombre cuando ya existe un archivo con el mismo nombre.

#### Scenario: Descarga de un adjunto
- **WHEN** el agente descarga un archivo desde un chat y ya existe `factura.pdf` en Downloads
- **THEN** el archivo se guarda como `factura (1).pdf`

### Requirement: Cierre de la ventana manual
El CLI SHALL cerrar el navegador de la ventana manual al terminar el proceso principal o al recibir la señal de apagado.

#### Scenario: Error fatal en el proceso principal
- **WHEN** el bucle principal termina por error
- **THEN** se cierran la ventana de automatización, la manual y la monitor
