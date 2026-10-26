# Spec Delta

## MODIFIED Requirements

### Requirement: Token entregado al proceso main
Tras completar el login, y al arrancar la app si ya había sesión viva, el renderer SHALL obtener el ID token (no el access token) y entregarlo al proceso main, y MUST renovar la sesión y volver a entregarlo al menos 5 minutos antes de que expire. Las llamadas del renderer al backend MUST enviar `Authorization: Bearer <id token>` obtenido en cada llamada, y omitir el encabezado si no hay sesión.

#### Scenario: Reapertura con sesión guardada
- **WHEN** el operador reabre la app y Amplify conserva una sesión válida
- **THEN** la app no pide login, re-entrega el token al main y carga `/me`

#### Scenario: Sin sesión
- **WHEN** no hay usuario actual o no hay ID token
- **THEN** la app muestra la pantalla de login

#### Scenario: Jornada de más de una hora
- **WHEN** el operador trabaja 3 horas seguidas sin cerrar la app
- **THEN** el main siempre tiene un ID token vigente y el poller, los respaldos y los reportes al CRM siguen funcionando

## ADDED Requirements

### Requirement: Solicitud de token desde el main
Antes de cada llamada al backend, si al ID token le quedan menos de 2 minutos de vida, el main SHALL pedir un token nuevo al renderer y esperarlo hasta 10 segundos. Ante una respuesta 401 del backend, el main MUST pedir un token nuevo y reintentar esa llamada una sola vez.

#### Scenario: Token a punto de vencer
- **WHEN** al token le quedan 90 segundos y el poller va a consultar jobs
- **THEN** el main obtiene un token renovado y la consulta sale con él

#### Scenario: 401 aislado
- **WHEN** el backend responde 401 a un `PUT /messages`
- **THEN** el main pide token nuevo, reintenta una vez y el mensaje queda persistido

### Requirement: Sesión expirada
Si la sesión no puede renovarse, la app SHALL volver a la pantalla de login con el aviso "Tu sesión expiró. Vuelve a iniciar sesión." y el main MUST detener el poller y el heartbeat sin borrar la sesión local de WhatsApp. Si vuelve a entrar el mismo operador, WhatsApp SHALL reconectar sin QR.

#### Scenario: Refresh token revocado
- **WHEN** un administrador revoca la sesión del operador en Cognito
- **THEN** en la siguiente renovación la app muestra el login con el aviso de sesión expirada

#### Scenario: Mismo operador vuelve a entrar
- **WHEN** tras la expiración el mismo operador inicia sesión
- **THEN** WhatsApp se reconecta con la sesión local existente, sin pedir QR
