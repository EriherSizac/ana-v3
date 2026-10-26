# role-admin-ui Specification

## Purpose
Describe la pestaña "Admin" de la app de escritorio v4, visible solo para administradores: listado buscable de roles provenientes de la API de Roles y editor de los permisos de ana de cada rol, con permisos por defecto activos que se desactivan mediante una denegación explícita. El almacenamiento y la evaluación de permisos pertenecen a las especificaciones del backend (`/admin/roles`, `/admin/role-permissions/{roleId}`).

## Requirements

### Requirement: Catálogo de permisos
El editor SHALL mostrar siete permisos con su etiqueta y su clave: "Consola de administración", "Subir contactos (CSV)", "Repartir contactos entre agentes", "Ver conversaciones", "Ver conversaciones de agentes", "Responder mensajes" y "Enviar campañas", con claves `ana:admin:console:manage`, `ana:contacts:list:upload`, `ana:contacts:list:distribute`, `ana:chats:conversation:view`, `ana:chats:team:view`, `ana:chats:message:reply` y `ana:campaign:message:send`.

#### Scenario: Catálogo completo
- **WHEN** el admin abre los permisos de un rol
- **THEN** ve los siete permisos, cada uno con su etiqueta y su clave

### Requirement: Permisos por defecto
El editor MUST marcar con la etiqueta "por defecto" a `ana:chats:conversation:view` y `ana:chats:message:reply`, que se consideran activos salvo denegación explícita.

#### Scenario: Etiqueta por defecto
- **WHEN** el admin abre los permisos de un rol
- **THEN** "Ver conversaciones" y "Responder mensajes" muestran la etiqueta "por defecto"

> Nota: la lista de defaults es una copia manual de la del backend; si el backend cambia sus defaults sin actualizar el escritorio, el editor mostrará y guardará un estado distinto al efectivo.

### Requirement: Listado de roles
La pantalla SHALL cargar los roles de `GET /admin/roles` y listarlos con nombre y campaña (`*` se muestra como "global"), filtrando por nombre de rol o campaña sin distinguir mayúsculas. Mientras carga MUST mostrar 8 esqueletos; sin resultados, "Sin roles."; si la carga falla, el mensaje de error sobre una lista vacía.

#### Scenario: Búsqueda por campaña
- **WHEN** el admin escribe el nombre de una campaña
- **THEN** la lista muestra solo los roles de esa campaña

### Requirement: Lectura de permisos de un rol
Al elegir un rol la pantalla SHALL mostrar su nombre e id y leer `GET /admin/role-permissions/{roleId}`. Un permiso por defecto MUST aparecer marcado salvo que exista su denegación `-<permiso>`; uno no por defecto aparece marcado solo si está concedido. Si falla la lectura, todo aparece desmarcado con "Error cargando permisos: <mensaje>".

#### Scenario: Default denegado
- **WHEN** el rol tiene guardado `-ana:chats:message:reply`
- **THEN** "Responder mensajes" aparece desmarcado

### Requirement: Guardado de permisos
"Guardar permisos" SHALL enviar `PUT /admin/role-permissions/{roleId}` con la lista completa: `-<permiso>` por cada default desmarcado y `<permiso>` por cada no default marcado; los defaults marcados MUST omitirse. Al terminar muestra "Permisos guardados." o "Error: <mensaje>"; el botón dice "Guardando…" mientras tanto.

#### Scenario: Conceder subida
- **WHEN** el admin marca "Subir contactos (CSV)" en un rol sin otros cambios y guarda
- **THEN** se envía `["ana:contacts:list:upload"]` y aparece "Permisos guardados."

> Nota: si la lectura del rol falló, guardar envía la denegación de ambos defaults porque el editor parte de todo desmarcado.
