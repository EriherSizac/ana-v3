# Spec Delta

## ADDED Requirements

### Requirement: Respuesta condicionada al permiso
Sin `ana:chats:message:reply`, la vista SHALL ocultar el campo de respuesta, el adjunto y "Registrar gestión" y mostrar "No tienes permiso para responder."; el proceso main MUST rechazar cualquier envío manual de texto o archivo con `{ok:false, error:"sin permiso para responder"}` aunque se invoque directamente.

#### Scenario: Rol con respuesta denegada
- **WHEN** un usuario cuyo rol guarda `-ana:chats:message:reply` abre un chat propio
- **THEN** ve el aviso "No tienes permiso para responder." y no hay campo de respuesta

#### Scenario: Invocación directa
- **WHEN** código del renderer llama el envío manual sin que el usuario tenga el permiso
- **THEN** el main no envía nada y devuelve el error de permiso
