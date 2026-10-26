# whatsapp-session Specification

## Purpose
Describe el ciclo de vida de la sesión de WhatsApp en la app de escritorio v4: cliente `whatsapp-web.js` en el proceso main con Chromium headless, arranque tras el login, QR, estados y mensajes de progreso, respaldo y restauración de la sesión como zip en S3 mediante URLs prefirmadas del backend (RemoteAuth), detección de sesión desplazada o cerrada, limpieza de sesión y aislamiento entre operadores de la misma PC. Las rutas `/wa-session/*` del backend se describen en sus propias especificaciones.

> Nota: Chromium se lanza con `--no-sandbox` y `--disable-setuid-sandbox`. Solo se escucha el evento de mensajes entrantes: lo que el agente escriba desde el teléfono u otro dispositivo no se captura ni se persiste.

## Requirements

### Requirement: Arranque tras login
Al recibir un token no nulo, el main SHALL configurar el respaldo remoto con el `cognito:username` del ID token como identificador de sesión (caracteres fuera de `[A-Za-z0-9_-]` reemplazados por `_`), iniciar el poller y, si no existe cliente, arrancar WhatsApp. Sin token, arrancar MUST emitir el error "Inicia sesión antes de conectar WhatsApp." sin lanzar el navegador.

#### Scenario: Reapertura con respaldo remoto
- **WHEN** el operador inicia sesión y existe un zip de sesión suyo en S3
- **THEN** la app restaura la sesión y conecta WhatsApp sin pedir QR

#### Scenario: Arranque sin login
- **WHEN** se pide iniciar WhatsApp sin token
- **THEN** se emite el error "Inicia sesión antes de conectar WhatsApp."

### Requirement: Aislamiento entre operadores
El main SHALL guardar en un archivo `.ana-last-operator` del directorio de datos el último operador que usó WhatsApp. Si inicia sesión un operador distinto, MUST borrar la sesión local de WhatsApp antes de arrancar. El cierre de sesión SHALL borrar siempre la carpeta local `wwebjs_auth` y conservar el respaldo en S3.

#### Scenario: Otro usuario en la misma PC
- **WHEN** el operador B inicia sesión en una PC donde el último fue A
- **THEN** la sesión local de A se borra y B restaura la suya desde S3 o escanea QR

### Requirement: Cliente headless con Chromium empaquetado
El cliente SHALL usar Chromium headless; en build instalado MUST usar `resources/chrome/chrome.exe` del paquete y en desarrollo el de Puppeteer. Los datos locales de sesión SHALL vivir en `<userData>/wwebjs_auth`. Si en 60 segundos no hubo QR, carga ni listo, MUST emitir "No respondió WhatsApp Web (tarda o falló el navegador). Reintenta.". Si la inicialización falla, el cliente se libera y se emite el error.

#### Scenario: Navegador colgado
- **WHEN** pasan 60 segundos sin señal de WhatsApp Web
- **THEN** la UI muestra el aviso de que no respondió y sugiere reintentar

### Requirement: QR y estados
El cliente SHALL convertir cada QR a imagen data URL (corrección de errores M) y emitirlo; la UI MUST mostrarlo para escanear. Los estados emitidos SHALL ser `qr`, `authenticated`, `connected` (al quedar listo, borra el QR) y `disconnected`. El main MUST conservar el último estado y QR para que el renderer los recupere al recargar.

#### Scenario: Primer enlace
- **WHEN** no hay sesión local ni remota
- **THEN** la UI muestra el QR y, tras escanearlo, pasa a "Conectado"

#### Scenario: Recarga del renderer
- **WHEN** el renderer se recarga con WhatsApp ya conectado
- **THEN** recupera el estado `connected` sin reconectar

### Requirement: Mensajes de progreso del arranque
Durante el arranque el cliente SHALL emitir mensajes de progreso: "Iniciando WhatsApp…", "Obteniendo sesión remota…", "Restaurando sesión…", "Autenticando…", "Cargando conversaciones… N%" y "Respaldando sesión…". La UI MUST mostrarlos con un indicador giratorio mientras no haya QR.

#### Scenario: Restauración remota
- **WHEN** se descarga la sesión desde S3
- **THEN** la UI muestra "Obteniendo sesión remota…" y luego "Restaurando sesión…"

### Requirement: Respaldo remoto de sesión
El respaldo SHALL subirse a S3 cada 2 minutos como zip por URL prefirmada PUT (`POST /wa-session/presign` con `op: put`); si el zip aún no existe, falta la URL o la subida falla, MUST omitirse ese ciclo sin romper la sesión. La existencia se consulta con `GET /wa-session/exists` (error = no existe), la descarga con `op: get` y el borrado con `POST /wa-session/delete`.

#### Scenario: Falla una subida
- **WHEN** S3 rechaza la subida del zip
- **THEN** se registra una advertencia y la sesión sigue activa; el siguiente ciclo reintenta

#### Scenario: Falla la descarga
- **WHEN** el backend no entrega URL de descarga o S3 responde error
- **THEN** la inicialización falla y la UI muestra el error

### Requirement: Sesión desplazada, cerrada o rechazada
Ante desconexión el cliente SHALL emitir `disconnected` y liberarse. Si el motivo contiene `CONFLICT`, MUST mostrar una notificación del sistema "ana — WhatsApp" (clic enfoca la ventana) y el error de sesión abierta en otro equipo; si contiene `LOGOUT`, indicar cierre desde el teléfono o bloqueo y sugerir limpiar sesión. Ante rechazo de autenticación SHALL emitir `auth_failure` y sugerir "Limpiar sesión y reconectar".

#### Scenario: Sesión abierta en otra computadora
- **WHEN** el mismo número se conecta en otra PC
- **THEN** esta PC muestra una notificación del sistema y el aviso de que solo puede estar activa en un equipo

#### Scenario: Otra causa
- **WHEN** WhatsApp se desconecta por un motivo distinto
- **THEN** la UI muestra "WhatsApp se desconectó (<motivo>). Reintenta conectar; si persiste, limpia la sesión y reescanea."

### Requirement: Limpiar sesión y reconectar
La acción "Limpiar sesión y reconectar" SHALL destruir el cliente, MUST borrar el respaldo remoto en S3 y la carpeta local de sesión, y arrancar de nuevo para mostrar un QR nuevo. "Conectar WhatsApp" SHALL arrancar el cliente sin borrar nada y mostrar "Iniciando… Ns" con contador de segundos.

#### Scenario: Sesión muerta
- **WHEN** el operador pulsa "Limpiar sesión y reconectar"
- **THEN** se borran sesión local y remota y aparece un QR nuevo

### Requirement: Mensajes entrantes
Cada mensaje entrante SHALL normalizarse con id, chat de la contraparte (destinatario si es propio, remitente si no), remitente, destinatario, cuerpo, marca de tiempo en ms, si es propio y tipo. Si trae media, MUST descargarse, subirse a S3 por `POST /media/presign` y guardarse solo la llave y el nombre de archivo; los bytes nunca se persisten. Luego el mensaje se envía al renderer y a `PUT /messages`.

#### Scenario: Imagen entrante
- **WHEN** un contacto envía una foto
- **THEN** la foto se sube a S3 y el mensaje persistido lleva solo la llave de media y el tipo MIME

#### Scenario: Falla la subida de media
- **WHEN** el presign o la subida a S3 fallan
- **THEN** el mensaje se persiste sin llave de media y sin bytes
