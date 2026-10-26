# Spec Delta

## ADDED Requirements

### Requirement: Normalización de campaña y agente en respaldos y multimedia
El sistema SHALL normalizar campaña y agente (sin espacios laterales, en minúsculas) con la misma regla que las rutas de credenciales antes de construir las llaves o prefijos `backups/{campaign}/…` y `media/{campaign}/{agent_id}/…` en `POST /backups`, `GET /backups/latest/…`, `POST /backups/chat`, `GET /backups/chat/…`, `GET /backups/chats/…` y `POST /media`. Un valor vacío tras normalizar MUST tratarse como ausente con el 400 actual de cada ruta.

#### Scenario: Respaldo con mayúsculas
- **WHEN** se envía `POST /backups/chat` con `campaign: "Prueba"` y `agent_id: "Erick"`, y luego `GET /backups/chats/prueba/erick`
- **THEN** el respaldo se guarda bajo `backups/prueba/erick/…` y el listado lo incluye

#### Scenario: Respaldo diario
- **WHEN** se envía `POST /backups` con `agent_id: " Erick "` y luego `GET /backups/latest/erick/prueba`
- **THEN** el respaldo se guarda como `backups/prueba/{YYYY-MM}/erick_{DD}.json` y la consulta lo encuentra

#### Scenario: URL de multimedia
- **WHEN** se envía `POST /media` con `campaign: " Prueba "` y `agent_id: "Erick"`
- **THEN** el archivo se guarda en `media/prueba/erick/{filename}` y la URL devuelta usa esos mismos segmentos

#### Scenario: Valor solo con espacios
- **WHEN** `POST /backups` recibe `campaign: "   "` o `agent_id: "   "`
- **THEN** el sistema responde 400 con `{"error":"campaign, agent_id and data fields are required"}` sin escribir en S3
