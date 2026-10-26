# Spec Delta

## ADDED Requirements

### Requirement: Verificación del ID token de Cognito
En las rutas de agente, el sistema SHALL autenticar la solicitud solo con el header `Authorization: Bearer <token>` (nombre sin distinguir mayúsculas) cuyo token sea un ID token del User Pool de Pernexium configurado: firma válida contra las llaves públicas del pool, `iss` igual al emisor del pool, `token_use` igual a `id`, `aud` incluido en la lista de app clients permitidos y `exp` no vencido.

#### Scenario: Token válido del CLI
- **WHEN** el CLI envía un ID token vigente emitido por el pool para el app client del CLI
- **THEN** la solicitud queda autenticada con la identidad del token

#### Scenario: Sin token
- **WHEN** la solicitud no trae header `Authorization` o no usa el esquema `Bearer`
- **THEN** la solicitud se considera no autenticada con motivo `missing`

#### Scenario: Token vencido o alterado
- **WHEN** el token tiene `exp` vencido, una firma que no corresponde a las llaves del pool o un formato no reconocido
- **THEN** la solicitud se considera no autenticada con motivo `expired` o `invalid` respectivamente

#### Scenario: Access token o cliente no permitido
- **WHEN** se presenta un access token (`token_use` = `access`), un token de otro pool o un ID token cuyo `aud` no está en la lista permitida (p. ej. el app client de otra aplicación)
- **THEN** la solicitud se considera no autenticada con motivo `invalid` o `wrong_client`

### Requirement: Identidad del agente derivada del token
El sistema SHALL tomar como identificador del agente el claim `cognito:username` del token, sin espacios laterales y en minúsculas, y MUST exigir que el agente indicado por la ruta (path o body, según la ruta) coincida con él una vez normalizados ambos lados; `X-Admin-Key` MUST NOT sustituir al token en estas rutas.

#### Scenario: Agente propio
- **WHEN** el token de `Erick` llama a `GET /get/chats/erick/prueba`
- **THEN** la identidad coincide y la solicitud continúa a la verificación de roster

#### Scenario: Agente ajeno
- **WHEN** el token de `erick` llama a una ruta de agente con agente `ana` en el path o `agent_id: "ana"` en el body
- **THEN** la solicitud se considera no autorizada con motivo `mismatch`

#### Scenario: Llave de administración en ruta de agente
- **WHEN** una solicitud a una ruta de agente trae solo `X-Admin-Key` válida
- **THEN** se trata igual que una solicitud sin token (motivo `missing`)

### Requirement: Autorización por roster de campaña
El sistema SHALL autorizar una solicitud autenticada solo si el agente está habilitado en la campaña de la ruta según la regla efectiva de `v3/agent-roster` (agente derivado de sus roles y sin excepción `enabled:false`), comparando la campaña sin espacios laterales y en minúsculas. Una campaña sin lista derivada MUST tratarse como sin agentes. Las excepciones MUST aplicarse en 60 segundos o menos.

#### Scenario: Agente habilitado
- **WHEN** `erick` figura en la lista derivada de `prueba` sin excepción y llama a una ruta de agente de `prueba`
- **THEN** la solicitud queda autorizada y el handler continúa

#### Scenario: Agente no habilitado o deshabilitado
- **WHEN** `erick` no figura en la lista derivada de `ventas` (sin rol de envío), tiene excepción `enabled:false`, o `ventas` no tiene lista derivada
- **THEN** la solicitud se considera no autorizada con motivo `not_in_roster`

#### Scenario: Agente deshabilitado durante la jornada
- **WHEN** un supervisor deshabilita a `erick` en `prueba` mientras su CLI está en uso
- **THEN** a más tardar 60 segundos después sus solicitudes a rutas de `prueba` se consideran no autorizadas

#### Scenario: Roster ilegible
- **WHEN** la lectura de la lista derivada o del roster falla por un error distinto de objeto inexistente, o la lista está vencida
- **THEN** la solicitud se considera no autorizada con motivo `roster_error`

### Requirement: Modo de transición de la autenticación de agente
El sistema SHALL leer `AGENT_AUTH_ENFORCED`; si no vale `true` (modo reporte), una solicitud no autenticada o no autorizada MUST atenderse como antes. Si vale `true` (modo estricto), MUST responder 401 `{"error":"Unauthorized"}` si no está autenticada y 403 `{"error":"Forbidden"}` si no está autorizada, en ambos casos sin acceder a datos del agente en S3.

#### Scenario: Modo reporte con CLI antiguo
- **WHEN** `AGENT_AUTH_ENFORCED` es `false` o no está definida y un CLI antiguo llama sin token
- **THEN** la solicitud se procesa como antes del cambio

