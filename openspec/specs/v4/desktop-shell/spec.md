# desktop-shell Specification

## Purpose
Describe el contenedor de la app de escritorio v4 (`v4/desktop`, Electron + Vite + React): instancia única, ventana principal y su endurecimiento en builds instalados, puente IPC `window.ana` entre renderer y proceso main, resolución de la URL del backend, navegación por pestañas según rol, heartbeat del agente y empaquetado del instalador. Login, actualización, WhatsApp, envíos y pantallas concretas pertenecen a otras especificaciones.

> Nota: el puente IPC no valida el origen del emisor ni los argumentos (JID, cuerpo, base64 de media); cualquier código que corra en el renderer puede enviar mensajes de WhatsApp arbitrarios, cambiar el token del main o borrar la sesión. El HTML del renderer no declara Content-Security-Policy y carga fuentes de Google Fonts por red. Los enlaces `target="_blank"` abren ventanas nuevas de Electron sin manejador de apertura configurado.

## Requirements

### Requirement: Instancia única
La app SHALL solicitar el candado de instancia única al arrancar y MUST terminar si otra instancia ya lo tiene. Cuando se intenta abrir una segunda instancia, la ventana existente SHALL restaurarse si estaba minimizada y recibir el foco.

#### Scenario: Segunda apertura
- **WHEN** el operador abre `ana` mientras ya hay una instancia corriendo
- **THEN** la segunda instancia termina
- **AND** la ventana de la primera se restaura y toma el foco

### Requirement: Ventana principal
La app SHALL crear una ventana de 1200x800 que se muestra solo cuando está lista para pintarse, con `contextIsolation` activo y un script preload. En build instalado MUST cargar `dist/index.html` del paquete; en desarrollo SHALL cargar `VITE_DEV_SERVER_URL` o `http://localhost:5173`. Al cerrarse todas las ventanas la app SHALL salir (salvo macOS).

#### Scenario: Build instalado
- **WHEN** la app corre empaquetada
- **THEN** la ventana carga el renderer desde los archivos locales del paquete

#### Scenario: Desarrollo
- **WHEN** la app corre sin empaquetar y sin `VITE_DEV_SERVER_URL`
- **THEN** la ventana carga `http://localhost:5173`

### Requirement: Endurecimiento en build instalado
En build instalado la app SHALL quitar la barra de menú, MUST bloquear el menú contextual (clic derecho), cerrar DevTools si se abren y descartar los atajos F12, Ctrl/Cmd+Shift+I, Ctrl/Cmd+Shift+J, Ctrl/Cmd+Shift+C y Ctrl/Cmd+U. En desarrollo no se aplica ningún bloqueo.

#### Scenario: Intento de abrir DevTools
- **WHEN** el operador presiona F12 en la app instalada
- **THEN** la pulsación se descarta y DevTools no se abre

#### Scenario: Clic derecho
- **WHEN** el operador hace clic derecho en la app instalada
- **THEN** no aparece menú contextual

> Nota: el filtro de teclas no excluye Alt, por lo que en Windows AltGr (Ctrl+Alt) combinado con U, o con Shift+I/J/C, también se descarta. El comentario del código dice que DevTools están "habilitadas para depurar", pero la bandera vale `false` y el bloqueo está activo.

### Requirement: URL del backend
El proceso main SHALL usar `ANA_API_BASE` del entorno o, si no existe, la URL del backend prod desplegado en `us-east-2`. El renderer SHALL usar `VITE_API_BASE` fijada en build o, si falta, `http://localhost:3000`. Ambas URLs se resuelven de forma independiente.

#### Scenario: Build sin VITE_API_BASE
- **WHEN** el renderer se compiló sin `VITE_API_BASE`
- **THEN** las llamadas del renderer van a `http://localhost:3000` mientras el main sigue usando el backend prod

### Requirement: Puente IPC window.ana
El preload SHALL exponer en `window.ana` únicamente: fijar token, registrar agente, iniciar/detener/reiniciar WhatsApp, leer estado de WhatsApp, enviar respuesta, enviar media, fijar "escribiendo", aprobar jobs, leer asignación, pedir chequeo de update y suscripciones a los eventos `wa:event`, `wa:message`, `wa:sent`, `wa:progress`, `jobs:assignment` y `update:status`. Cada suscripción MUST devolver una función que la cancela.

#### Scenario: Suscripción y baja
- **WHEN** una pantalla se suscribe a `wa:progress` y luego se desmonta llamando la función devuelta
- **THEN** el listener deja de recibir eventos

### Requirement: Navegación por pestañas según rol
Tras login, la app SHALL mostrar un encabezado con "PERNEXIUM", el usuario y su etiqueta (`admin` o `líder`), y las pestañas "Chats" y "Mi asignación" para todos. "Campañas" MUST mostrarse solo a admin, líder o quien tenga `ana:contacts:list:upload`; "Admin" solo a admin. Si `/me` falla, el encabezado SHALL mostrar el error y el usuario queda sin rol. La pestaña inicial es "Chats".

#### Scenario: Agente sin permiso de subida
- **WHEN** entra un usuario no admin, no líder y sin `ana:contacts:list:upload`
- **THEN** solo ve las pestañas "Chats" y "Mi asignación" y el botón "Salir"

#### Scenario: Falla /me
- **WHEN** la consulta `GET /me` responde con error
- **THEN** el encabezado muestra una etiqueta roja con el mensaje de error y no se muestran "Campañas" ni "Admin"

> Nota: el permiso `ana:campaign:message:send` y los de chats (`view`, `reply`, `team:view`) no se evalúan en el escritorio; la visibilidad del panel de equipo depende solo de `isAdmin`/`isLeader`.

### Requirement: Heartbeat del agente
Tras cargar `/me`, el renderer SHALL registrar en el main la primera campaña distinta de `*` del usuario (o la primera de la lista). El main MUST enviar `POST /agents/heartbeat` con esa campaña al registrarla si hay cliente de WhatsApp, cuando WhatsApp pasa a conectado, y cada 5 minutos mientras haya campaña y cliente de WhatsApp. Al cerrar sesión la campaña registrada SHALL olvidarse.

#### Scenario: Agente conectado
- **WHEN** el agente tiene campaña registrada y WhatsApp conectado
- **THEN** el backend recibe un heartbeat de esa campaña cada 5 minutos

#### Scenario: Sin campaña
- **WHEN** `/me` devuelve una lista de campañas vacía
- **THEN** no se registra campaña y no se envían heartbeats

> Nota: el heartbeat periódico se condiciona a que exista el objeto cliente de WhatsApp, no a que esté conectado; un cliente atascado en QR también se anuncia activo.

### Requirement: Instalador y empaquetado
El build SHALL producir un instalador NSIS de Windows de un clic, por usuario, sin elegir directorio, que crea accesos en escritorio y menú inicio, abre la app al terminar y conserva los datos de la app al desinstalar. El paquete MUST incluir un Chromium propio en `resources/chrome` y publicar los artefactos al bucket S3 `ana-desktop-updates` (región `us-east-2`, ruta `updates`). El `appId` es `com.pernexium.ana`.

#### Scenario: Instalación masiva
- **WHEN** se ejecuta el `.exe` del instalador
- **THEN** la app se instala sin asistente, crea los accesos directos y se abre sola
