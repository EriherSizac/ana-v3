# Spec Delta

## MODIFIED Requirements

### Requirement: Catálogo de permisos
El editor SHALL mostrar nueve permisos, cada uno con su etiqueta en español y su clave: `ana:admin:console:manage`, `ana:contacts:list:upload`, `ana:contacts:list:distribute`, `ana:chats:conversation:view`, `ana:chats:team:view`, `ana:chats:message:reply`, `ana:campaign:message:send`, `ana:team:jobs:view` y `ana:team:jobs:manage`.

#### Scenario: Catálogo completo
- **WHEN** el admin abre los permisos de un rol
- **THEN** ve los nueve permisos con sus claves y las etiquetas "Consola de administración", "Subir contactos (CSV)", "Repartir contactos entre agentes", "Ver conversaciones", "Ver conversaciones de agentes", "Responder mensajes", "Enviar campañas", "Ver pendientes del equipo" y "Reasignar pendientes del equipo"

## ADDED Requirements

### Requirement: Permisos no mostrados se conservan
Al guardar, el editor MUST incluir sin cambios los valores guardados del rol (grants o denies) cuya clave no forma parte de los permisos que muestra, de modo que guardar nunca borre permisos administrados por otra vía.

#### Scenario: Permiso de otra consola
- **WHEN** un rol tiene guardado `ana:admin:agents:manage` y el admin marca "Subir contactos (CSV)" y guarda
- **THEN** se envía una lista que incluye `ana:admin:agents:manage` y `ana:contacts:list:upload`
