# Spec Delta

## MODIFIED Requirements

### Requirement: Validación de campos de entrada
El sistema MUST rechazar con 400 las solicitudes sin body o con alguno de los campos `user`, `campaign` o `dailyPassword` ausente o vacío; `campaign` se considera vacío también cuando solo contiene espacios.

#### Scenario: Body ausente
- **WHEN** se envía `POST /auth/verify` sin body
- **THEN** el sistema responde 400 con `{"success":false,"message":"Body requerido"}`

#### Scenario: Campo faltante
- **WHEN** el body JSON omite `dailyPassword` (o `user`, o `campaign`)
- **THEN** el sistema responde 400 con `{"success":false,"message":"Usuario, campaña y palabra del día son requeridos"}`

#### Scenario: Campaña solo con espacios
- **WHEN** el body JSON trae `campaign: "   "`
- **THEN** el sistema responde 400 con `{"success":false,"message":"Usuario, campaña y palabra del día son requeridos"}` sin acceder a S3

#### Scenario: Body con JSON inválido
- **WHEN** el body no es JSON parseable
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor","error":<mensaje del parser>}`

### Requirement: Fuente de credenciales por campaña
El sistema SHALL leer las credenciales desde el objeto S3 `agents/{campaign}/credentials.csv` del bucket de almacenamiento, usando el nombre de campaña normalizado igual que las rutas de credenciales (sin espacios laterales y en minúsculas), ignorando la primera línea (encabezado) y tomando de cada línea no vacía la primera columna como usuario (en minúsculas, sin espacios laterales) y la segunda como palabra del día (sin espacios laterales).

#### Scenario: Campaña sin archivo de credenciales
- **WHEN** no existe `agents/{campaign}/credentials.csv` o el archivo no contiene filas de usuario válidas
- **THEN** el sistema responde 401 con `{"success":false,"message":"Campaña no encontrada o sin credenciales configuradas"}`

#### Scenario: Campaña con mayúsculas en S3
- **WHEN** un supervisor subió credenciales con `campaign: "Prueba"` mediante `POST /credentials/upload` y el agente verifica con `campaign: "Prueba"`, `"prueba"` o `" prueba "`
- **THEN** el sistema lee `agents/prueba/credentials.csv` y valida usuario y palabra del día contra ese archivo
- **AND** en la respuesta exitosa `data.campaign` es `prueba`

#### Scenario: Objeto heredado con mayúsculas en S3
- **WHEN** solo existe un objeto antiguo `agents/Prueba/credentials.csv` (anterior a la normalización y no migrado)
- **THEN** el sistema busca únicamente `agents/prueba/credentials.csv` y responde 401 con `Campaña no encontrada o sin credenciales configuradas`
