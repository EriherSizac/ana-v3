# Spec Delta

## MODIFIED Requirements

### Requirement: Rutas intencionalmente públicas
El sistema SHALL atender sin autenticación las rutas usadas por el CLI de agentes: `GET /`, `POST /auth/verify`, `POST /backups`, `GET /backups/latest/{agentId}/{campaign}`, `POST /backups/chat`, `GET /backups/chat/{campaign}/{agentId}/{contactPhone}`, `GET /backups/chats/{campaign}/{agentId}`, `GET /get/chats/{agentId}/{campaignId}`, `POST /media`, `POST /contacts/pending` y `GET /templates`.

#### Scenario: Acceso público
- **WHEN** un cliente sin `X-Admin-Key` llama a `GET /backups/latest/{agentId}/{campaign}`
- **THEN** el sistema procesa la solicitud y responde según la lógica de la ruta (200/404/500)

## ADDED Requirements

### Requirement: Llave de administración en consultas de supervisor
El sistema MUST exigir `X-Admin-Key` con la misma validación que las demás rutas de supervisor (comparación en tiempo constante, 401 si falta o difiere, 503 si no está configurada) en `GET /supervisors/agents/{agent}/{campaign}/contacts`, `GET /supervisors/assignments/agents/{agent}/{campaign}` y `GET /supervisors/assignments/agents/{agent}/{campaign}/contacts`, antes de acceder a S3.

#### Scenario: Consulta sin llave
- **WHEN** un cliente sin `X-Admin-Key` llama a `GET /supervisors/assignments/agents/{agent}/{campaign}`
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}` sin listar objetos en S3

#### Scenario: Consulta con llave válida
- **WHEN** un supervisor llama a `GET /supervisors/agents/{agent}/{campaign}/contacts` con `X-Admin-Key` correcta
- **THEN** el handler continúa con su lógica normal (200/404/500)

#### Scenario: Llave no configurada
- **WHEN** la llave de administración del entorno está vacía
- **THEN** las tres consultas responden 503 con `{"success":false,"message":"Admin key no configurada"}`
