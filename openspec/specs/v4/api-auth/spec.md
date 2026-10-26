# api-auth Specification

## Purpose
Definir cómo se autentican las llamadas al backend v4 de ANA (HTTP API de AWS, Serverless Framework v4, servicio `ana-backend`, región por defecto `us-east-2`): JWT de Cognito validado por el authorizer de API Gateway en todas las rutas salvo `POST /send`, identidad del operador derivada del token, formato común de errores y CORS.

> Nota: la región por defecto del stack v4 es `us-east-2` (v3 vive en `us-east-1`), el stage por defecto es `dev` y el perfil AWS `pernexium` está fijado en `serverless.yml`. El User Pool y el client id por defecto (`us-east-2_UepfOyKpd` / `1r6niimhkl2fmias6kk85n4ou4`) están embebidos como valores por defecto de parámetros de despliegue.

## Requirements

### Requirement: Authorizer JWT de Cognito en rutas de usuario
El sistema MUST proteger todas las rutas HTTP excepto `POST /send` con un authorizer JWT de API Gateway que lee el header `Authorization`, valida el emisor (`issuer`, User Pool de Pernexium) y la audiencia (`clientId`). Las solicitudes sin token válido SHALL ser rechazadas por API Gateway antes de llegar a la Lambda.

#### Scenario: Token ausente
- **WHEN** se llama `GET /conversations` sin header `Authorization`
- **THEN** API Gateway responde 401 y la Lambda no se invoca

#### Scenario: Access token en lugar de id token
- **WHEN** se envía un access token de Cognito (que no trae claim `aud`)
- **THEN** el authorizer lo rechaza con 401, por lo que los clientes MUST enviar el id token

### Requirement: Identidad del operador desde el token
Cada handler autenticado SHALL tomar el identificador del operador (`operatorId`) del claim `cognito:username` del JWT y, si falta, del claim `sub`. Si ninguno está presente, el handler MUST responder 401 con `{"error":"no autenticado"}`. El cliente no puede elegir su `operatorId` en ninguna ruta de escritura.

#### Scenario: Claim presente
- **WHEN** llega una solicitud autorizada con `cognito:username = "juan.perez"`
- **THEN** todos los datos leídos o escritos se particionan bajo `operatorId = "juan.perez"`

#### Scenario: Sin claims de usuario
- **WHEN** la solicitud llega a la Lambda sin `cognito:username` ni `sub`
- **THEN** el sistema responde 401 con `{"error":"no autenticado"}`

### Requirement: Formato común de respuestas y errores
El sistema SHALL responder JSON con `content-type: application/json`; los errores MUST tener la forma `{"error":"<mensaje>"}`. Una ruta no reconocida por el handler SHALL responder 404 `{"error":"ruta no manejada: <routeKey>"}` y cualquier excepción no controlada, incluido un body JSON inválido, SHALL responder 500 `{"error":"error interno"}` sin detalle interno.

#### Scenario: Body JSON inválido
- **WHEN** se envía `PUT /messages` con un body que no es JSON parseable
- **THEN** el sistema responde 500 con `{"error":"error interno"}` (no 400)

#### Scenario: Error interno
- **WHEN** falla una llamada a DynamoDB dentro de un handler
- **THEN** el sistema responde 500 con `{"error":"error interno"}` y registra el detalle solo en CloudWatch

### Requirement: Autenticación por API key en POST /send
La ruta `POST /send` SHALL publicarse sin authorizer Cognito y MUST autenticarse comparando el header `x-api-key` con la variable de entorno `SEND_API_KEY`; si la variable está vacía o el header no coincide, MUST responder 401 `{"error":"no autorizado"}` (fail-closed).

#### Scenario: Key incorrecta
- **WHEN** se llama `POST /send` con un `X-Api-Key` distinto al configurado
- **THEN** el sistema responde 401 con `{"error":"no autorizado"}`

#### Scenario: Key no configurada en el backend
- **WHEN** `SEND_API_KEY` está vacía en el entorno de la Lambda
- **THEN** toda llamada a `POST /send` responde 401, aunque traiga un header `X-Api-Key`

> Nota: la comparación de la key no es de tiempo constante, no hay rate limit y la key no se asocia a ningún agente concreto. El valor real de `SEND_API_KEY` está expuesto en texto plano en `v4/ENVIO_DIRECTO.md` (versionado en el repo) y debería rotarse.

### Requirement: CORS abierto en la HTTP API y buckets
El sistema SHALL habilitar CORS con la configuración por defecto de Serverless para HTTP API (`cors: true`, cualquier origen). Los buckets de CSV y media MUST permitir CORS `GET` y `PUT` desde cualquier origen con cualquier header y exponer `ETag`, para subidas y descargas por URL prefirmada desde el navegador o el desktop.

#### Scenario: Subida desde la app
- **WHEN** la app hace `PUT` a una URL prefirmada del bucket `ana-backend-csv-<stage>` desde otro origen
- **THEN** S3 acepta la solicitud CORS y devuelve el header `ETag` legible

### Requirement: Buckets privados y firmas cortas
Los buckets `ana-backend-csv-<stage>` y `ana-backend-media-<stage>` MUST bloquear todo acceso público; el acceso a objetos SHALL hacerse solo mediante URLs prefirmadas que expiran a los 300 segundos, generadas sin checksum CRC32 automático para no romper la firma en PUT desde navegador.

#### Scenario: URL prefirmada vencida
- **WHEN** un cliente usa una URL prefirmada más de 300 segundos después de emitida
- **THEN** S3 rechaza la solicitud
