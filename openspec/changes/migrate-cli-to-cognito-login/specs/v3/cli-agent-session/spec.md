# Spec Delta

## MODIFIED Requirements

### Requirement: Contenido del directorio de datos
El CLI SHALL almacenar en el directorio de datos la configuración del agente (`.agent-config.json`), la sesión de Cognito protegida (`.agent-session`), los perfiles de navegador `whatsapp-session` (automatización), `whatsapp-session-manual` y `whatsapp-session-monitor`, los archivos de salida `resultados.csv` y `respuestas.csv`, y el registro de errores `ana-crash.log`.

#### Scenario: Sesión de WhatsApp persistente
- **WHEN** el agente escaneó el QR en una ejecución anterior y vuelve a abrir el CLI
- **THEN** la ventana de automatización reutiliza el perfil `whatsapp-session` y no pide QR de nuevo

#### Scenario: Sesión de Cognito persistente
- **WHEN** el agente inició sesión en una ejecución anterior y su refresh token sigue vigente
- **THEN** existe `.agent-session` en el directorio de datos y el CLI no vuelve a pedir contraseña

### Requirement: Formulario de login del agente
Cuando no hay sesión de Cognito reutilizable, el CLI SHALL mostrar sobre WhatsApp Web un overlay "Iniciar Sesión" con fondo azul y los campos Usuario y Contraseña (tipo contraseña con botón Ver/Ocultar), precargando Usuario desde la configuración guardada si existe. Usuario MUST aceptarse tal cual (solo sin espacios laterales, sin validarlo como email ni forzar minúsculas) y ambos campos son obligatorios. Si la página recarga antes de completar el login, el overlay SHALL volver a dibujarse.

#### Scenario: Agente recurrente
- **WHEN** existe `.agent-config.json` con `agent_id` pero no hay sesión reutilizable
- **THEN** el formulario aparece con Usuario precargado y solo falta la contraseña

#### Scenario: Campos incompletos
- **WHEN** el agente envía el formulario sin usuario o sin contraseña
- **THEN** se muestra "Por favor completa todos los campos" sin llamar a Cognito

#### Scenario: Username que no es email
- **WHEN** el agente escribe `Erick.H` como usuario
- **THEN** el formulario lo acepta sin pedir formato de correo y lo envía a Cognito como `Erick.H`

#### Scenario: Recarga de la página durante el login
- **WHEN** WhatsApp Web recarga la página antes de completar el login
- **THEN** el overlay de login se vuelve a dibujar en el paso en que estaba

### Requirement: Persistencia de la configuración del agente
El CLI SHALL persistir en `<directorio de datos>/.agent-config.json`, como JSON, `agent_id` (el `cognito:username` del ID token, en minúsculas) y `campaign` (la campaña elegida). El archivo MUST NOT contener contraseñas, códigos MFA, tokens ni campos de palabra del día (`dailyPassword`, `daily_password`, `daily_password_word`, `palabraDelDia`, `palabra_del_dia`, `dailyWord`), que se eliminan antes de escribir.

#### Scenario: Guardado tras login
- **WHEN** el login y la selección de campaña son exitosos
- **THEN** `.agent-config.json` contiene `agent_id` y `campaign`
- **AND** no contiene contraseña, tokens ni palabra del día

#### Scenario: Usuario con mayúsculas
- **WHEN** el agente inicia sesión como `Erick` y el token trae `cognito:username` `Erick`
- **THEN** `agent_id` se guarda como `erick`

### Requirement: Arranque sin credenciales previas
Si al iniciar no existe una sesión de Cognito reutilizable, el CLI SHALL abrir primero la ventana de automatización para mostrar el overlay de login. Si tras ese paso sigue sin haber sesión y campaña elegida, MUST imprimir "Configura credenciales y vuelve a ejecutar" y terminar.

#### Scenario: Primer uso
- **WHEN** el CLI arranca sin `.agent-session` ni `.agent-config.json`
- **THEN** se imprime "No hay credenciales configuradas" y se abre la ventana de automatización con el overlay de login

