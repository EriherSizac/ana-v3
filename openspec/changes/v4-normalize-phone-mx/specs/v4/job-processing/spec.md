# Spec Delta

## MODIFIED Requirements

### Requirement: Envío de un job
Para cada job el main SHALL normalizar el teléfono con la lada del job (si no se puede, el resultado MUST ser `error` "Teléfono inválido" sin consultar WhatsApp) y resolver el número real con WhatsApp; si no existe, el resultado es "No tiene WhatsApp". Si existe, MUST interpolar la plantilla con la fila, mostrar "escribiendo…" entre 2 y 9 segundos (70 ms por carácter), enviar, persistir el mensaje en `PUT /messages` y los datos del contacto en `PUT /conversations/meta`.

#### Scenario: Número sin WhatsApp
- **WHEN** WhatsApp no reconoce el número
- **THEN** el job queda como `no_whatsapp` y no se envía nada

#### Scenario: WhatsApp desconectado a media campaña
- **WHEN** el cliente se desconecta durante un lote
- **THEN** cada job restante falla con "WhatsApp no conectado", queda como `error` y se espacia por el ritmo

#### Scenario: Teléfono con formato inválido
- **WHEN** el teléfono del job es "12345"
- **THEN** el job queda como `error` con "Teléfono inválido", no se reporta "No tiene Whatsapp" y el teléfono no se marca sin WhatsApp en el CRM
