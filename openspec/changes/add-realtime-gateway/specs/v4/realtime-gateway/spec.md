# Spec Delta

## Purpose

Ofrecer a los clientes de ANA (desktop v4, CLI v3 y ANA Admin) un canal WebSocket único y autenticado por el que el backend avisa, sin datos de contactos, que algo cambió, para que el cliente vuelva a leer por REST y el polling quede solo como respaldo.

## ADDED Requirements

### Requirement: Endpoint WebSocket único
El sistema SHALL exponer una sola API WebSocket por stage en us-east-2, con la URL por defecto de execute-api (sin dominio propio) publicada como salida `RealtimeWsUrl`, que sirve a los tres tipos de cliente. El cliente MUST declarar su tipo en el query string `client` (`desktop`, `cli` o `admin`) y su versión en `v`; un tipo ausente o desconocido se rechaza en `$connect`.

#### Scenario: Tipo de cliente válido
- **WHEN** el desktop abre `wss://<api>/prod?client=desktop&v=1.4.0` con un token válido
- **THEN** la conexión se acepta y queda registrada como `desktop` versión `1.4.0`

#### Scenario: Tipo desconocido
- **WHEN** un cliente abre la conexión con `client=bot`
- **THEN** el handshake falla con 403 y no se registra ninguna conexión

### Requirement: Autenticación con el ID token en el subprotocolo
`$connect` SHALL exigir el header `Sec-WebSocket-Protocol` con exactamente `ana.v1, <idToken>`, validar el token como ID token del pool `us-east-2_UepfOyKpd` y cliente `1r6niimhkl2fmias6kk85n4ou4` (firma, `exp`, `token_use=id`) y aceptar respondiendo el subprotocolo `ana.v1`. El token MUST NOT aceptarse en el query string.

#### Scenario: Token válido
- **WHEN** el cliente ofrece `ana.v1, <idToken vigente>`
- **THEN** el handshake responde 101 con `Sec-WebSocket-Protocol: ana.v1`

#### Scenario: Token expirado o de acceso
- **WHEN** el cliente ofrece un ID token expirado o un access token
- **THEN** el handshake falla con 403 y se cuenta `ConnectRejected` con razón `expired` o `invalid_token`

#### Scenario: Sin subprotocolo
- **WHEN** el cliente se conecta sin `Sec-WebSocket-Protocol`
- **THEN** el handshake falla con 401 sin invocar ninguna Lambda de conexión

### Requirement: Chequeo de origen
Si el handshake trae header `Origin`, `$connect` SHALL aceptarlo solo si está en la lista permitida del stage (prod: `https://ana-admin.pernexium.com.mx`; dev además `http://localhost:3000`); un origen distinto MUST rechazarse con 403. Las conexiones `client=admin` MUST traer un `Origin` permitido.

#### Scenario: Página ajena con un token robado
- **WHEN** una página en `https://evil.example` intenta conectarse con un token válido
- **THEN** el handshake falla con 403 y se cuenta `ConnectRejected` con razón `origin`

#### Scenario: Desktop sin Origin
- **WHEN** el main del desktop se conecta sin header `Origin`
- **THEN** el origen no impide la conexión

### Requirement: Suscripciones derivadas de la identidad
Al aceptar, el sistema SHALL suscribir la conexión al tema del usuario (`cognito:username` canónico), al tema de su tipo de cliente y, solo si `client=admin`, a los temas de eventos de las campañas de su acceso v4 (`*` = todas). Toda conexión SHALL registrarse además con las campañas y los roles de su acceso v4 para la actualización forzada. El cliente MUST NOT poder elegir ni ampliar sus suscripciones.

#### Scenario: Agente en el CLI
- **WHEN** `jperez` conecta con `client=cli`
- **THEN** recibe eventos dirigidos a `jperez` y a los CLIs, ninguno de campaña, y queda registrada con las campañas y roles de `jperez` para la actualización forzada

#### Scenario: Supervisor en ANA Admin
- **WHEN** un supervisor con campañas `prueba` y `zendere` conecta con `client=admin`
- **THEN** recibe además los eventos de campaña de `prueba` y `zendere`, y no los de otras campañas

### Requirement: Acceso no disponible al conectar
Si el acceso v4 no se puede resolver en `$connect`, una conexión `admin` MUST rechazarse (razón `access_error`) y una `desktop` o `cli` SHALL aceptarse solo con sus temas de usuario y de tipo, marcada con acceso desconocido.

