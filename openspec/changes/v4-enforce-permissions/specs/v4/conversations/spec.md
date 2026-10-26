# Spec Delta

## MODIFIED Requirements

### Requirement: Ver como otro operador
`GET /conversations` y `GET /conversations/{chatId}/messages` SHALL aceptar `?operatorId=`. Si coincide con el propio usuario o se omite, MUST leer la propia partición; si es otro operador, MUST permitirlo, sin depender del flag de enforcement, a administradores y a usuarios con `ana:chats:team:view` cuando ese operador figura en el roster de alguna de sus campañas, y responder 403 `{"error":"sin permiso"}` a cualquier otro.

#### Scenario: Líder intenta ver a su agente
- **WHEN** un líder de `didi_vip` (con `ana:chats:team:view`) llama `GET /conversations?operatorId=agente1` y `agente1` está en el roster de `didi_vip`
- **THEN** recibe las conversaciones de `agente1`

#### Scenario: Admin ve a un agente
- **WHEN** un admin llama `GET /conversations?operatorId=agente1`
- **THEN** recibe las conversaciones de `agente1`

#### Scenario: Agente de otra campaña
- **WHEN** un líder de `didi_vip` pide las conversaciones de un agente que solo está en el roster de `bancoppel`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

#### Scenario: Agente sin permiso de equipo
- **WHEN** un agente sin `ana:chats:team:view` pide las conversaciones de un compañero de su campaña
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`
