# agent-auth Specification

## Purpose
Validar el acceso de los agentes del CLI de WhatsApp mediante la combinación usuario + campaña + "palabra del día", contrastada contra el CSV de credenciales de la campaña almacenado en S3.

> Nota: la ruta es pública (sin X-Admin-Key) por diseño; no existe límite de intentos ni bloqueo por fuerza bruta, y no se emite ningún token de sesión: la respuesta exitosa es solo un acuse.

## Requirements

### Requirement: Endpoint de verificación de credenciales
El sistema SHALL exponer `POST /auth/verify` sin autenticación previa, aceptando un body JSON con los campos `user`, `campaign` y `dailyPassword`.

#### Scenario: Verificación exitosa
- **WHEN** se envía `POST /auth/verify` con `{"user":"Erick","campaign":"Prueba","dailyPassword":"<frase vigente>"}` y el CSV de la campaña contiene al usuario con esa frase
- **THEN** el sistema responde 200 con `{"success":true,"message":"Credenciales verificadas correctamente","data":{"user","campaign","timestamp"}}`
- **AND** `data.user` y `data.campaign` se devuelven en minúsculas y `timestamp` en ISO 8601

### Requirement: Validación de campos de entrada
El sistema MUST rechazar con 400 las solicitudes sin body o con alguno de los campos `user`, `campaign` o `dailyPassword` ausente o vacío.

#### Scenario: Body ausente
- **WHEN** se envía `POST /auth/verify` sin body
- **THEN** el sistema responde 400 con `{"success":false,"message":"Body requerido"}`

#### Scenario: Campo faltante
- **WHEN** el body JSON omite `dailyPassword` (o `user`, o `campaign`)
- **THEN** el sistema responde 400 con `{"success":false,"message":"Usuario, campaña y palabra del día son requeridos"}`

#### Scenario: Body con JSON inválido
- **WHEN** el body no es JSON parseable
- **THEN** el sistema responde 500 con `{"success":false,"message":"Error interno del servidor","error":<mensaje del parser>}`

### Requirement: Fuente de credenciales por campaña
El sistema SHALL leer las credenciales desde el objeto S3 `agents/{campaign}/credentials.csv` del bucket de almacenamiento, usando el nombre de campaña convertido a minúsculas, ignorando la primera línea (encabezado) y tomando de cada línea no vacía la primera columna como usuario (en minúsculas, sin espacios laterales) y la segunda como palabra del día (sin espacios laterales).

#### Scenario: Campaña sin archivo de credenciales
- **WHEN** no existe `agents/{campaign}/credentials.csv` o el archivo no contiene filas de usuario válidas
- **THEN** el sistema responde 401 con `{"success":false,"message":"Campaña no encontrada o sin credenciales configuradas"}`

#### Scenario: Campaña con mayúsculas en S3
- **WHEN** las credenciales se subieron con un nombre de campaña con mayúsculas (p. ej. `agents/Prueba/credentials.csv`) y el agente verifica con `campaign: "Prueba"`
- **THEN** el sistema busca `agents/prueba/credentials.csv` y responde 401 por no encontrar credenciales

### Requirement: Comparación de usuario y palabra del día
El sistema MUST comparar el usuario sin distinguir mayúsculas/minúsculas y la palabra del día de forma exacta (sensible a mayúsculas), respondiendo 401 con un mensaje que distingue la causa del rechazo.

#### Scenario: Usuario no registrado en la campaña
- **WHEN** el usuario no aparece en el CSV de la campaña
- **THEN** el sistema responde 401 con `{"success":false,"message":"Usuario no autorizado en esta campaña"}`

#### Scenario: Palabra del día incorrecta
- **WHEN** el usuario existe pero `dailyPassword` no coincide exactamente con la registrada
- **THEN** el sistema responde 401 con `{"success":false,"message":"Palabra del día incorrecta"}`

### Requirement: Errores internos
El sistema SHALL responder 500 con `{"success":false,"message":"Error interno del servidor","error":<detalle>}` ante cualquier error inesperado, incluido un error de S3 distinto de "objeto inexistente".

#### Scenario: Fallo de S3
- **WHEN** la lectura de S3 falla con un error distinto de `NoSuchKey` (p. ej. AccessDenied)
- **THEN** el sistema responde 500 e incluye el mensaje del error en el campo `error`