#### Scenario: API de Roles no disponible al conectar el CLI
- **WHEN** `jperez` conecta con `client=cli` y la resolución de su acceso falla
- **THEN** la conexión se acepta con sus temas de usuario y de tipo, marcada con acceso desconocido

#### Scenario: API de Roles no disponible al conectar ANA Admin
- **WHEN** un supervisor conecta con `client=admin` y la resolución de su acceso falla
- **THEN** el handshake falla y se cuenta `ConnectRejected` con razón `access_error`

### Requirement: Registro y limpieza de conexiones
Cada conexión aceptada SHALL registrarse con usuario, tipo, versión, hora de conexión, `exp` del token y un TTL de 3 horas. `$disconnect` MUST borrar la conexión y sus suscripciones; un envío que reciba 410 (Gone) MUST borrarlas también.

#### Scenario: Cierre normal
- **WHEN** el cliente cierra el socket
- **THEN** su conexión y suscripciones desaparecen del registro

#### Scenario: Cliente desaparecido sin cerrar
- **WHEN** un envío a una conexión registrada responde 410
- **THEN** la conexión se borra y se cuenta `PostGone`

### Requirement: Token vencido durante la conexión
El sistema SHALL dejar de entregar eventos a una conexión cuyo token venció hace más de 5 minutos y MUST cerrarla en ese momento, para que el cliente reconecte con un token renovado.

#### Scenario: Token vencido
- **WHEN** hay un evento para una conexión cuyo token venció hace 6 minutos
- **THEN** el evento no se le entrega y la conexión se cierra

### Requirement: Latido
La ruta `ping` (`{"action":"ping"}`) SHALL responder a la misma conexión `{"type":"pong","at":<ms>,"exp":<ms del token>}`. Los clientes MUST enviar `ping` al conectar y cada 5 minutos, por debajo del corte de 10 minutos de inactividad de API Gateway.

#### Scenario: Ping
- **WHEN** un cliente conectado envía `{"action":"ping"}`
- **THEN** recibe `pong` con la hora del servidor y el vencimiento de su token

#### Scenario: Acción desconocida
- **WHEN** un cliente envía `{"action":"subscribe"}`
- **THEN** recibe `{"type":"error","code":"unknown_action"}` y sus suscripciones no cambian

### Requirement: Duración máxima y reconexión planeada
Dado que API Gateway corta toda conexión a las 2 horas, los clientes SHALL reconectar por iniciativa propia a más tardar a los 110 minutos o al renovar el token, abriendo la conexión nueva antes de cerrar la anterior.

#### Scenario: Conexión de larga duración
- **WHEN** una conexión cumple 110 minutos
- **THEN** el cliente abre otra, la ve aceptada y cierra la anterior sin perder eventos de ese intervalo

### Requirement: Sobre de eventos sin datos
Todo evento SHALL ser JSON `{"v":1,"type","id","at","campaign"?,"ref"?}` de máximo 1 KB, donde `ref` solo trae ids opacos (`uploadId`, `srcKey`, `scope`). Un evento MUST NOT contener teléfonos, nombres, filas, plantillas, mensajes ni tokens.

#### Scenario: Jobs nuevos
- **WHEN** se crean jobs para `jperez` en la campaña `prueba`
- **THEN** `jperez` recibe `{"v":1,"type":"jobs.changed","id":"<uuid>","at":<ms>,"campaign":"prueba"}` sin datos de los contactos

### Requirement: Catálogo de eventos v1
El sistema SHALL emitir solo `jobs.changed`, `assignment.pending`, `assignment.published` y `publications.changed` (al usuario), `uploads.changed`, `review.changed` y `roster.changed` (a la campaña) `settings.changed` con `ref.scope` `cli` o `desktop` (a ese tipo de cliente y a `admin`) y el mensaje de control `session.refresh` (a las conexiones de una actualización forzada). Los clientes MUST ignorar tipos que no conozcan.

#### Scenario: Tipo futuro
- **WHEN** un cliente recibe `{"v":1,"type":"chat.changed"}`
- **THEN** lo ignora sin cerrar la conexión ni consultar nada

### Requirement: Entrega de mejor esfuerzo
La entrega SHALL ser a lo más una vez, sin orden garantizado y sin reenvío a conexiones posteriores; un evento con más de 60 segundos de antigüedad MUST descartarse. Los clientes tratan cada evento solo como pista para leer por REST.

