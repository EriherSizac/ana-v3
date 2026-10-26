# Spec Delta

## MODIFIED Requirements

### Requirement: Consulta del roster
`GET /agents?campaign=` SHALL, para admin o usuario con `*`, requerir `campaign` (400 `{"error":"falta campaign"}`) y devolver ese roster. Para otro usuario MUST exigir rol de líder, `ana:chats:team:view` o `ana:team:jobs:view` (si no, 403 `{"error":"sin permiso"}`) y devolver el roster de la campaña pedida si es suya o de todas sus campañas si se omite, con 403 `{"error":"campaña no permitida"}` si no queda ninguna. Responde 200 `{"agents":[...]}`.

#### Scenario: Líder sin parámetro
- **WHEN** un líder de `didi_vip` y `bancoppel` llama `GET /agents`
- **THEN** recibe los agentes de ambas campañas

#### Scenario: Agente sin permisos de equipo
- **WHEN** un agente sin rol de líder ni permisos de equipo llama `GET /agents`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`
