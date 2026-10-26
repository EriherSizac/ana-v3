# Spec Delta

## ADDED Requirements

### Requirement: Reintento del reporte al CRM
Si `POST /interactions/report` responde `retryable: true`, un error 5xx o falla la red, el main SHALL reintentar el reporte de ese job hasta 3 veces con esperas de 30 segundos, 2 minutos y 10 minutos, sin bloquear ni retrasar el envío de los siguientes jobs. Una respuesta 2xx sin `retryable` MUST terminar los reintentos.

#### Scenario: CRM caído unos minutos
- **WHEN** el CRM falla al reportar un job y se recupera un minuto después
- **THEN** el segundo intento registra la interacción y el lote siguió enviándose al ritmo normal

#### Scenario: Ya reportado
- **WHEN** la respuesta es `{"reported":false,"reason":"ya reportado"}`
- **THEN** el main no vuelve a reportar ese job
