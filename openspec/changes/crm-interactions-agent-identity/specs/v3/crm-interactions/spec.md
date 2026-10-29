## ADDED Requirements

### Requirement: user_id del agente en las interacciones
El CLI SHALL guardar en memoria `crmUserId` y `displayName` de `GET /agent/campaigns`, e `insertInteractions` MUST usar ese `crmUserId` como `user_id` de toda interacción con el `user_id` legado o vacío (envío automático, Gestión manual, monitor y "Consulta No Whatsapp"), solo si la identidad es del agente de la sesión. Sin `crmUserId`, MUST usar el `user_id` legado y agregar a `comments` `Agente: {username} ({name})` (o `Agente: {username}` sin nombre).

#### Scenario: Agente con identidad CRM
- **WHEN** el agente tiene `crmUserId` y registra una gestión
- **THEN** la interacción se envía con `user_id` = `crmUserId`

#### Scenario: Agente sin identidad CRM
- **WHEN** `GET /agent/campaigns` no trajo `crmUserId`
- **THEN** la interacción se envía con el `user_id` legado y `comments` incluye `Agente: {username} ({name})`

### Requirement: Registro del camino de user_id
El CLI SHALL registrar en su log qué camino de `user_id` usó en cada envío (`agent`, `legacy_no_identity` o `legacy_fallback`) junto con el username, y MUST NOT registrar el nombre ni otros datos personales del agente.

#### Scenario: Envío con fallback
- **WHEN** un envío termina con el `user_id` legado tras el rechazo del CRM
- **THEN** el log contiene `user_id=legacy_fallback agente={username}`

### Requirement: Reintento con el user_id legado
Si el CRM responde 4xx a un envío que usó el `user_id` del agente, el CLI SHALL reintentar UNA sola vez con el `user_id` legado y el sufijo del agente en `comments`. Respuestas 5xx o errores de red MUST NOT disparar este reintento.

#### Scenario: CRM rechaza el user_id del agente
- **WHEN** el CRM responde 400 al envío con el `user_id` del agente
- **THEN** el CLI reenvía una vez con el `user_id` legado y `comments` con el sufijo del agente

#### Scenario: Error de servidor
- **WHEN** el CRM responde 502
- **THEN** no se reintenta con el `user_id` legado

### Requirement: Marca de ANA en comments
Toda interacción enviada por el CLI SHALL indicar en `comments` que se registró vía ANA: `Registrado vía ANA` si el comentario está vacío, o `{comments} | vía ANA` si no; con el sufijo del agente queda `… vía ANA · Agente: {username} ({name})`. La marca MUST NOT duplicarse en reintentos y `comments` MUST NOT exceder 500 caracteres: se trunca el comentario original (con `…`, sin partir caracteres), nunca la marca.

#### Scenario: Comentario vacío
- **WHEN** una interacción se envía sin comentario
- **THEN** `comments` = `Registrado vía ANA`

#### Scenario: Comentario largo en fallback
- **WHEN** el comentario excede el límite y se usa el sufijo del agente
- **THEN** `comments` mide 500 caracteres y termina en ` | vía ANA · Agente: {username} ({name})`
