# Spec Delta

## ADDED Requirements

### Requirement: Authorizer JWT en rutas de administración
El sistema SHALL adjuntar a toda ruta bajo `/admin/` un authorizer JWT de HTTP API con emisor `https://cognito-idp.us-east-2.amazonaws.com/us-east-2_UepfOyKpd` y como audiencia la lista de app clients de ANA Admin configurada, que rechaza con 401 sin invocar la función las solicitudes sin ID token válido. `X-Admin-Key` MUST NOT sustituir al token en estas rutas.

#### Scenario: Sin token
- **WHEN** se llama a `POST /admin/campaigns/prueba/roster/agents` sin header `Authorization`
- **THEN** API Gateway responde 401 `{"message":"Unauthorized"}` y la función no se ejecuta

#### Scenario: Token del CLI de agentes
- **WHEN** llega un ID token válido del pool cuyo `aud` es el app client del CLI y no uno de ANA Admin
- **THEN** API Gateway responde 401

#### Scenario: Solo llave de administración
- **WHEN** la solicitud trae `X-Admin-Key` válida pero ningún token
- **THEN** API Gateway responde 401

### Requirement: Autorización por permisos ANA en rutas de administración
Los handlers de `/admin/*` SHALL resolver el acceso del usuario llamando a v4 `GET /me` con el mismo ID token (timeout 5 s, caché por usuario de hasta 60 s sin cachear errores) y decidir con `permissions`, `campaigns` e `isAdmin`, sin depender de ningún flag de enforcement. Si v4 falla MUST responder 503 `{"success":false,"message":"Autorización no disponible"}` sin acceder a S3.

#### Scenario: Permiso presente
- **WHEN** v4 `GET /me` devuelve `ana:admin:agents:manage` y la campaña `prueba` para el usuario
- **THEN** el handler de roster de `prueba` continúa

#### Scenario: v4 caído
- **WHEN** v4 `GET /me` no responde en 5 segundos
- **THEN** el sistema responde 503 y no lee ni escribe en S3

#### Scenario: Sin permiso
- **WHEN** el usuario no es admin ni tiene el permiso que exige la ruta
- **THEN** el sistema responde 403 con `{"success":false,"message":"Sin permiso"}`

### Requirement: Errores de rutas de administración sin detalle interno
Las respuestas de error de `/admin/*` SHALL tener la forma `{"success":false,"message":<texto>}` y MUST NOT incluir trazas, mensajes de AWS ni el token; el detalle se registra solo en logs, sin el header `Authorization`.

#### Scenario: Fallo de S3
- **WHEN** S3 responde AccessDenied en una ruta `/admin/*`
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor"}` sin campo `error`
