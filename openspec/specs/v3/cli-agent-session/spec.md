# cli-agent-session Specification

## Purpose
Describe el arranque y ciclo de vida de la sesión del agente en el CLI v3 de WhatsApp (`v3/cli-whatsapp`): verificación de auto-actualización, flags de línea de comandos, login del agente contra el backend (usuario, campaña y palabra del día), configuración persistida, apertura de las ventanas de WhatsApp Web (automatización, manual y monitor) y cierre ordenado. Los detalles internos de las ventanas manual y monitor y del respaldo de chats pertenecen a otras especificaciones.

## Requirements

### Requirement: Directorio de datos local
El CLI SHALL resolver su directorio de datos con esta prioridad: variable `ANA_DATA_DIR`; si no existe, `%APPDATA%\ANA`; si no existe, `%LOCALAPPDATA%\ANA`; y como último recurso el directorio de trabajo actual. El CLI MUST crear ese directorio si no existe.

#### Scenario: Ejecución en Windows con APPDATA definido
- **WHEN** el CLI arranca sin `ANA_DATA_DIR` y con `%APPDATA%` definido
- **THEN** todos los archivos persistentes se leen y escriben bajo `%APPDATA%\ANA`
- **AND** el directorio se crea automáticamente si no existía

#### Scenario: Override por variable de entorno
- **WHEN** el CLI arranca con `ANA_DATA_DIR` definido
- **THEN** el CLI usa ese directorio en lugar de `%APPDATA%\ANA`

### Requirement: Contenido del directorio de datos
El CLI SHALL almacenar en el directorio de datos la configuración del agente (`.agent-config.json`), los perfiles de navegador `whatsapp-session` (automatización), `whatsapp-session-manual` y `whatsapp-session-monitor`, los archivos de salida `resultados.csv` y `respuestas.csv`, y el registro de errores `ana-crash.log`.

#### Scenario: Sesión de WhatsApp persistente
- **WHEN** el agente escaneó el QR en una ejecución anterior y vuelve a abrir el CLI
- **THEN** la ventana de automatización reutiliza el perfil `whatsapp-session` y no pide QR de nuevo

### Requirement: Verificación de actualización al iniciar
Al iniciar, el CLI SHALL ejecutar la verificación de auto-actualización (especificación `cli-distribution`) antes de cualquier otra acción, salvo que se pase el flag `--no-self-update`. Si la actualización se aplica, el CLI MUST imprimir "Actualización aplicada. Reiniciando..." y terminar sin abrir ventanas. Si la verificación lanza un error, SHALL registrar la advertencia y continuar el arranque.

#### Scenario: Hay una versión nueva
- **WHEN** el CLI arranca sin `--no-self-update` y existe una versión remota mayor que la local
- **THEN** el CLI descarga y lanza la actualización
- **AND** termina el flujo principal sin abrir ventanas de WhatsApp

#### Scenario: Auto-actualización deshabilitada
- **WHEN** el CLI arranca con el flag `--no-self-update`
- **THEN** no se consulta el manifiesto de versiones y el arranque continúa

#### Scenario: Falla la verificación
- **WHEN** la verificación de actualización lanza una excepción
- **THEN** el CLI imprime "Auto-update falló" con el mensaje de error y continúa el arranque

### Requirement: Flags de reseteo de perfiles de navegador
El CLI SHALL aceptar los flags `--reset-auto-session`, `--reset-manual-session`, `--reset-monitor-session` y `--reset-monitor-alt-session`, que MUST renombrar (no borrar) respectivamente `whatsapp-session`, `whatsapp-session-manual`, `whatsapp-session-monitor` y `whatsapp-session-monitor-alt` a `<nombre>.bak-<timestamp ISO con ':' y '.' cambiados por '-'>`. Un directorio inexistente o un error de renombrado SHALL ignorarse tras registrarlo.

#### Scenario: Recuperar perfil corrupto del monitor
- **WHEN** el CLI arranca con `--reset-monitor-session` y existe `whatsapp-session-monitor`
- **THEN** el directorio se renombra a `whatsapp-session-monitor.bak-<timestamp>`
- **AND** la ventana monitor arranca con un perfil vacío y solicita escanear un nuevo QR

#### Scenario: Perfil inexistente
- **WHEN** se pasa `--reset-auto-session` y `whatsapp-session` no existe
- **THEN** no se realiza ninguna acción y el arranque continúa

### Requirement: Modo de media por portapapeles
El CLI SHALL activar el modo de envío de media por portapapeles cuando se pase el flag `--clipboard-media`, imprimiendo un aviso de que debe haber una imagen o video copiado antes de cada envío. Sin el flag, el modo MUST permanecer desactivado.

#### Scenario: Lanzamiento con imagen
- **WHEN** el CLI arranca con `--clipboard-media` (por ejemplo desde el acceso directo "ANA (con imagen)")
- **THEN** se imprime "Modo media por portapapeles ACTIVADO"
- **AND** cada envío automático pega el contenido del portapapeles antes del texto

