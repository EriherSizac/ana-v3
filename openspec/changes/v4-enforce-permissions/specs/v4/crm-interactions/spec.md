# Spec Delta

## ADDED Requirements

### Requirement: Permisos de registro en el CRM
Según el flag de enforcement, `POST /interactions/report` MUST requerir `ana:campaign:message:send`, y `POST /interactions/open` y `POST /interactions/manual` MUST requerir `ana:chats:message:reply`; sin el permiso responden 403 `{"error":"sin permiso"}` sin llamar al CRM.

#### Scenario: Gestión sin permiso de respuesta
- **WHEN** con enforcement activo un rol con `-ana:chats:message:reply` llama `POST /interactions/manual`
- **THEN** el sistema responde 403 y no se registra ninguna interacción
