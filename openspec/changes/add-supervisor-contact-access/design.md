# Design

## Context

- v4 `resolveUserAccess` (`v4/backend/src/lib/access.ts`): agentes reciben `CAMPAIGN_SEND` por rol (`isAgentRole`), líderes (`isLeaderRole`) reciben carga, reparto, equipo y `AGENTS_MANAGE`. No existe regla para "Supervisor".
- Lista derivada: la escribe `syncCampaignAgents` (v4, cada 5 min) en `campaign-agents/{c}.json` del bucket v3 (`deriveCampaignAgents`, solo roles de agente con envío). La leen v3 (`roster.ts`: CLI, `/agent/campaigns`, carga de administración, `/admin/*`) y v4 (`campaignAgentsList.ts`: roster administrativo, reparto con `AGENT_ROSTER_FILTER`).
- La sección Contactos (ANA Admin) usa `GET /api/campaigns/{c}/enabled-agents`, que lee el roster `/admin/*` de cada flota; ambos exigen hoy `ana:admin:agents:manage` (pendiente anotado en `add-contact-upload-console`).
- La carga v3 (`adminContacts.ts`) agrega `message` y escribe en `agents/` (lo que consume el CLI). `assignments/` es el prefijo de pendientes que usaba el portal anterior (`chatbot-v2-front`, `AgentsManager`): el agente elegía filas, escribía el mensaje y publicaba a `agents/`.
- v4 `POST /uploads/presign` ya admite carga sin `template` (metadata `template` = `{mensaje}`); el desktop ("Mi asignación") precarga esa plantilla y valida variables contra las columnas del archivo.

## Goals / Non-Goals

**Goals:**
- Supervisores operan Contactos de sus campañas sin poder administrar el roster.
- Supervisores pueden recibir y trabajar contactos en ambas flotas sin release del CLI.
- Compatibilidad con lectores que no conocen `kind`.

**Non-Goals:**
- Supervisores en el reparto automático de v4 desde el desktop.
- Retirar `POST /supervisors/...` o `assignments/` de la carga por `curl` (siguen igual).

## Decisions

### D1. `isSupervisorRole` y permisos
Misma normalización que `isLeaderRole` (`/supervisor/` sobre NFD sin diacríticos). Por rol de supervisor: `CONTACTS_UPLOAD` y `CONTACTS_DISTRIBUTE` siempre (como el líder, ignoran denies: es la función del rol) y `CAMPAIGN_SEND` salvo deny `-ana:campaign:message:send` de ese rol (misma regla que agentes). Sin `AGENTS_MANAGE`, sin permisos de equipo. `isLeader` no cambia. Se agrega `isSupervisor` al acceso para que la UI pueda usarlo (aditivo en `GET /me`).
- Alternativa: configurar permisos por rol en el almacén local — descartada por el usuario: debe funcionar sin configuración, como el líder.

### D2. `kind` en la lista derivada
`deriveCampaignAgents` acepta roles de agente con envío (como hoy) y roles de supervisor sin deny de envío (el almacén local se consulta también para esos `role_id`). Por usuario y campaña: `kind:"agent"` si algún rol de agente aplica, si no `"supervisor"`. El JSON conserva `schemaVersion:1` y solo agrega el campo: los lectores anteriores lo ignoran y tratan al supervisor como agente (por eso el orden de despliegue, ver Migration Plan). Los lectores nuevos tratan `kind` ausente como `agent`.
- Alternativa: lista separada `campaign-supervisors/` — descartada: duplicaría la regla de habilitación, las excepciones y las lecturas del CLI.
- Alternativa: `schemaVersion:2` — descartada: los lectores v3 desplegados rechazarían la lista (fail-closed) y cortarían el CLI.

