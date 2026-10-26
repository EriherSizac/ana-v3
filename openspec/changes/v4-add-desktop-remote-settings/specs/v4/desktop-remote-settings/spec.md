# Spec Delta

## Purpose

Permitir que el rol Developer ajuste sin release, desde ANA Admin, parámetros operativos del desktop v4 (ritmo de envío y registro de apertura de chat), con catálogo cerrado, valores acotados, auditoría y valores por defecto seguros cuando la configuración no está disponible.

## ADDED Requirements

### Requirement: Catálogo de configuración del desktop
El sistema SHALL reconocer solo estas llaves: `sendMinGapSeconds` (entero de 60 a 600, por defecto 120), `sendMaxPerWindow` (entero de 1 a 20, por defecto 7), `sendWindowMinutes` (entero de 5 a 60, por defecto 20) y `openChatInteraction` (booleano, por defecto `true`), cada una con etiqueta y descripción en español.

#### Scenario: Llave desconocida
- **WHEN** un Developer intenta guardar `{"values":{"foo":1}}`
- **THEN** el sistema responde 400 `{"error":"configuración desconocida: foo"}` sin guardar nada

### Requirement: Configuración efectiva
La configuración efectiva SHALL ser los valores guardados sobre los valores por defecto; un valor guardado fuera de tipo o de límites MUST ignorarse y usarse el por defecto.

#### Scenario: Nunca configurada
- **WHEN** no existe configuración guardada
- **THEN** la configuración efectiva es `sendMinGapSeconds: 120`, `sendMaxPerWindow: 7`, `sendWindowMinutes: 20` y `openChatInteraction: true`

### Requirement: Autorización Developer
`GET /admin/desktop-settings` y `PUT /admin/desktop-settings` MUST permitirse solo a usuarios con algún rol cuyo nombre contenga "developer" sin distinguir mayúsculas ni acentos, sin depender de `PERMISSIONS_ENFORCED` ni de los permisos `ana:*`; en otro caso responden 403 `{"error":"sin permiso"}`. `GET /me` SHALL incluir `isDeveloper`.

#### Scenario: Admin sin rol Developer
- **WHEN** un administrador sin rol Developer llama `PUT /admin/desktop-settings`
- **THEN** el sistema responde 403 y no cambia nada

### Requirement: Consulta de administración
`GET /admin/desktop-settings` SHALL responder 200 `{"version","settings":[{key,label,description,type,min?,max?,default,value,updatedBy,updatedAt}]}` con el valor efectivo de cada llave y su último cambio (`null` si nunca cambió).

#### Scenario: Primera consulta
- **WHEN** un Developer consulta sin cambios previos
- **THEN** recibe las cuatro llaves con su valor por defecto y `updatedBy: null`

### Requirement: Actualización de la configuración
`PUT /admin/desktop-settings` con `{version, values}` SHALL validar tipo y límites de cada llave (400 `{"error":"valor inválido: <llave>"}`), guardar solo las llaves enviadas con `updatedBy` y `updatedAt`, e incrementar `version`. Si `version` no coincide con la guardada MUST responder 409 `{"error":"la configuración cambió"}` sin escribir.

#### Scenario: Cambiar el ritmo
- **WHEN** un Developer envía `{"version":3,"values":{"sendMinGapSeconds":180}}` y la versión guardada es 3
- **THEN** el valor queda en 180 con su username y fecha, y la respuesta trae `version: 4`

#### Scenario: Fuera de límites
- **WHEN** se envía `sendMinGapSeconds: 10`
- **THEN** el sistema responde 400 `{"error":"valor inválido: sendMinGapSeconds"}`

#### Scenario: Edición concurrente
- **WHEN** dos Developers guardan partiendo de la misma versión
- **THEN** el segundo recibe 409 y su cambio no se aplica

### Requirement: Lectura de la configuración por el desktop
`GET /settings` SHALL responder 200 `{"version","values":{...}}` con la configuración efectiva a cualquier usuario autenticado.

#### Scenario: Agente
- **WHEN** un agente llama `GET /settings`
- **THEN** recibe los valores efectivos de las cuatro llaves

### Requirement: Consumo en el desktop
El desktop SHALL leer `GET /settings` tras iniciar sesión y cada 5 minutos, conservar el último valor obtenido y usar los valores por defecto mientras nunca la haya leído; un error de lectura MUST conservar el último valor.

#### Scenario: Backend caído al arrancar
- **WHEN** el desktop arranca y `GET /settings` falla
- **THEN** usa los valores por defecto y vuelve a intentar a los 5 minutos

#### Scenario: Cambio propagado
- **WHEN** un Developer cambia `sendMinGapSeconds` a 180
- **THEN** en máximo 5 minutos los desktops conectados esperan al menos 180 segundos entre mensajes
