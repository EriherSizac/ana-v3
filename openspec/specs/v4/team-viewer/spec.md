# team-viewer Specification

## Purpose
Describe el panel de equipo dentro de la pestaña "Chats" de la app de escritorio v4 para admins y líderes: "Ver como" (solo admin) para leer en modo solo lectura las conversaciones de un agente elegido por campaña, y el panel "Envíos pendientes" para ver los pendientes por agente de una campaña y reasignarlos a otro agente. La autorización real la aplica el backend en `/agents*`, `/conversations*` y `/jobs/summary`/`/jobs/reassign`.

> Nota: el panel se muestra según las banderas `isAdmin`/`isLeader` de `/me`; el permiso `ana:chats:team:view` no se evalúa en el escritorio.

## Requirements

### Requirement: Visibilidad del panel
El panel de equipo SHALL mostrarse en la lista de conversaciones solo a admins y líderes. La sección "Ver como" MUST mostrarse solo a admins; los líderes solo ven el panel de envíos pendientes.

#### Scenario: Líder
- **WHEN** un líder abre "Chats"
- **THEN** no ve "Ver como" y, si su campaña tiene pendientes, ve "Envíos pendientes"

#### Scenario: Agente
- **WHEN** un agente sin rol de líder ni admin abre "Chats"
- **THEN** no ve el panel de equipo

### Requirement: Ver como (admin)
El admin SHALL elegir una campaña de `GET /agents/campaigns` en un selector buscable y luego un agente de `GET /agents?campaign=<c>` en un desplegable con "Mis conversaciones" y cada agente marcado "· activo" u "· offline". Cambiar de campaña MUST volver a "Mis conversaciones". Elegir un agente SHALL recargar lista e hilo con `operatorId` de ese agente.

#### Scenario: Admin revisa a un agente
- **WHEN** el admin elige campaña y agente
- **THEN** la lista muestra las conversaciones de ese agente

### Requirement: Modo solo lectura
Mientras se ven conversaciones de otro agente, la vista SHALL ocultar el indicador y el panel de conexión de WhatsApp y el botón "Registrar gestión", no notificar apertura de chat y no agregar mensajes entrantes propios al hilo. En lugar del campo de respuesta MUST mostrarse "Solo lectura — esta conversación es de otro agente; no puedes responder desde su sesión."

#### Scenario: Intento de responder
- **WHEN** el admin abre un chat de otro agente
- **THEN** no hay campo de respuesta ni adjunto, solo el aviso de solo lectura

### Requirement: Envíos pendientes por agente
El panel "Envíos pendientes · <campaña>" SHALL usar la campaña elegida (admin) o la primera campaña distinta de `*` del líder, consultar `GET /jobs/summary` al montarse y cada 30 segundos y mostrar por agente su identificador y "N pendientes". Si no hay filas o la consulta falla, MUST ocultarse.

#### Scenario: Campaña sin pendientes
- **WHEN** ningún agente de la campaña tiene jobs pendientes
- **THEN** el panel no se muestra

### Requirement: Reasignación de pendientes
Por cada agente con pendientes, el panel SHALL ofrecer "Mover a…" con los demás agentes cargados y el botón "Mover", deshabilitado sin destino o con otra reasignación en curso. Al confirmar MUST llamar `POST /jobs/reassign` con campaña, origen y destino, mostrar "N envíos movidos a <agente>" y recargar el resumen; si falla, "No se pudieron reasignar los envíos".

#### Scenario: Agente desconectado a media campaña
- **WHEN** el líder mueve los pendientes de un agente offline a otro activo
- **THEN** se muestra cuántos envíos se movieron y el resumen se actualiza

> Nota: la cantidad de jobs omitidos por estar arrendados que devuelve el backend no se muestra. Para el admin la lista de destinos solo se llena tras elegir campaña en "Ver como".
