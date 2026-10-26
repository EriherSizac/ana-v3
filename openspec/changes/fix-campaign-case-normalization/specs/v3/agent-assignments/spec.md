# Spec Delta

## MODIFIED Requirements

### Requirement: Disposición de llaves S3 de asignaciones
El sistema SHALL usar en el bucket de almacenamiento estas llaves, donde `{ts}` es la fecha ISO 8601 UTC con `:` y `.` reemplazados por `-` (p. ej. `2026-10-26T15-04-05-123Z`): `assignments/agents/{campaign}/{agent}-contacts-{ts}.csv` (pendientes), `agents/{campaign}/{agent}-contacts-{ts}.csv` (listos para el CLI), `historic/agents/{campaign}/{agent}-contacts-{ts}.csv` (histórico) y `chats/{agent_id}-{campaign}.csv` (pendientes del CLI).

#### Scenario: Identificación de archivos de un agente
- **WHEN** el sistema busca archivos de contactos del agente `erick` bajo un prefijo de campaña
- **THEN** considera solo objetos cuyo nombre de archivo empiece con `erick-contacts` y termine en `.csv`

#### Scenario: Llaves con campaña y agente normalizados
- **WHEN** cualquier ruta de esta capacidad recibe la campaña `" Prueba "` y el agente `" Erick "` (en la ruta o en el body)
- **THEN** la llave S3 que escribe, lista o lee usa los segmentos `prueba` y `erick` (p. ej. `assignments/agents/prueba/erick-contacts-{ts}.csv`, `agents/prueba/erick-contacts-{ts}.csv`, `historic/agents/prueba/erick-contacts-{ts}.csv`, `chats/erick-prueba.csv`)

#### Scenario: Archivo heredado con agente en mayúsculas
- **WHEN** solo existe un objeto antiguo `agents/prueba/Erick-contacts-{ts}.csv` (anterior a la normalización y no migrado)
- **THEN** las búsquedas del agente `erick` no lo consideran

## ADDED Requirements

### Requirement: Normalización de campaña y agente en rutas de asignaciones
El sistema SHALL normalizar campaña y agente (sin espacios laterales, en minúsculas) con la misma regla que las rutas de credenciales antes de construir o comparar llaves S3 en la carga de contactos de supervisor, la publicación legacy, las consultas y listados de asignaciones, `/get/chats` y `/contacts/pending`. Un valor vacío tras normalizar MUST tratarse como ausente con el 400 actual de cada ruta.

#### Scenario: Supervisor sube con mayúsculas y el CLI consume en minúsculas
- **WHEN** un supervisor sube contactos con `POST /supervisors/agents/Erick/Prueba/contacts` y `direct: true`, y el CLI consulta `GET /get/chats/erick/prueba`
- **THEN** el archivo se escribe en `agents/prueba/erick-contacts-{ts}.csv` y el CLI lo recibe

#### Scenario: Consulta de supervisor insensible a mayúsculas
- **WHEN** existen asignaciones en `assignments/agents/prueba/erick-contacts-*.csv` y un supervisor consulta `GET /supervisors/assignments/agents/ERICK/PRUEBA`
- **THEN** el listado devuelve esos archivos y `data.agent`, `data.campaign` y `data.prefix` usan `erick` y `prueba`

#### Scenario: Valor solo con espacios
- **WHEN** `POST /contacts/pending` recibe `campaign: "   "` o `agent_id: "   "`
- **THEN** el sistema responde 400 con `{"error":"campaign y agent_id son requeridos"}` sin escribir en S3