> Nota: en este caso la ventana de automatización se inicializa dos veces sobre el mismo perfil `whatsapp-session` sin cerrar la primera (`index.js:330` y `index.js:382`), lo que puede provocar un error de perfil en uso en el primer arranque.

## ADDED Requirements

### Requirement: Autenticación con Cognito
Al enviar el formulario, el CLI SHALL autenticar usuario y contraseña directamente contra el User Pool de Pernexium con el app client del CLI, desde el proceso Node (no desde la página), y MUST aceptar el login solo cuando Cognito entrega los tokens. Ante credenciales inválidas SHALL mostrar "Usuario o contraseña incorrectos", ante exceso de intentos "Demasiados intentos, espera unos minutos" y ante un error de red "Error de conexión con el servidor".

#### Scenario: Credenciales válidas sin desafíos
- **WHEN** Cognito acepta usuario y contraseña sin pedir MFA ni contraseña nueva
- **THEN** el overlay pasa a la selección de campaña

#### Scenario: Credenciales inválidas
- **WHEN** Cognito rechaza la contraseña o el usuario no existe
- **THEN** el overlay muestra "Usuario o contraseña incorrectos", limpia la contraseña y permanece abierto

#### Scenario: Restablecimiento obligatorio
- **WHEN** Cognito indica que el usuario debe restablecer su contraseña
- **THEN** el overlay muestra "Debes restablecer tu contraseña; contacta a tu supervisor" y no continúa

#### Scenario: Cognito inalcanzable
- **WHEN** la llamada a Cognito falla por red
- **THEN** el overlay muestra "Error de conexión con el servidor"

### Requirement: Desafío de código MFA
Si Cognito pide un código MFA (SMS o app autenticadora), el CLI SHALL mostrar en el overlay un campo de código de 6 dígitos con el canal correspondiente y enviarlo a Cognito; si pide elegir método, SHALL mostrar los métodos permitidos. Un código incorrecto MUST mostrar "Código incorrecto" y permitir reintentar; un desafío vencido MUST volver al paso de usuario y contraseña.

#### Scenario: Código TOTP correcto
- **WHEN** el usuario tiene MFA por app y escribe el código vigente
- **THEN** el login se completa y el overlay pasa a la selección de campaña

#### Scenario: Selección de método
- **WHEN** Cognito ofrece SMS y app autenticadora
- **THEN** el overlay muestra ambos métodos y, al elegir uno, pide el código de ese canal

#### Scenario: Código incorrecto
- **WHEN** el usuario escribe un código que Cognito rechaza
- **THEN** el overlay muestra "Código incorrecto" y conserva el paso de código

#### Scenario: Desafío vencido
- **WHEN** el usuario tarda más de lo que Cognito permite para responder el desafío
- **THEN** el overlay muestra "La sesión de inicio expiró, vuelve a intentarlo" y regresa a usuario y contraseña

### Requirement: Alta de MFA por app autenticadora
Si Cognito exige configurar MFA antes de completar el login, el CLI SHALL mostrar en el overlay el código QR y la clave secreta para registrarla en una app autenticadora, pedir el primer código y confirmarlo con Cognito antes de continuar.

#### Scenario: Primer login con MFA obligatorio
- **WHEN** el pool exige MFA y el usuario aún no lo tiene configurado
- **THEN** el overlay muestra QR y clave secreta, y al confirmar un código válido el login continúa

#### Scenario: Código de alta incorrecto
- **WHEN** el primer código no es válido
- **THEN** el overlay muestra "Código incorrecto" y permite reintentar sin perder el QR

### Requirement: Contraseña nueva obligatoria
Si Cognito exige contraseña nueva (usuario creado por un administrador), el CLI SHALL pedir en el overlay contraseña nueva y su confirmación, MUST rechazar sin llamar a Cognito si no coinciden ("Las contraseñas no coinciden") y SHALL mostrar el mensaje de Cognito cuando la contraseña no cumple su política.