#### Scenario: Cliente desconectado durante el evento
- **WHEN** se publica un evento mientras el destinatario está reconectando
- **THEN** no se le reenvía después; el cliente se pone al día con la lectura REST que hace al reconectar

### Requirement: Autorización solo en REST
Recibir un evento MUST NOT conceder acceso a ningún dato: la lectura que dispara el cliente pasa por las rutas REST existentes con su token y sus reglas de permisos, roster y campaña.

#### Scenario: Acceso revocado con conexión abierta
- **WHEN** a un supervisor le quitan una campaña y recibe un `review.changed` de ella
- **THEN** su lectura REST de esa campaña responde 403 como hoy

### Requirement: Publicación sin afectar la operación
Los handlers v4 SHALL publicar sus eventos de forma asíncrona y acotada (máximo 1 s); un fallo al publicar MUST registrarse y contarse, sin cambiar la respuesta ni el resultado de la operación que lo originó.

#### Scenario: Bus no disponible
- **WHEN** `POST /jobs/reassign` termina pero la publicación del evento falla
- **THEN** la respuesta es la misma que sin realtime y se cuenta `EmitFailed`

### Requirement: Eventos de jobs v4
El sistema SHALL emitir `jobs.changed` al operador cuando `csvTrigger` le crea jobs, cuando `POST /send` crea jobs directos y cuando `jobs/reassign` o `jobs/review/resolve` le quitan o le asignan jobs (a ambos operadores).

#### Scenario: Reparto de un CSV
- **WHEN** un CSV de `prueba` reparte jobs a `ana` y `beto`
- **THEN** cada uno recibe un `jobs.changed` con `campaign: "prueba"`

#### Scenario: Reasignación
- **WHEN** un supervisor reasigna jobs por revisar de `ana` a `beto`
- **THEN** `ana` y `beto` reciben `jobs.changed`

### Requirement: Eventos de campaña v4
El sistema SHALL emitir a la campaña `uploads.changed` (con `ref.uploadId`) cuando `csvTrigger` registra una carga procesada o rechazada y cuando `jobs/ack` cambia el avance de una carga (máximo uno por carga cada 10 s), `review.changed` cuando cambian contactos por revisar por reasignación o resolución, y `roster.changed` tras `POST /admin/agent-roster`.

#### Scenario: Avance de envío
- **WHEN** el desktop acusa 3 jobs de la misma carga en 5 segundos
- **THEN** la campaña recibe un solo `uploads.changed` con ese `uploadId` en esa ventana de 10 s

### Requirement: Evento de configuración del desktop
Un `PUT /admin/desktop-settings` exitoso SHALL emitir `settings.changed` con `ref.scope: "desktop"` a todos los desktops y conexiones `admin`.

#### Scenario: Cambio de ritmo
- **WHEN** un Developer guarda `sendMinGapSeconds: 180`
- **THEN** cada desktop conectado recibe `settings.changed` con `scope: "desktop"`

### Requirement: Señal de actualización de acceso
En una actualización forzada, el sistema SHALL enviar a cada conexión afectada `{"v":1,"type":"session.refresh","id","at","ref":{"reason"}}` con `reason` `permissions`, `roster`, `settings` o `manual` y MUST cerrarla enseguida. Los clientes, al recibirlo, SHALL cerrar con código 4001, volver a leer su acceso (`/me` o su equivalente) y su estado por REST y reconectar tras una espera aleatoria de 0 a 10 s que no cuenta como fallo de conexión.

#### Scenario: Conexión forzada
- **WHEN** se fuerza la actualización de `jperez`
- **THEN** cada conexión de `jperez` recibe `session.refresh` y queda cerrada por el servidor

#### Scenario: Reconexión tras la señal
- **WHEN** un cliente recibe `session.refresh` con `reason: "permissions"`
- **THEN** vuelve a leer su acceso y su estado y reconecta en máximo 10 s sin aumentar su espera de backoff

### Requirement: Actualización forzada automática
Sin bloquear ni cambiar la respuesta de la operación que la origina, el sistema SHALL forzar la actualización de las conexiones con el rol (más las de acceso desconocido) tras un `PUT /admin/role-permissions/{roleId}` exitoso, de las de cada agente del cuerpo tras un `POST /admin/agent-roster` exitoso y de todas las `desktop` tras un `PUT /admin/desktop-settings` exitoso. Los cambios de roster y de configuración del CLI en v3 se fuerzan vía el puente (`v3/realtime-bridge`).

