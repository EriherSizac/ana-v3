# Spec Delta

## MODIFIED Requirements

### Requirement: Listado de plantillas
El sistema SHALL exponer `GET /templates?campaign=X&channel=Y`, protegido con autenticación de agente (`v3/agent-auth`: ID token válido cuyo usuario está habilitado en el roster de `campaign`, sujeto al modo de transición; la ruta no tiene agente propio), que lista los objetos bajo `templates/{campaign}/{channel}/` (excluyendo el propio prefijo).

#### Scenario: Listado exitoso
- **WHEN** se consulta con `campaign` y `channel` sin `key` y un token de un agente habilitado en `campaign`
- **THEN** el sistema responde 200 con `{"files":[{"key","filename"}]}`, donde `filename` es la llave sin el prefijo

#### Scenario: Campaña fuera del roster en modo estricto
- **WHEN** `AGENT_AUTH_ENFORCED` es `true` y el agente del token no está habilitado en `campaign`, o la solicitud no trae token
- **THEN** el sistema responde 403 (o 401 sin token) sin listar ni leer el bucket de templates, también cuando se envía `key`

#### Scenario: Parámetros faltantes
- **WHEN** falta `campaign` o `channel`
- **THEN** el sistema responde 400 con `{"error":"campaign y channel son requeridos"}`

#### Scenario: Error de listado
- **WHEN** falla el listado en S3
- **THEN** el sistema responde 500 con `{"error":"Error al listar los templates"}`
