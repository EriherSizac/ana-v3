# Spec Delta

## MODIFIED Requirements

### Requirement: Visibilidad del panel
El panel de equipo SHALL mostrarse en la lista de conversaciones a admins y a usuarios con `ana:chats:team:view`, `ana:team:jobs:view` o rol de líder. La sección "Ver como" MUST mostrarse a admins y a quien tenga `ana:chats:team:view`; el panel de envíos pendientes, a quien tenga `ana:team:jobs:view`, y "Mover", solo con `ana:team:jobs:manage`.

#### Scenario: Líder
- **WHEN** un líder abre "Chats"
- **THEN** ve "Ver como" con los agentes de sus campañas y, si su campaña tiene pendientes, "Envíos pendientes" con "Mover"

#### Scenario: Agente
- **WHEN** un agente sin rol de líder, admin ni permisos de equipo abre "Chats"
- **THEN** no ve el panel de equipo

#### Scenario: Supervisor de solo lectura
- **WHEN** un usuario con `ana:team:jobs:view` pero sin `ana:team:jobs:manage` abre "Chats"
- **THEN** ve "Envíos pendientes" sin el botón "Mover"

### Requirement: Ver como (admin)
Quien tenga "Ver como" SHALL elegir una campaña de `GET /agents/campaigns` (un líder, solo las suyas) en un selector buscable y luego un agente de `GET /agents?campaign=<c>` en un desplegable con "Mis conversaciones" y cada agente marcado "· activo" u "· offline". Cambiar de campaña MUST volver a "Mis conversaciones". Elegir un agente SHALL recargar lista e hilo con `operatorId` de ese agente.

#### Scenario: Admin revisa a un agente
- **WHEN** el admin elige campaña y agente
- **THEN** la lista muestra las conversaciones de ese agente

#### Scenario: Líder revisa a su agente
- **WHEN** un líder de `didi_vip` elige `didi_vip` y un agente de esa campaña
- **THEN** la lista muestra las conversaciones de ese agente en modo solo lectura
