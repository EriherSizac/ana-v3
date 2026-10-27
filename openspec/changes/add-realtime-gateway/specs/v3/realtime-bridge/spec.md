# Spec Delta

## Purpose

Convertir los cambios del almacenamiento S3 de v3 (asignaciones, publicaciones, contactos por revisar, roster, cargas y configuración del CLI) en eventos del canal realtime de v4 y en actualizaciones forzadas de acceso, sin modificar los handlers de v3 ni su contrato REST.

## ADDED Requirements

### Requirement: Origen de los eventos de v3
El bucket `ana-backend-storage-<stage>` (us-east-1) SHALL publicar sus eventos de objeto a EventBridge y una regla MUST reenviar al bus realtime de v4 (us-east-2) solo los objetos creados o borrados bajo `agents/`, `assignments/agents/`, `agent-publications/`, `review/`, `rosters/`, `uploads/` y la llave `config/cli-settings.json`.

#### Scenario: Respaldo de chat
- **WHEN** el CLI escribe `backups/prueba/jperez/5512345678/chat_backup.json`
- **THEN** ningún evento cruza a v4

#### Scenario: Escritura por una ruta legada
- **WHEN** `/supervisors/agents/{agent}/{campaign}/contacts` escribe `agents/prueba/jperez-contacts-<ts>.csv`
- **THEN** el evento llega a v4 igual que si lo hubiera escrito ANA Admin

### Requirement: Asignación publicada al CLI
Un objeto creado `agents/{campaign}/{agent}-contacts-*.csv` SHALL producir `assignment.published` para el usuario `{agent}` con `campaign` normalizada en minúsculas.

#### Scenario: Publicación desde Mi asignación
- **WHEN** se crea `agents/prueba/jperez-contacts-1730000000.csv`
- **THEN** `jperez` recibe `{"type":"assignment.published","campaign":"prueba"}`

### Requirement: Asignación pendiente del agente
Un objeto creado o borrado `assignments/agents/{campaign}/{agent}-contacts-*.csv` SHALL producir `assignment.pending` para `{agent}` con su campaña.

#### Scenario: Reparto desde Contactos
- **WHEN** un supervisor reparte un CSV y se crea `assignments/agents/prueba/jperez-contacts-<ts>.csv`
- **THEN** `jperez` recibe `assignment.pending` con `campaign: "prueba"`

### Requirement: Historial de publicaciones
Un objeto creado bajo `agent-publications/{campaign}/{agent}/` SHALL producir `publications.changed` para `{agent}` con su campaña.

#### Scenario: Nueva publicación
- **WHEN** se escribe el registro de una publicación de `jperez` en `prueba`
- **THEN** `jperez` recibe `publications.changed` con `campaign: "prueba"`

### Requirement: Eventos de campaña de v3
Un objeto creado o borrado bajo `review/{campaign}/` SHALL producir `review.changed`, bajo `uploads/{campaign}/` `uploads.changed` y en `rosters/{campaign}.json` `roster.changed`, todos a la campaña con `ref.source: "v3"`.

#### Scenario: Roster editado
- **WHEN** se reescribe `rosters/prueba.json`
- **THEN** las conexiones de ANA Admin con acceso a `prueba` reciben `roster.changed` con `source: "v3"`

### Requirement: Actualización forzada por roster de v3
Un objeto creado o borrado `rosters/{campaign}.json` SHALL, además de `roster.changed`, forzar la actualización (`session.refresh` con `reason: "roster"`) de todas las conexiones cuyo acceso v4 incluye esa campaña, porque el evento de S3 no dice qué agentes cambiaron.

#### Scenario: Excepción editada en v3
- **WHEN** ANA Admin deshabilita a `jperez` en `prueba` con `POST /admin/campaigns/prueba/roster/agents` y se reescribe `rosters/prueba.json`
- **THEN** las conexiones de los usuarios con `prueba` en su acceso reciben `session.refresh` y las de otras campañas no

### Requirement: Configuración del CLI cambiada
Un objeto creado `config/cli-settings.json` SHALL producir `settings.changed` con `ref.scope: "cli"` a todos los CLIs y conexiones `admin` y forzar la actualización de todas las conexiones `cli` (`reason: "settings"`).

#### Scenario: Developer cambia un flag
- **WHEN** un Developer guarda la configuración del CLI en ANA Admin
- **THEN** cada CLI conectado recibe `settings.changed` con `scope: "cli"` y luego `session.refresh` con `reason: "settings"`

### Requirement: Llaves no reconocidas
Una llave que no siga el patrón de su prefijo (sin campaña, sin agente o sin el sufijo `-contacts-*.csv` donde aplica) MUST descartarse sin emitir evento y contarse como `BridgeSkipped`.

#### Scenario: Archivo suelto
- **WHEN** se crea `agents/prueba/notas.txt`
- **THEN** no se emite evento y se cuenta `BridgeSkipped`

### Requirement: Contrato de v3 intacto
El puente MUST NOT cambiar rutas, respuestas, llaves ni permisos de v3; si el puente falla, v3 y sus clientes SHALL comportarse exactamente como sin él.

#### Scenario: Regla deshabilitada
- **WHEN** se deshabilita la regla de reenvío
- **THEN** las rutas de v3 responden igual y los clientes se enteran por su polling de respaldo