#### Scenario: Permisos de un rol editados
- **WHEN** un admin guarda permisos nuevos para el rol `r-123`
- **THEN** las conexiones registradas con `r-123` y las de acceso desconocido reciben `session.refresh` con `reason: "permissions"`, y las demás siguen abiertas

#### Scenario: Agente deshabilitado en el roster v4
- **WHEN** un supervisor deshabilita a `jperez` en `prueba` con `POST /admin/agent-roster`
- **THEN** las conexiones de `jperez` reciben `session.refresh` con `reason: "roster"` y la campaña recibe `roster.changed`

#### Scenario: Configuración del desktop guardada
- **WHEN** un Developer guarda la configuración del desktop
- **THEN** los admins reciben `settings.changed` y cada desktop conectado recibe `session.refresh` con `reason: "settings"`

#### Scenario: Fallo al pedir la actualización
- **WHEN** `PUT /admin/role-permissions/{roleId}` guarda los permisos pero la publicación al bus falla
- **THEN** la respuesta es la misma que sin realtime y se cuenta `EmitFailed`

### Requirement: Actualización forzada manual
`POST /admin/realtime/refresh` SHALL aceptar `{"scope":"user","username"}`, `{"scope":"campaign","campaign"}` o `{"scope":"all"}`, forzar la actualización de las conexiones de ese usuario, de los usuarios con esa campaña en su acceso o de todas, y responder 202. MUST exigir `ana:admin:console:manage` o superadmin sin depender de `PERMISSIONS_ENFORCED` (403 en otro caso), rechazar con 400 un alcance inválido o sin destino, y registrar quién la pidió, el alcance y el destino.

#### Scenario: Admin fuerza a un usuario
- **WHEN** un admin envía `{"scope":"user","username":"JPerez"}`
- **THEN** responde 202 y las conexiones de `jperez` reciben `session.refresh` con `reason: "manual"`

#### Scenario: Admin fuerza una campaña
- **WHEN** un admin envía `{"scope":"campaign","campaign":"Prueba"}`
- **THEN** se fuerzan las conexiones de los usuarios con `prueba` en su acceso, y no las de usuarios cuyo acceso es `*` ni las de otras campañas

#### Scenario: Admin fuerza a todos
- **WHEN** un admin envía `{"scope":"all"}`
- **THEN** todas las conexiones `desktop`, `cli` y `admin` reciben `session.refresh` y se cierran

#### Scenario: Supervisor sin permiso de consola
- **WHEN** un supervisor sin `ana:admin:console:manage` llama la ruta
- **THEN** responde 403 y no se fuerza ninguna conexión

#### Scenario: Alcance inválido
- **WHEN** un admin envía `{"scope":"user"}` sin `username`
- **THEN** responde 400

### Requirement: Interruptor de realtime
Con `realtimeEnabled=false` el sistema SHALL rechazar todo `$connect` con 403 (razón `disabled`), descartar los eventos y cerrar las conexiones abiertas en máximo 5 minutos, sin afectar ninguna ruta REST.

#### Scenario: Apagado de emergencia
- **WHEN** se despliega `realtimeEnabled=false`
- **THEN** en máximo 5 minutos no queda ninguna conexión abierta y los clientes siguen operando con su polling rápido

### Requirement: Métricas y alarmas
El sistema SHALL publicar en `AnaRealtime` las métricas `ConnectAccepted` y `ActiveConnections` (por tipo de cliente, cada 5 min), `ConnectRejected` (por razón), `EventsEmitted` (por tipo), `PostOk`, `PostGone`, `PostFailed`, `EmitFailed` y `ForcedClosed` (por razón), y MUST alarmar si `PostFailed` supera 5 % de los envíos durante 15 minutos o si la Lambda de reparto falla.

#### Scenario: Fallo de envíos
- **WHEN** más del 5 % de los `PostToConnection` fallan durante 15 minutos
- **THEN** la alarma `ana-backend-<stage>-realtime-post-failing` pasa a ALARM

### Requirement: Logs sin secretos
Los logs del gateway y del reparto MUST NOT incluir tokens, el header `Sec-WebSocket-Protocol` ni datos de contactos; solo connectionId, usuario, tipo y versión de cliente, tipo de evento, campaña, conteos y códigos de error.

#### Scenario: Conexión rechazada
- **WHEN** se rechaza un token inválido
- **THEN** el log registra razón, tipo de cliente y versión, sin el token
