# Spec Delta

## MODIFIED Requirements

### Requirement: Consulta de contactos listos del agente
El sistema SHALL exponer `GET /supervisors/agents/{agent}/{campaign}/contacts`, protegido con `X-Admin-Key`, que devuelve con `Content-Type: text/csv` el contenido del archivo más reciente (por fecha de modificación) del agente bajo `agents/{campaign}/`, sin eliminarlo.

#### Scenario: Archivo existente
- **WHEN** existen uno o más archivos `agents/{campaign}/{agent}-contacts*.csv` y la llave es válida
- **THEN** el sistema responde 200 con el CSV del más reciente

#### Scenario: Sin archivos
- **WHEN** no hay archivos que coincidan y la llave es válida
- **THEN** el sistema responde 404 con `{"success":false,"message":"CSV no encontrado"}`

#### Scenario: Sin llave de administración
- **WHEN** la solicitud no trae `X-Admin-Key` o trae una incorrecta
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}` sin listar ni leer objetos en S3

### Requirement: Listado de asignaciones pendientes
El sistema SHALL exponer `GET /supervisors/assignments/agents/{agent}/{campaign}`, protegido con `X-Admin-Key`, que lista los archivos del agente bajo `assignments/agents/{campaign}/` ordenados del más reciente al más antiguo.

#### Scenario: Listado
- **WHEN** se consulta el listado de un agente con llave válida
- **THEN** el sistema responde 200 con `{"success":true,"data":{"agent","campaign","prefix","items":[{"key","lastModified","size"}]}}`, con `items` vacío si no hay archivos

#### Scenario: Error de S3
- **WHEN** falla el listado en S3
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor"}`

#### Scenario: Sin llave de administración
- **WHEN** la solicitud no trae `X-Admin-Key` válida, o la llave no está configurada en el servidor
- **THEN** el sistema responde 401 con `No autorizado` (o 503 con `Admin key no configurada`) sin listar objetos en S3

### Requirement: Consulta de la asignación pendiente más reciente
El sistema SHALL exponer `GET /supervisors/assignments/agents/{agent}/{campaign}/contacts`, protegido con `X-Admin-Key`, que devuelve con `Content-Type: text/csv` el archivo más reciente del agente bajo `assignments/agents/{campaign}/`, sin eliminarlo.

#### Scenario: Asignación existente
- **WHEN** existen archivos del agente en el prefijo y la llave es válida
- **THEN** el sistema responde 200 con el CSV del más reciente

#### Scenario: Sin asignaciones
- **WHEN** no hay archivos del agente en el prefijo y la llave es válida
- **THEN** el sistema responde 404 con `{"success":false,"message":"CSV assignment no encontrado"}`

#### Scenario: Sin llave de administración
- **WHEN** la solicitud no trae `X-Admin-Key` o trae una incorrecta
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}` sin leer objetos en S3
