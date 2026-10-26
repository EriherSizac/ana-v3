# Spec Delta

## ADDED Requirements

### Requirement: Mensajes propios desde otros dispositivos
El cliente SHALL respaldar también los mensajes propios creados fuera de la app (teléfono, WhatsApp Web en otro equipo) con la misma normalización, manejo de media y persistencia en `PUT /messages` que los entrantes. Un mensaje propio enviado por la app MUST quedar respaldado una sola vez.

#### Scenario: Agente responde desde su teléfono
- **WHEN** el agente escribe a un contacto desde el WhatsApp de su teléfono
- **THEN** el mensaje aparece en el respaldo de esa conversación como propio

#### Scenario: Envío desde la app
- **WHEN** la app envía una respuesta manual
- **THEN** el respaldo contiene ese mensaje una sola vez
