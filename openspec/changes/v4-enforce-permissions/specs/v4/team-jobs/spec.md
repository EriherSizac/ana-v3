# Spec Delta

## MODIFIED Requirements

### Requirement: Autorización por campaña
`GET /jobs/summary` MUST permitirse a administradores para cualquier campaña y a líderes o usuarios con `ana:team:jobs:view` solo para campañas propias (o si tienen `*`); `POST /jobs/reassign`, igual con `ana:team:jobs:manage`. Estos chequeos no dependen de `PERMISSIONS_ENFORCED`; en otro caso responden 403 `{"error":"sin permiso"}`.

#### Scenario: Líder de otra campaña
- **WHEN** un líder de `didi_vip` pide `GET /jobs/summary?campaign=bancoppel`
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`

#### Scenario: Usuario con grant pero sin rol de líder
- **WHEN** un usuario no líder con `ana:team:jobs:view` explícito pide el summary de su campaña
- **THEN** el sistema responde 200 con el resumen

#### Scenario: Ver sin poder mover
- **WHEN** un usuario no líder con `ana:team:jobs:view` pero sin `ana:team:jobs:manage` llama `POST /jobs/reassign` en su campaña
- **THEN** el sistema responde 403 `{"error":"sin permiso"}`
