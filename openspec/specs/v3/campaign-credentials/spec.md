# campaign-credentials Specification

## Purpose
Permitir a supervisores consultar, subir y regenerar el CSV de credenciales (usuario + palabra del día) de cada campaña, almacenado en S3 y consumido por la verificación de agentes.

> Nota: no existe rotación automática; la regeneración es manual vía API. La respuesta de regeneración devuelve en claro las frases anteriores y nuevas. El script `setup-campaign.sh` no envía `X-Admin-Key`, por lo que sus llamadas a estas rutas fallan con 401/503 tras el cambio de seguridad.

## Requirements

### Requirement: Protección con llave de administración
El sistema MUST exigir el header `X-Admin-Key` válido en `GET /credentials/{campaign}`, `POST /credentials/upload` y `POST /credentials/regenerate` antes de cualquier otra validación o acceso a S3.

#### Scenario: Llave ausente o incorrecta
- **WHEN** se llama a cualquiera de las rutas de credenciales sin `X-Admin-Key` o con un valor distinto al configurado
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}`

#### Scenario: Llave no configurada en el servidor
- **WHEN** la variable de entorno de la llave de administración está vacía
- **THEN** el sistema responde 503 con `{"success":false,"message":"Admin key no configurada"}` sin importar el header enviado

### Requirement: Ubicación del CSV de credenciales
El sistema SHALL almacenar las credenciales de cada campaña en el objeto S3 `agents/{campaign}/credentials.csv`, usando el valor de `campaign` tal como llega (sin normalizar mayúsculas), con encabezado `user,dailyPassword` y una fila `usuario,frase` por agente.

#### Scenario: Ruta del objeto
- **WHEN** un supervisor sube credenciales para la campaña `prueba`
- **THEN** el CSV queda en `agents/prueba/credentials.csv`

### Requirement: Consulta de credenciales
El sistema SHALL devolver en `GET /credentials/{campaign}` el contenido crudo del CSV de credenciales con `Content-Type: text/csv` y estado 200, y MUST NOT crear credenciales por defecto cuando no existan.

#### Scenario: Credenciales existentes
- **WHEN** existe `agents/{campaign}/credentials.csv`
- **THEN** el sistema responde 200 con el CSV tal como está almacenado

#### Scenario: Campaña sin credenciales
- **WHEN** el objeto no existe
- **THEN** el sistema responde 404 con `{"success":false,"message":"Campaña sin credenciales; súbelas con POST /credentials/upload"}`
- **AND** no se escribe ningún objeto en S3

#### Scenario: Error de lectura
- **WHEN** S3 falla con un error distinto de objeto inexistente
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor","error":<detalle>}`

### Requirement: Carga de credenciales
El sistema SHALL aceptar en `POST /credentials/upload` un body JSON `{campaign, csv}` y reemplazar íntegramente el CSV de la campaña con el texto recibido, siempre que la primera línea contenga (sin distinguir mayúsculas) `user` y `dailypassword`.

#### Scenario: Carga exitosa
- **WHEN** se envía `{"campaign":"prueba","csv":"user,dailyPassword\nerick,frase-1"}` con llave válida
- **THEN** el sistema escribe el CSV en `agents/prueba/credentials.csv` con `Content-Type: text/csv`
- **AND** responde 200 con `{"success":true,"message":"Credenciales subidas correctamente","data":{"campaign","key","usersCount","timestamp"}}`, donde `usersCount` es el número de líneas menos el encabezado

#### Scenario: JSON inválido
- **WHEN** el body no es JSON parseable
- **THEN** el sistema responde 400 con `{"success":false,"message":"Body debe ser JSON válido con campos: campaign y csv"}`

#### Scenario: Campos faltantes
- **WHEN** falta `campaign` o `csv`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Campaña y CSV son requeridos"}`

#### Scenario: Encabezado inválido
- **WHEN** la primera línea del CSV no contiene `user` y `dailypassword`
- **THEN** el sistema responde 400 con `{"success":false,"message":"CSV debe tener columnas: user,dailyPassword"}`

### Requirement: Regeneración de palabras del día
El sistema SHALL, en `POST /credentials/regenerate` con body JSON `{campaign}`, reemplazar la palabra del día de cada fila del CSV por una frase nueva generada con aleatoriedad criptográfica con formato `<frase-de-catálogo>-<número de 4 dígitos entre 1000 y 9999>`, conservando el encabezado y el usuario de cada fila.

#### Scenario: Regeneración exitosa
- **WHEN** existe el CSV de la campaña con al menos una fila de usuario y la llave es válida
- **THEN** el sistema reescribe `agents/{campaign}/credentials.csv` con una fila `usuario,nuevaFrase` por usuario, descartando columnas adicionales y filas con menos de dos columnas
- **AND** responde 200 con `{"success":true,"message":"Palabras del día regeneradas correctamente","data":{"campaign","updatesCount","updates":[{"user","oldPassword","newPassword"}],"timestamp"}}`

#### Scenario: Campaña faltante o JSON inválido
- **WHEN** el body no es JSON válido
- **THEN** el sistema responde 400 con `{"success":false,"message":"Body debe ser JSON válido con campo: campaign"}`
- **AND** si el JSON es válido pero sin `campaign`, responde 400 con `{"success":false,"message":"Campaña requerida"}`

#### Scenario: CSV inexistente
- **WHEN** no existe `agents/{campaign}/credentials.csv`
- **THEN** el sistema responde 404 con `{"success":false,"message":"CSV de credenciales no encontrado"}`

#### Scenario: CSV sin filas de usuario
- **WHEN** el CSV tiene menos de dos líneas
- **THEN** el sistema responde 400 con `{"success":false,"message":"CSV vacío o inválido"}`

#### Scenario: Error inesperado
- **WHEN** falla la escritura o lectura en S3 por otra causa
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor","error":<detalle>}`
