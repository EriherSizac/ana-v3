# Spec Delta

## MODIFIED Requirements

### Requirement: Respuesta manual
En su propia sesión el agente SHALL responder con texto (Enter o "Enviar"; se ignora texto vacío) o con un archivo adjunto (📎), usando el texto escrito como pie. El envío manual MUST salir sin demora artificial, persistirse en `PUT /messages` (archivo también respaldado en S3) y agregarse al hilo si fue exitoso. Mientras se envía, el campo y los botones SHALL deshabilitarse; el texto y el archivo MUST conservarse hasta confirmar el envío y, si falla, mostrarse "No se envió: <motivo>".

#### Scenario: Envío de texto
- **WHEN** el agente escribe "Hola" y presiona Enter
- **THEN** el mensaje se envía, aparece en el hilo y el campo se vacía

#### Scenario: Falla el envío
- **WHEN** WhatsApp no está conectado y el agente envía
- **THEN** el texto sigue en el campo, el mensaje no aparece en el hilo y se muestra "No se envió: WhatsApp no conectado"

#### Scenario: Doble Enter
- **WHEN** el agente presiona Enter dos veces seguidas
- **THEN** el mensaje se envía una sola vez