### Requirement: Ventana de automatización con perfil persistente
El CLI SHALL abrir una ventana de Chromium visible (no headless) con perfil persistente `whatsapp-session`, en modo app sobre `https://web.whatsapp.com` y viewport de 1280x720. La ventana MUST bloquear los atajos de herramientas de desarrollo (F12, Ctrl+Shift+I/J/C y equivalentes en Mac) y el menú contextual.

#### Scenario: Apertura de la ventana
- **WHEN** inicia el flujo de automatización
- **THEN** se abre WhatsApp Web sin barra de navegación del navegador

#### Scenario: Intento de abrir DevTools
- **WHEN** el agente presiona F12 o hace clic derecho en la ventana de automatización
- **THEN** el evento se cancela y no se abre ninguna herramienta ni menú

### Requirement: Restricciones de UI en la ventana de automatización
El CLI SHALL ocultar o deshabilitar en la ventana de automatización, de forma continua (cada segundo y ante cambios del DOM), los controles de llamada, videollamada, nota de voz, nuevo chat, menú principal, menús de cada chat, contadores de no leídos, la barra de navegación inferior y el detalle del perfil del contacto, y MUST dejar el cuadro de búsqueda en solo lectura.

#### Scenario: WhatsApp Web redibuja la interfaz
- **WHEN** WhatsApp Web vuelve a renderizar el botón de nuevo chat
- **THEN** el botón se oculta de nuevo en menos de un segundo

### Requirement: Formulario de login del agente
En cada arranque de la ventana de automatización, el CLI SHALL mostrar sobre WhatsApp Web un overlay "Iniciar Sesión" con los campos Usuario, Campaña y Palabra del Día (tipo contraseña con botón Ver/Ocultar), precargando Usuario y Campaña desde la configuración guardada si existe. Los tres campos MUST convertirse a minúsculas al escribir y ser obligatorios. Si la página recarga antes de completar el login, el overlay SHALL volver a dibujarse.

#### Scenario: Agente recurrente
- **WHEN** existe `.agent-config.json` con `agent_id` y `campaign`
- **THEN** el formulario aparece con Usuario y Campaña precargados y solo falta la palabra del día

#### Scenario: Campos incompletos
- **WHEN** el agente envía el formulario sin usuario o campaña
- **THEN** se muestra "Por favor completa todos los campos" sin llamar al backend
- **AND** si falta la palabra del día se muestra "Por favor ingresa la palabra del día"

#### Scenario: Recarga de la página durante el login
- **WHEN** WhatsApp Web recarga la página antes de completar el login
- **THEN** el overlay de login se vuelve a dibujar

### Requirement: Verificación de credenciales contra el backend
Al enviar el formulario (botón "Verificar Credenciales" o Enter), el CLI SHALL hacer `POST {apiBaseUrl}/auth/verify` con cuerpo JSON `{user, campaign, dailyPassword}` y MUST aceptar el login solo si la respuesta contiene `success: true`. En caso contrario SHALL mostrar el `message` del backend o "Credenciales incorrectas", y ante un error de red "Error de conexión con el servidor".

#### Scenario: Credenciales válidas
- **WHEN** el backend responde `success: true`
- **THEN** el overlay se cierra
- **AND** se guarda la configuración con `agent_id` igual al usuario y `campaign` igual a la campaña ingresada

#### Scenario: Credenciales inválidas
- **WHEN** el backend responde `success: false`
- **THEN** el overlay muestra el mensaje de error y permanece abierto

#### Scenario: Backend inalcanzable
- **WHEN** la llamada a `/auth/verify` falla por red
- **THEN** el overlay muestra "Error de conexión con el servidor"

> Nota: `/auth/verify` usa el `apiBaseUrl` fijo de la configuración (`https://ow24p7ablb.execute-api.us-east-1.amazonaws.com`) y no respeta la variable `ANA_API_URL` que sí usan los demás endpoints del backend.

### Requirement: Persistencia de la configuración del agente
El CLI SHALL persistir la configuración del agente en `<directorio de datos>/.agent-config.json` como JSON con al menos `agent_id` y `campaign`. Antes de escribir, MUST eliminar cualquier campo de palabra del día (`dailyPassword`, `daily_password`, `daily_password_word`, `palabraDelDia`, `palabra_del_dia`, `dailyWord`), de modo que la palabra del día nunca se guarde en disco.

#### Scenario: Guardado tras login
- **WHEN** el login es exitoso
- **THEN** `.agent-config.json` contiene `agent_id` y `campaign`
- **AND** no contiene la palabra del día

### Requirement: Arranque sin credenciales previas
Si al iniciar no existe `.agent-config.json`, el CLI SHALL abrir primero la ventana de automatización para capturar credenciales. Si tras ese paso sigue sin existir configuración, MUST imprimir "Configura credenciales y vuelve a ejecutar" y terminar.

