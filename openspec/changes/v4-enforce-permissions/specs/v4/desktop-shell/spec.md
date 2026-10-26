# Spec Delta

## MODIFIED Requirements

### Requirement: Navegación por pestañas según rol
Tras login, la app SHALL mostrar un encabezado con "PERNEXIUM", el usuario y su etiqueta (`admin` o `líder`). "Chats" MUST mostrarse con `ana:chats:conversation:view`, "Mi asignación" con `ana:campaign:message:send`, "Campañas" a admin, líder o con `ana:contacts:list:upload` y "Admin" solo a admin; un admin ve todas. Si `/me` falla, el encabezado SHALL mostrar el error y el usuario queda sin rol ni pestañas. La pestaña inicial es la primera visible.

#### Scenario: Agente sin permiso de subida
- **WHEN** entra un agente no admin, no líder, con los permisos por defecto y `ana:campaign:message:send`, sin `ana:contacts:list:upload`
- **THEN** solo ve las pestañas "Chats" y "Mi asignación" y el botón "Salir"

#### Scenario: Falla /me
- **WHEN** la consulta `GET /me` responde con error
- **THEN** el encabezado muestra una etiqueta roja con el mensaje de error y no se muestran "Campañas" ni "Admin"

#### Scenario: Usuario sin permiso de envío
- **WHEN** entra un usuario sin `ana:campaign:message:send`
- **THEN** no ve "Mi asignación"