#### Scenario: Modo estricto sin token
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y la solicitud no trae token válido
- **THEN** el sistema responde 401 (`{"error":"Unauthorized"}` desde el handler, o `{"message":"Unauthorized"}` desde el authorizer de API Gateway)
- **AND** no lee, lista, escribe ni borra objetos del agente en S3

#### Scenario: Modo estricto con agente ajeno o fuera del roster
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y el token es válido pero el motivo es `mismatch`, `not_in_roster` o `roster_error`
- **THEN** el sistema responde 403 con `{"error":"Forbidden"}` sin acceder a los datos del agente

### Requirement: Configuración obligatoria en modo estricto
En modo estricto, si falta el identificador del User Pool o la lista de app clients permitidos, el sistema MUST responder 503 con `{"error":"Agent auth not configured"}` en todas las rutas de agente sin importar el header enviado (fail-closed).

#### Scenario: Pool no configurado
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y `COGNITO_USER_POOL_ID` o `COGNITO_AGENT_CLIENT_IDS` está vacío
- **THEN** cualquier ruta de agente responde 503 con `{"error":"Agent auth not configured"}`

### Requirement: Registro de decisiones de autenticación de agente
El sistema SHALL registrar por cada solicitud a una ruta de agente una línea JSON con `evt:"agent_auth"`, modo, ruta, motivo (`ok`, `missing`, `invalid`, `expired`, `wrong_client`, `mismatch`, `not_in_roster`, `roster_error`), agente y campaña de la solicitud, usuario del token si lo hay y versión del CLI del header `X-Ana-Cli-Version` (o `unknown`). El registro MUST NOT contener el token ni el header `Authorization`.

#### Scenario: CLI antiguo en modo reporte
- **WHEN** un CLI sin token llama a `POST /backups` en modo reporte
- **THEN** el log contiene `{"evt":"agent_auth","mode":"report","reason":"missing","cliVersion":"unknown",...}` con agente y campaña del body

#### Scenario: Token nunca en logs
- **WHEN** cualquier solicitud con `Authorization: Bearer <token>` se registra
- **THEN** ninguna línea de log contiene el valor del token

### Requirement: Consulta de campañas habilitadas del agente
El sistema SHALL exponer `GET /agent/campaigns`, que siempre exige un ID token válido (sin modo reporte) y responde 200 con `{"username":<agente>,"campaigns":[<campaña>...]}`: las campañas, en minúsculas y orden alfabético, donde el agente del token está habilitado según la regla efectiva de `v3/agent-roster`.

#### Scenario: Agente con dos campañas
- **WHEN** `erick` está habilitado en `ventas` y `prueba` y deshabilitado por excepción en `cobranza`
- **THEN** la respuesta es `{"username":"erick","campaigns":["prueba","ventas"]}`

#### Scenario: Agente sin campañas
- **WHEN** el agente del token no está habilitado en ninguna campaña
- **THEN** el sistema responde 200 con `campaigns` vacío

#### Scenario: Sin token válido
- **WHEN** la solicitud no trae un ID token válido, aun en modo reporte
- **THEN** el sistema responde 401 sin leer rosters

## REMOVED Requirements

### Requirement: Endpoint de verificación de credenciales
**Reason**: La palabra del día se elimina; el CLI se autentica directamente contra Cognito y el backend verifica el ID token en cada solicitud.
**Migration**: Los CLIs actualizados usan el login Cognito (`v3/cli-agent-session`). `POST /auth/verify` se mantiene durante la transición y se retira cuando, con el modo estricto activo, no registra invocaciones durante 5 días hábiles; después responde 404 de API Gateway.

### Requirement: Validación de campos de entrada
**Reason**: Pertenecía a `POST /auth/verify`, que se retira.
**Migration**: Sin reemplazo; la validación de usuario y contraseña la hace Cognito.

### Requirement: Fuente de credenciales por campaña
**Reason**: `agents/{campaign}/credentials.csv` deja de ser fuente de identidad; la pertenencia a una campaña la define el roster (`v3/agent-roster`).
**Migration**: Antes del release del CLI, cada agente necesita usuario en el User Pool y un rol de su campaña con `ana:campaign:message:send`; los agentes legados no se trasladan. Al retirar la ruta, los `credentials.csv` se archivan en el bucket de archivo (tras extraer solo los usernames a `legacy/agents/`) y se borran del bucket de datos.

### Requirement: Comparación de usuario y palabra del día
**Reason**: La palabra del día se elimina.
**Migration**: La contraseña (y MFA) del usuario en Cognito reemplaza la frase diaria.

### Requirement: Errores internos
**Reason**: Pertenecía a `POST /auth/verify`, que se retira.
**Migration**: Los errores de autenticación de agente se definen en "Modo de transición de la autenticación de agente" y "Configuración obligatoria en modo estricto".