#### Scenario: Primer login con contraseña temporal
- **WHEN** el usuario entra con su contraseña temporal y define una nueva válida dos veces
- **THEN** Cognito acepta el cambio y el login continúa (con MFA si el pool lo pide)

#### Scenario: Política incumplida
- **WHEN** la contraseña nueva no cumple la política del pool
- **THEN** el overlay muestra el motivo devuelto por Cognito y permanece en el paso de contraseña nueva

### Requirement: Selección de campaña habilitada
Tras autenticarse, el CLI SHALL obtener las campañas habilitadas con `GET /agent/campaigns` y mostrarlas en un selector con búsqueda, preseleccionando la campaña guardada si sigue habilitada o la única disponible. Sin campañas MUST mostrar "Tu usuario no está habilitado en ninguna campaña. Contacta a tu supervisor." y no continuar.

#### Scenario: Varias campañas
- **WHEN** `GET /agent/campaigns` devuelve `["prueba","ventas"]` y la configuración guardada tiene `campaign: "ventas"`
- **THEN** el selector muestra ambas con `ventas` preseleccionada y, al confirmar, se guarda la campaña elegida

#### Scenario: Sin campañas
- **WHEN** la respuesta trae `campaigns` vacío
- **THEN** el overlay muestra el aviso de usuario no habilitado y no abre la automatización

#### Scenario: Campaña guardada ya no habilitada
- **WHEN** la campaña guardada no está en la lista devuelta
- **THEN** no se preselecciona y el agente debe elegir otra

### Requirement: Almacenamiento protegido de la sesión
El CLI SHALL guardar el refresh token en `.agent-session` cifrado con la protección de datos del usuario actual de Windows (DPAPI, ámbito usuario), junto con usuario y fecha de emisión; los ID/access tokens MUST vivir solo en memoria. Si el cifrado no está disponible, MUST NOT persistir el refresh token y SHALL pedir login en cada arranque.

#### Scenario: Archivo copiado a otra cuenta
- **WHEN** `.agent-session` se copia a otro usuario de Windows o a otra máquina
- **THEN** el CLI no puede descifrarlo, lo descarta y muestra el formulario de login

#### Scenario: Contenido del archivo
- **WHEN** se inspecciona `.agent-session` en disco
- **THEN** no contiene en claro el refresh token, el ID token, el access token ni la contraseña

### Requirement: Reanudación de sesión al arrancar
Si existe una sesión guardada que Cognito renueva con éxito, el CLI SHALL mostrar en el overlay "Sesión activa: <usuario>" con el selector de campaña y los botones "Continuar" y "Cambiar de usuario", sin pedir contraseña. Si la renovación falla por token vencido o revocado, MUST borrar la sesión guardada y mostrar el formulario de login.

#### Scenario: Reapertura el mismo día
- **WHEN** el agente cierra y vuelve a abrir ANA con el refresh token vigente
- **THEN** ve "Sesión activa: erick" y continúa con un clic tras confirmar la campaña

#### Scenario: Refresh token vencido
- **WHEN** el refresh token guardado ya expiró o fue revocado
- **THEN** `.agent-session` se elimina y aparece el formulario de usuario y contraseña

### Requirement: Renovación silenciosa de tokens
El CLI SHALL renovar el ID token con el refresh token cuando falten 5 minutos o menos para su expiración, antes de cada llamada al backend, con una sola renovación en curso a la vez para todas las ventanas. Si Cognito entrega un refresh token nuevo, MUST reemplazar el guardado.

#### Scenario: Token por vencer durante el polling
- **WHEN** el ID token vence en 3 minutos y toca consultar asignaciones
- **THEN** el CLI renueva el token antes de la consulta y la envía con el token nuevo

#### Scenario: Llamadas simultáneas
- **WHEN** las ventanas de automatización y manual necesitan token al mismo tiempo y está por vencer
- **THEN** se hace una sola renovación y ambas llamadas usan su resultado

