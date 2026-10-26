# Spec Delta

## MODIFIED Requirements

### Requirement: Ventana principal
La app SHALL crear una ventana de 1200x800 que se muestra solo cuando está lista para pintarse, con `contextIsolation` y `sandbox` activos, `nodeIntegration` desactivado y un script preload. En build instalado MUST cargar `dist/index.html` del paquete; en desarrollo SHALL cargar `VITE_DEV_SERVER_URL` o `http://localhost:5173`. Al cerrarse todas las ventanas la app SHALL salir (salvo macOS).

#### Scenario: Build instalado
- **WHEN** la app corre empaquetada
- **THEN** la ventana carga el renderer desde los archivos locales del paquete

#### Scenario: Desarrollo
- **WHEN** la app corre sin empaquetar y sin `VITE_DEV_SERVER_URL`
- **THEN** la ventana carga `http://localhost:5173`

#### Scenario: Renderer sin Node
- **WHEN** código del renderer intenta usar `require` o `process`
- **THEN** no están disponibles y solo existe `window.ana`

### Requirement: Endurecimiento en build instalado
En build instalado la app SHALL quitar la barra de menú, MUST bloquear el menú contextual (clic derecho), cerrar DevTools si se abren y descartar F12 y, solo cuando Alt no está presionada, Ctrl/Cmd+Shift+I, Ctrl/Cmd+Shift+J, Ctrl/Cmd+Shift+C y Ctrl/Cmd+U. Las combinaciones con AltGr (Ctrl+Alt) MUST llegar al renderer para escribir caracteres. En desarrollo no se aplica ningún bloqueo.

#### Scenario: Intento de abrir DevTools
- **WHEN** el operador presiona F12 en la app instalada
- **THEN** la pulsación se descarta y DevTools no se abre

#### Scenario: Clic derecho
- **WHEN** el operador hace clic derecho en la app instalada
- **THEN** no aparece menú contextual

#### Scenario: AltGr en teclado latinoamericano
- **WHEN** el operador escribe con AltGr un carácter como `@`, `\` o `|` en el campo de respuesta en Windows
- **THEN** el carácter se escribe normalmente

## ADDED Requirements

### Requirement: Navegación y ventanas nuevas
La ventana principal MUST rechazar cualquier navegación o redirección fuera del origen de la app y denegar la apertura de ventanas nuevas de Electron; un enlace `https` que intente abrir ventana SHALL abrirse en el navegador del sistema y cualquier otro esquema MUST ignorarse.

#### Scenario: Enlace en un mensaje
- **WHEN** el operador hace clic en un enlace `https://` con `target="_blank"`
- **THEN** se abre en el navegador predeterminado y no se crea otra ventana de la app

#### Scenario: Navegación inesperada
- **WHEN** el renderer intenta navegar a `https://ejemplo.com`
- **THEN** la navegación se cancela y la app sigue en su vista

### Requirement: Content-Security-Policy del renderer
El renderer SHALL declarar una Content-Security-Policy que solo permita scripts y fuentes del propio paquete, conexiones a la API configurada, a Cognito y a S3 de AWS, e imágenes propias, `data:`, `blob:` y de S3, sin objetos embebidos. Las fuentes tipográficas MUST venir empaquetadas en la app, sin solicitudes a servicios de fuentes externos.

#### Scenario: Script externo
- **WHEN** algo intenta cargar un script desde un dominio externo en el renderer
- **THEN** el navegador lo bloquea por la política

#### Scenario: Arranque sin red de fuentes
- **WHEN** la app arranca en una red que bloquea `fonts.googleapis.com`
- **THEN** la interfaz se muestra con sus fuentes normales

### Requirement: Validación del emisor y argumentos IPC
El proceso main MUST atender una llamada de `window.ana` solo si proviene del frame principal de la ventana de la app con el origen esperado y si sus argumentos cumplen tipo y límites (JID de contacto individual, texto de hasta 4096 caracteres, media de hasta 16 MB de tipo imagen, audio, video o PDF, listas acotadas, token con forma de JWT o nulo); si no, SHALL responder `{ok:false, error:"solicitud inválida"}` sin ejecutar la acción.

#### Scenario: JID de grupo o malformado
- **WHEN** el renderer pide enviar una respuesta a `123@g.us` o a `abc`
- **THEN** el main responde "solicitud inválida" y no envía nada

#### Scenario: Media demasiado grande
- **WHEN** el renderer pide enviar un archivo de 40 MB
- **THEN** el main responde "solicitud inválida" y no envía nada

#### Scenario: Emisor ajeno
- **WHEN** una llamada IPC llega desde un frame que no es el principal de la app
- **THEN** el main la rechaza sin ejecutar la acción
