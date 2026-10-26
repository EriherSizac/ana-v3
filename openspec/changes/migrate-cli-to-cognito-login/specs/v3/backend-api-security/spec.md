# Spec Delta

## MODIFIED Requirements

### Requirement: Llave de administración en rutas de supervisor
El sistema MUST exigir el header `X-Admin-Key` (nombre sin distinguir mayúsculas) igual a la llave configurada en el entorno, comparada en tiempo constante, en estas rutas: `POST /supervisors/agents/{agent}/{campaign}/contacts`, `POST /supervisors/files/download`, `POST /agents/{agent}/{campaign}/contacts` y `POST /templates`.

#### Scenario: Llave correcta
- **WHEN** la solicitud incluye `X-Admin-Key` igual a la llave configurada
- **THEN** el handler continúa con su validación y lógica normal

#### Scenario: Llave ausente o incorrecta
- **WHEN** el header falta o su valor difiere (incluida una longitud distinta)
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}` y `Content-Type: application/json`, sin acceder a S3

#### Scenario: Llave no configurada (fail-closed)
- **WHEN** la llave de administración del entorno está vacía o no definida
- **THEN** el sistema responde 503 con `{"success":false,"message":"Admin key no configurada"}` en todas las rutas protegidas, sin abrirlas

#### Scenario: Rutas de credenciales retiradas
- **WHEN** un cliente llama a `GET /credentials/prueba`, `POST /credentials/upload` o `POST /credentials/regenerate`, con o sin llave
- **THEN** API Gateway responde 404 sin invocar ninguna función

### Requirement: Rutas intencionalmente públicas
El sistema SHALL atender sin autenticación únicamente `GET /`. Todas las demás rutas MUST exigir `X-Admin-Key` (rutas de supervisor) o autenticación de agente (rutas del CLI).

#### Scenario: Acceso público
- **WHEN** un cliente sin `X-Admin-Key` ni token llama a `GET /`
- **THEN** el sistema responde 200 con el mensaje fijo

#### Scenario: Ruta del CLI ya no pública
- **WHEN** con el modo estricto activo un cliente sin token llama a `GET /backups/latest/erick/prueba`
- **THEN** el sistema responde 401 sin acceder a S3

## ADDED Requirements

### Requirement: Autenticación de agente en rutas del CLI
El sistema MUST aplicar la autenticación de agente de `v3/agent-auth` (ID token de Cognito, propiedad del agente y roster de la campaña, con el modo de transición) en `GET /get/chats/{agentId}/{campaignId}`, `POST /contacts/pending`, `POST /backups`, `GET /backups/latest/{agentId}/{campaign}`, `POST /backups/chat`, `GET /backups/chat/{campaign}/{agentId}/{contactPhone}`, `GET /backups/chats/{campaign}/{agentId}`, `POST /media` y `GET /templates`, antes de cualquier acceso a S3.

#### Scenario: Origen del agente y la campaña
- **WHEN** se evalúa la propiedad en cada ruta
- **THEN** se usan `agentId`/`campaign` (o `campaignId`) del path en las rutas `GET` con path, `agent_id`/`campaign` del body en `POST /backups`, `POST /backups/chat`, `POST /media` y `POST /contacts/pending`, y solo `campaign` del query string en `GET /templates`

#### Scenario: Respaldo de chat sin token en modo estricto
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y un cliente sin token envía `POST /backups/chat` con mensajes para `erick`/`prueba`
- **THEN** el sistema responde 401 y no lee ni escribe `backups/prueba/erick/...`, de modo que no se puede plantar contenido en el Historial del agente

#### Scenario: Respaldo de chat a nombre de otro agente
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y el token de `ana` envía `POST /backups/chat` con `agent_id: "erick"`
- **THEN** el sistema responde 403 con `{"error":"Forbidden"}` sin escribir en S3

#### Scenario: Campaña fuera del roster
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y el token de `erick` llama a `POST /media` con `campaign: "ventas"` donde no está habilitado
- **THEN** el sistema responde 403 sin escribir en S3

#### Scenario: Llave de administración en ruta del CLI
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y un cliente llama a `GET /get/chats/erick/prueba` solo con `X-Admin-Key` válida
- **THEN** el sistema responde 401

### Requirement: Rutas de agente sin modo de transición
El sistema MUST exigir siempre un ID token válido de `v3/agent-auth`, sin modo reporte, en las rutas bajo `/agent/`: `GET /agent/campaigns` y `GET /agent/settings` (definida por `add-cli-remote-settings`), porque ningún CLI anterior las usa.

#### Scenario: Campañas sin token en modo reporte
- **WHEN** `AGENT_AUTH_ENFORCED` es `false` y un cliente sin token llama a `GET /agent/campaigns`
- **THEN** el sistema responde 401

#### Scenario: Configuración del CLI con token válido
- **WHEN** un CLI con ID token válido llama a `GET /agent/settings`
- **THEN** la autenticación se acepta y la ruta responde según su propia especificación

### Requirement: Authorizer JWT de API Gateway en rutas de agente
El sistema SHALL adjuntar a las rutas `/agent/*` desde su creación, y a las demás rutas de agente al activar el modo estricto, un authorizer JWT de HTTP API con el emisor del User Pool de Pernexium y como audiencia la lista de app clients permitidos, que rechaza con 401 sin invocar la función las solicitudes sin token válido.

#### Scenario: Token de otra aplicación del pool
- **WHEN** con el authorizer adjunto llega un ID token del pool cuyo `aud` es el app client de otra aplicación
- **THEN** API Gateway responde 401 `{"message":"Unauthorized"}` sin invocar la función

#### Scenario: Modo reporte
- **WHEN** `AGENT_AUTH_ENFORCED` es `false`
- **THEN** las rutas de agente fuera de `/agent/*` no tienen authorizer adjunto y un CLI antiguo sin token llega al handler
