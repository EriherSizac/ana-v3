# Spec Delta

## MODIFIED Requirements

### Requirement: Ubicación del CSV de credenciales
El sistema SHALL almacenar las credenciales de cada campaña en el objeto S3 `agents/{campaign}/credentials.csv`, donde `{campaign}` es el nombre recibido normalizado (sin espacios laterales y en minúsculas), con encabezado `user,dailyPassword` y una fila `usuario,frase` por agente. Consulta, carga y regeneración MUST usar la misma normalización; una campaña vacía tras normalizar se trata como ausente.

#### Scenario: Ruta del objeto
- **WHEN** un supervisor sube credenciales para la campaña `prueba`
- **THEN** el CSV queda en `agents/prueba/credentials.csv`

#### Scenario: Campaña con mayúsculas y espacios
- **WHEN** un supervisor sube credenciales con `campaign: " Prueba "`
- **THEN** el CSV queda en `agents/prueba/credentials.csv`
- **AND** `GET /credentials/PRUEBA` y `POST /credentials/regenerate` con `{"campaign":"Prueba"}` operan sobre ese mismo objeto

#### Scenario: Campaña solo con espacios
- **WHEN** se envía `campaign: "   "` a carga o regeneración, o `GET /credentials/%20`
- **THEN** el sistema responde 400 con el mensaje de campo requerido de cada ruta (`Campaña y CSV son requeridos` en carga, `Campaña requerida` en regeneración y consulta) sin acceder a S3

### Requirement: Carga de credenciales
El sistema SHALL aceptar en `POST /credentials/upload` un body JSON `{campaign, csv}` y reemplazar íntegramente el CSV de la campaña con el texto recibido, siempre que la primera línea contenga (sin distinguir mayúsculas) `user` y `dailypassword`.

#### Scenario: Carga exitosa
- **WHEN** se envía `{"campaign":"Prueba","csv":"user,dailyPassword\nerick,frase-1"}` con llave válida
- **THEN** el sistema escribe el CSV en `agents/prueba/credentials.csv` con `Content-Type: text/csv`
- **AND** responde 200 con `{"success":true,"message":"Credenciales subidas correctamente","data":{"campaign","key","usersCount","timestamp"}}`, donde `campaign` es la campaña normalizada (`prueba`), `key` la llave escrita y `usersCount` el número de líneas menos el encabezado

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
- **AND** responde 200 con `{"success":true,"message":"Palabras del día regeneradas correctamente","data":{"campaign","updatesCount","updates":[{"user","oldPassword","newPassword"}],"timestamp"}}`, donde `campaign` es la campaña normalizada

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
