# Spec Delta

## MODIFIED Requirements

### Requirement: Sincronización con el backend
Cada respaldo automático SHALL normalizar el teléfono al formato `521` + 10 dígitos, obtener el respaldo existente con `GET {API ANA}/backups/chat/{campaign}/{agent_id}/{teléfono}` y comparar un hash de `id`, `timestamp`, `body` y `from` de todos los mensajes. Si los hashes difieren o no hay respaldo previo, MUST enviar `POST {API ANA}/backups/chat` con `{ campaign, agent_id, contact_phone, messages }`. Solo SHALL ejecutarse un respaldo a la vez.

#### Scenario: Normalización del teléfono de respaldo
- **WHEN** el teléfono detectado es `5512345678` o `525512345678`
- **THEN** el respaldo usa `contact_phone` `5215512345678`

#### Scenario: Teléfono con formato
- **WHEN** el teléfono detectado es `+52 1 55 1234 5678`
- **THEN** el respaldo usa `contact_phone` `5215512345678`

#### Scenario: Sin cambios
- **WHEN** el hash local coincide con el del respaldo remoto
- **THEN** no se envía el respaldo y, si el respaldo es visible, se muestra "No hay cambios en el chat"

#### Scenario: Mensajes nuevos
- **WHEN** el hash local difiere del remoto
- **THEN** se envían todos los mensajes extraídos y se muestra "Chat respaldado ({n} nuevos mensajes)" con el valor `stats.new_messages` de la respuesta

#### Scenario: Error del backend
- **WHEN** el `POST` responde sin éxito
- **THEN** se muestra "Error al respaldar chat"

> Nota: el teléfono de respaldo usa formato `521...` mientras la gestión y el monitor usan `+52...`; es intencional, porque los respaldos existentes están guardados bajo llaves `backups/{campaign}/{agent_id}/521.../`.

## ADDED Requirements

### Requirement: Estabilidad de la llave de respaldo
El formato `521` + 10 dígitos de `contact_phone` en respaldos automáticos y en la consulta "Ver" del historial MUST mantenerse entre versiones del CLI mientras existan respaldos guardados con él, para que cada conversación siga leyéndose y actualizándose bajo la misma llave.

#### Scenario: Actualización del CLI
- **WHEN** un agente actualiza el CLI y abre un chat que ya tenía respaldo
- **THEN** el respaldo se lee y se actualiza bajo la misma llave `backups/{campaign}/{agent_id}/5215512345678/chat_backup.json`, sin crear una llave nueva