### D3. Habilitado = integrante (agente o supervisor) habilitado; destinatario = filtro por `kind`
La regla de habilitación y las excepciones (`rosters/`, tabla v4) no distinguen tipo, así que CLI, `/agent/*`, carga de administración v3 y `checkAssignmentsEnabled` v4 aceptan supervisores sin cambios de lógica. El filtro por tipo vive donde se elige a quién repartir: el BFF (`enabled-agents?includeSupervisors=1` y la verificación del plan con el flag del request) y `getDistributableAgents` de v4 (reparto automático: solo `agent`).
- Alternativa: excluir supervisores en `getEnabledAgents` salvo opción — descartada: el CLI y "Mi asignación" deben aceptarlos.

### D4. Lectura del roster con permisos de contactos
v3 `getRoster` usa `requireAdminAccess` con regla `AGENTS_MANAGE ∨ (UPLOAD ∧ DISTRIBUTE)` + alcance de campaña; v4 `adminRosterGet` usa `canReadRoster` (misma regla, fail-closed, sin flag). Escrituras sin cambio. La respuesta de ambas agrega `kind`.

### D5. Carga v3 a pendientes y sin mensaje
`uploadContacts` deja de llamar `addMessageColumn`; escribe el CSV (con `ana_upload_id` como última columna) en `assignments/agents/{c}/{agent}-contacts-{ts}.csv` + `historic/`. `message` del body se ignora (compatibilidad con un BFF anterior durante el despliegue) y el manifiesto guarda `message:null` y `destination:"assignments"`. El rollback borra `assignments/...`. `GET /get/chats` no cambia: solo ve lo que el agente publica (`add-agent-workspace`).
- Las filas de una carga llegan a `agents/` vía la publicación del agente, que conserva `ana_upload_id` por fila; así `link-review-contacts-to-uploads` sigue uniendo filas por revisar con su carga.

### D6. Formulario
Flota inicial `v3`. Se quitan textarea de mensaje y plantilla v4; el código de país v4 pasa a la sección Archivo. Toggle "Incluir supervisores" (nuevo componente `Toggle`, `role="switch"`, tokens del design system). `enabled-agents` responde `agents` (destinatarios según el flag) y `supervisors` (subconjunto, para etiquetar). La reasignación del detalle de carga ya no pide mensaje.

### D7. v4 desktop
`defaultTemplateFor(template, columns)`: si la plantilla es `{mensaje}` y el archivo no tiene `mensaje`/`message`, devuelve `''` (el editor queda vacío y "obligatorio"). El backend v4 no cambia: ya acepta presign sin `template`.

### Coordinación
- Archivo: después de `add-agent-roster-management`, `add-contact-upload-console` y `link-review-contacts-to-uploads` (sus MODIFIED reescriben requisitos que esos cambios crean).

## Risks / Trade-offs

- [v3 o ANA Admin anteriores leen una lista con supervisores] → desplegar v3 y ANA Admin antes de la sincronización v4 con supervisores (Migration Plan).
- [Cargas v3 sin "Mi asignación" desplegada quedan en pendientes] → desplegar junto con `add-agent-workspace`.
- [Un supervisor recibe contactos sin saberlo] → toggle apagado por defecto y etiqueta en la vista previa.
- [Rol con "supervisor" en otro contexto ("Supervisor de calidad")] → recibe carga/reparto de su campaña; aceptado por regla de negocio (alcance de campaña).

## Migration Plan

1. v3: `sls deploy` (roster con `kind`, lectura del roster con permisos de contactos, carga a pendientes) junto con las rutas de `add-agent-workspace`.
2. ANA Admin: rebuild de Amplify (formulario, toggle, insignia, "Mi asignación").
3. v4 backend: `sls deploy` (rol de supervisor, sincronización con supervisores, lectura del roster, reparto automático solo agentes). En ≤ 5 min las listas incluyen supervisores.
4. v4 desktop: incluir el ajuste de plantilla en el siguiente release (sin él, el agente ve `{mensaje}` marcado como variable desconocida y lo reemplaza; no bloquea).
- Rollback: revertir v4 (las listas se regeneran sin supervisores en ≤ 5 min); revertir v3 vuelve a escribir en `agents/`.
