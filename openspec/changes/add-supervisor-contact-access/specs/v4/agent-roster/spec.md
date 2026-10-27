# Spec Delta

## ADDED Requirements

### Requirement: Supervisores en la lista derivada
La sincronización SHALL incluir en `campaign-agents/{c}.json` a cada usuario elegible del pool con un rol de supervisor de la campaña `c` (sin deny `-ana:campaign:message:send` en ese rol), con `kind:"supervisor"`; los agentes llevan `kind:"agent"`. Un usuario que es agente y supervisor de la misma campaña MUST aparecer una sola vez con `kind:"agent"`.

#### Scenario: Supervisor de la campaña
- **WHEN** `sara` está `CONFIRMED` y habilitada en el pool y tiene "Supervisor DIDI VIP"
- **THEN** `campaign-agents/didi_vip.json` la lista con `kind:"supervisor"`

#### Scenario: Agente y supervisor
- **WHEN** `ana.lopez` tiene "Agente DIDI VIP" y "Supervisor DIDI VIP"
- **THEN** figura una sola vez con `kind:"agent"`

### Requirement: Tipo de integrante en el roster v4
`GET /admin/agent-roster` SHALL incluir en cada elemento de `agents` el campo `kind` (`agent` o `supervisor`; una entrada de la lista sin `kind` MUST tratarse como `agent`). La regla de habilitación v4 y las excepciones administrativas aplican igual a supervisores y agentes.

#### Scenario: Deshabilitar a un supervisor
- **WHEN** un líder envía `enabled:false` para `sara`, supervisora derivada de `didi_vip`
- **THEN** la respuesta muestra a `sara` con `kind:"supervisor"` y `enabled:false`, y deja de estar habilitada en v4

#### Scenario: Lista anterior sin kind
- **WHEN** la lista vigente fue escrita antes del cambio y sus entradas no tienen `kind`
- **THEN** todas se reportan con `kind:"agent"`

### Requirement: Lectura del roster v4 para quien reparte
`GET /admin/agent-roster` SHALL permitirse, además de a quien puede gestionar el roster, a usuarios con `ana:contacts:list:upload` y `ana:contacts:list:distribute` sobre campañas propias (o `*`), con chequeo independiente de `PERMISSIONS_ENFORCED`. `POST /admin/agent-roster` MUST seguir exigiendo la autorización de gestión.

#### Scenario: Supervisor consulta su campaña
- **WHEN** un supervisor de `didi_vip` llama a `GET /admin/agent-roster?campaign=didi_vip`
- **THEN** el sistema responde 200 con el roster

#### Scenario: Supervisor intenta escribir
- **WHEN** el mismo supervisor llama a `POST /admin/agent-roster`
- **THEN** el sistema responde 403 con `{"error":"sin permiso"}`

### Requirement: Destinatarios supervisores en v4
Con `AGENT_ROSTER_FILTER` en `true`, un supervisor habilitado SHALL ser destinatario válido de `assignments` en `POST /uploads/presign` y de reasignaciones; el reparto automático (`distribute` sin `assignments`) MUST usar solo integrantes con `kind:"agent"`.

#### Scenario: Reparto explícito a un supervisor
- **WHEN** se pide un presign con `assignments:{"sara":1}` y `sara` es supervisora habilitada
- **THEN** el sistema genera la URL y los jobs quedan para `sara`

#### Scenario: Reparto automático
- **WHEN** el Dashboard devuelve `ana.lopez` y `sara` como elegibles y `sara` es supervisora
- **THEN** el reparto automático asigna todos los jobs a `ana.lopez`
