# Spec Delta

## MODIFIED Requirements

### Requirement: Consumo único de la asignación por el CLI
El sistema SHALL exponer `GET /get/chats/{agentId}/{campaignId}`, protegido con autenticación de agente (`v3/agent-auth`: ID token cuyo usuario es `agentId` y que está habilitado en el roster de `campaignId`, sujeto al modo de transición), que toma el archivo más antiguo del agente bajo `agents/{campaignId}/` (excluyendo `credentials.csv`), devuelve su contenido CSV crudo y lo elimina de S3 antes de responder, de modo que cada asignación se entregue una sola vez.

#### Scenario: Consumo exitoso
- **WHEN** el CLI solicita la asignación con un token válido de ese agente habilitado en esa campaña (o sin token en modo reporte) y existe al menos un archivo del agente
- **THEN** el sistema responde 200 con el CSV crudo como body (con header `Content-Type: application/json`)
- **AND** el objeto queda eliminado; una segunda llamada devuelve el siguiente archivo más antiguo o 404

#### Scenario: Solicitud no autenticada en modo estricto
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y la solicitud no trae token o trae uno vencido o inválido
- **THEN** el sistema responde 401
- **AND** no lista, lee ni elimina ningún objeto, de modo que la asignación sigue disponible para su agente

#### Scenario: Token de otro agente o fuera del roster en modo estricto
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y el token es de `ana` en la ruta de `erick`, o `erick` no está habilitado en el roster de `campaignId`
- **THEN** el sistema responde 403 con `{"error":"Forbidden"}` y la asignación no se consume

#### Scenario: Sin asignación
- **WHEN** no hay archivos del agente en el prefijo o el objeto desaparece entre listado y lectura
- **THEN** el sistema responde 404 con `{"error":"Chat assignment not found"}`

#### Scenario: Archivo vacío
- **WHEN** el archivo seleccionado no tiene contenido
- **THEN** el sistema responde 404 con `{"error":"File not found or empty"}` sin eliminarlo

#### Scenario: Fallo al eliminar
- **WHEN** la lectura funciona pero la eliminación falla
- **THEN** el sistema responde 500 con `{"error":"Failed to delete chat assignment after reading"}` y el contenido no se entrega

#### Scenario: Parámetros faltantes
- **WHEN** falta `agentId` o `campaignId`
- **THEN** el sistema responde 400 con `{"error":"agentId and campaignId parameters are required"}`

### Requirement: Reporte de contactos pendientes del CLI
El sistema SHALL exponer `POST /contacts/pending`, protegido con autenticación de agente (`v3/agent-auth`: el usuario del token es `agent_id` y está habilitado en el roster de `campaign`, sujeto al modo de transición), que recibe `{campaign, agent_id, contacts:[{...}]}` y sobrescribe `chats/{agent_id}-{campaign}.csv` con un CSV cuyo encabezado son las llaves del primer contacto, o `contact_phone,contact_name` si la lista está vacía.

#### Scenario: Actualización exitosa
- **WHEN** el CLI de `agent_id` envía 3 contactos restantes con su token válido
- **THEN** el sistema escribe el CSV con una fila por contacto, rodeando con comillas (sin escapar comillas internas) los valores que contienen coma y convirtiendo valores falsy (p. ej. `0`) en vacío
- **AND** responde 200 con `{"message":"Contactos pendientes actualizados","path","remainingContacts":3}`

#### Scenario: Pendientes de otro agente en modo estricto
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y el token de `ana` envía `agent_id: "erick"`
- **THEN** el sistema responde 403 con `{"error":"Forbidden"}` sin sobrescribir `chats/erick-{campaign}.csv`

#### Scenario: Validaciones
- **WHEN** falta `campaign` o `agent_id`
- **THEN** el sistema responde 400 con `{"error":"campaign y agent_id son requeridos"}`
- **AND** si `contacts` no es arreglo responde 400 con `{"error":"contacts debe ser un array"}`

#### Scenario: Error interno
- **WHEN** el body no es JSON válido o falla S3
- **THEN** el sistema responde 500 con `{"error":"Error al actualizar contactos pendientes","details":<detalle>}`