### Requirement: Autenticación de las llamadas al backend
El CLI SHALL enviar `Authorization: Bearer <ID token>` y `X-Ana-Cli-Version: <versión>` en toda llamada al backend v3 desde cualquier ventana (asignaciones, pendientes, respaldos, historial, media, campañas, configuración), y MUST tomar `agent_id` y `campaign` de la sesión activa, no de valores recibidos de la página.

#### Scenario: Poll de asignaciones
- **WHEN** el CLI consulta `GET /get/chats/{agent_id}/{campaign}`
- **THEN** la solicitud incluye `Authorization: Bearer <ID token>` y `X-Ana-Cli-Version`

#### Scenario: Respaldo desde la ventana manual
- **WHEN** la ventana manual guarda un respaldo de chat
- **THEN** la llamada a `POST /backups/chat` lleva el token y el `agent_id`/`campaign` de la sesión activa

### Requirement: Manejo de sesión rechazada por el backend
Ante un 401 del backend, el CLI SHALL forzar una renovación y reintentar una vez. Si persiste el 401 o la renovación falla, o ante un 403, MUST dejar de consumir asignaciones, seguir consultando con el intervalo normal y mostrar en consola y en el widget "Sesión expirada: cierra ANA y vuelve a iniciar sesión" (401) o "Tu usuario no está habilitado en esta campaña" (403).

#### Scenario: Token rechazado una vez
- **WHEN** el backend responde 401 y la renovación da un token nuevo aceptado
- **THEN** la llamada reintentada tiene éxito y el agente no ve ningún aviso

#### Scenario: Agente deshabilitado en el roster
- **WHEN** el backend responde 403 a la consulta de asignaciones
- **THEN** el CLI no procesa contactos y el widget muestra "Tu usuario no está habilitado en esta campaña"

#### Scenario: Refresh token revocado
- **WHEN** la renovación falla porque el refresh token fue revocado
- **THEN** el CLI muestra "Sesión expirada: cierra ANA y vuelve a iniciar sesión" y no procesa contactos

### Requirement: Cierre de sesión y cambio de usuario
El CLI SHALL revocar el refresh token en Cognito y borrar `.agent-session` al elegir "Cambiar de usuario" en el overlay o al arrancar con el flag `--logout`; con `--logout` MUST terminar tras imprimir "Sesión cerrada". Un fallo de red al revocar MUST NOT impedir el borrado local.

#### Scenario: Cambio de usuario en la misma PC
- **WHEN** el agente elige "Cambiar de usuario" en "Sesión activa"
- **THEN** el refresh token se revoca, `.agent-session` se elimina y aparece el formulario vacío de usuario y contraseña

#### Scenario: Logout sin red
- **WHEN** se ejecuta `--logout` sin conexión
- **THEN** `.agent-session` se elimina igualmente y se imprime "Sesión cerrada"

### Requirement: Secretos fuera de logs y de la página
El CLI MUST NOT escribir en consola, `ana-crash.log` ni ningún archivo la contraseña, códigos MFA, claves TOTP, la sesión de desafío de Cognito, los tokens ni el header `Authorization`, y MUST NOT pasar tokens al contexto de las páginas de WhatsApp Web; la página solo recibe el resultado de cada paso.

#### Scenario: Error de red con token
- **WHEN** una llamada autenticada falla y el CLI registra el error
- **THEN** el log incluye URL y estado, pero no el token ni los headers de autorización

#### Scenario: Página inspeccionada
- **WHEN** se evalúa `window` en la página de automatización tras el login
- **THEN** no existe ninguna variable con la contraseña ni con tokens

## REMOVED Requirements

### Requirement: Verificación de credenciales contra el backend
**Reason**: El CLI ya no verifica usuario + campaña + palabra del día con `POST /auth/verify`; se autentica contra Cognito y elige campaña del roster.
**Migration**: Ver "Autenticación con Cognito", "Selección de campaña habilitada" y los desafíos MFA/contraseña nueva. Los agentes necesitan usuario en el User Pool y alta en el roster antes de recibir esta versión.
