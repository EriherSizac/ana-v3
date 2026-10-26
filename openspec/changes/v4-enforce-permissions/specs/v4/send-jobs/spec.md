# Spec Delta

## ADDED Requirements

### Requirement: Permiso de envío en la cola del agente
`GET /jobs/poll`, `POST /jobs/ack` y la reserva de jobs MUST requerir `ana:campaign:message:send` según el flag de enforcement; sin él responden 403 `{"error":"sin permiso"}` sin leer ni modificar jobs.

#### Scenario: Usuario sin rol de agente
- **WHEN** con enforcement activo un usuario sin `ana:campaign:message:send` llama `GET /jobs/poll`
- **THEN** el sistema responde 403 y no devuelve jobs

#### Scenario: Agente de campaña
- **WHEN** un usuario con rol "Agente DIDI VIP" llama `GET /jobs/poll`
- **THEN** recibe sus jobs normalmente