#### Scenario: Primer uso
- **WHEN** el CLI arranca sin `.agent-config.json`
- **THEN** se imprime "No hay credenciales configuradas" y se abre la ventana de automatización con el overlay de login

> Nota: en este caso la ventana de automatización se inicializa dos veces sobre el mismo perfil `whatsapp-session` sin cerrar la primera (`index.js:330` y `index.js:382`), lo que puede provocar un error de perfil en uso en el primer arranque.

### Requirement: Conexión de WhatsApp Web
Después del login, el CLI SHALL esperar hasta 300000 ms (5 minutos) a que WhatsApp Web esté conectado (presencia de `#side` o `#pane-side`), permitiendo escanear el código QR mientras tanto. Si no se conecta en ese plazo, el flujo principal MUST terminar con "Error fatal" y cerrar las ventanas.

#### Scenario: Escaneo de QR
- **WHEN** el perfil no tiene sesión de WhatsApp y el agente escanea el QR en menos de 5 minutos
- **THEN** el CLI imprime "WhatsApp Web conectado - Iniciando automatización..."

#### Scenario: Timeout de conexión
- **WHEN** WhatsApp Web no se conecta en 5 minutos
- **THEN** el flujo principal termina con "Error fatal" y se cierran las ventanas

### Requirement: Overlay de protección de la automatización
Una vez conectado, y si `showOverlay` está activo (por defecto `true`), el CLI SHALL mostrar un overlay persistente "Automatización en Proceso — No interactúes con esta ventana" que se recrea si se elimina y se reactiva tras recargas, y MUST bloquear los clics del usuario en todo el DOM excepto la barra inferior del chat, el cuadro de mensaje y el botón Enviar. El overlay MUST NOT activarse antes de verificar el login.

#### Scenario: Ventana conectada
- **WHEN** WhatsApp Web se conecta tras un login verificado
- **THEN** aparece el overlay "Automatización en Proceso" y los clics del agente sobre la lista de chats no tienen efecto

#### Scenario: Recarga antes del login
- **WHEN** la página recarga y el login aún no está verificado
- **THEN** el overlay de automatización no se muestra

### Requirement: Apertura de ventanas manual y monitor
Después de inicializar la ventana de automatización, el CLI SHALL abrir la ventana manual si `enableManualWindow` es `true` y la ventana monitor ("No leídos") si `enableMonitorWindow` es `true`; ambos valen `true` por defecto y solo cambian editando la configuración (no hay flags). Ambas MUST abrirse en paralelo sin bloquear el envío automático, y un error al abrirlas SHALL registrarse sin detener la automatización.

#### Scenario: Configuración por defecto
- **WHEN** el CLI completa el login y la conexión de la ventana de automatización
- **THEN** se imprimen "Ventana manual: ACTIVADA" y "Ventana monitor: ACTIVADA"
- **AND** se abren las ventanas manual y monitor mientras empieza el polling de asignaciones

#### Scenario: Falla la ventana manual
- **WHEN** la inicialización de la ventana manual lanza un error
- **THEN** se imprime "Error al iniciar ventana manual" con el stack y el ciclo de envío continúa

### Requirement: Widget de estado en las ventanas
El CLI SHALL mostrar en las ventanas de automatización, manual y monitor un widget fijo en la esquina inferior derecha con el estado actual: "Poll: consultando servidor..." durante la consulta, "Ciclo N | i/total" con el contador de pausa durante el envío, y cuentas regresivas `HH:MM:SS` ("Próximo poll", "Fin de pausa") durante las esperas.

#### Scenario: Espera entre polls
- **WHEN** el CLI espera el siguiente poll
- **THEN** las tres ventanas muestran "Próximo poll: HH:MM:SS" actualizado cada segundo

### Requirement: Cierre ordenado con Ctrl+C
Al recibir SIGINT (Ctrl+C), el CLI SHALL imprimir "Cerrando por Ctrl+C...", cerrar los navegadores de automatización, manual y monitor ignorando errores individuales, y terminar con código 0. El manejador MUST ejecutarse una sola vez.

#### Scenario: El agente presiona Ctrl+C
- **WHEN** el agente presiona Ctrl+C en la consola
- **THEN** se cierran las tres ventanas y el proceso termina con código 0

### Requirement: Manejo de errores fatales
Ante una excepción no capturada o una promesa rechazada sin manejar, el CLI SHALL añadir una entrada con fecha ISO, tipo y stack a `<directorio de datos>/ana-crash.log` y terminar con código 1. Cuando se ejecuta como ejecutable empaquetado (pkg), MUST esperar a que el usuario presione ENTER antes de salir.

#### Scenario: Excepción no capturada
- **WHEN** ocurre una excepción no capturada
- **THEN** se agrega la entrada a `ana-crash.log` y el proceso termina con código 1
