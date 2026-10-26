# Proposal

## Why

`POST /auth/verify` busca las credenciales en `agents/{campaign en minúsculas}/credentials.csv`, pero `POST /credentials/upload`, `POST /credentials/regenerate` y `GET /credentials/{campaign}` usan la campaña tal como llega. Si un supervisor sube credenciales para `Prueba`, quedan en `agents/Prueba/credentials.csv` y ningún agente puede iniciar sesión (el CLI además convierte la campaña a minúsculas al escribirla). El mismo defecto afecta a los contactos: una carga de supervisor a `.../Prueba/contacts` queda en `assignments/agents/Prueba/` o `agents/Prueba/`, prefijos que el CLI (que consulta `/get/chats/{agente}/prueba`) nunca lee. Lo mismo ocurre con el identificador de agente: contactos subidos para `Erick` quedan como `Erick-contacts-*.csv` y el CLI de `erick` (el login también fuerza minúsculas) no los encuentra. En todos los casos el fallo es silencioso: la carga responde 200.

## What Changes

- Una única regla de normalización (quitar espacios laterales y convertir a minúsculas), en una familia de helpers compartida, aplicada a la campaña y al identificador de agente antes de construir o comparar cualquier llave, prefijo o nombre de archivo S3 en:
  - credenciales: `GET /credentials/{campaign}`, `POST /credentials/upload`, `POST /credentials/regenerate` y `POST /auth/verify`;
  - contactos y asignaciones: `POST /supervisors/agents/{agent}/{campaign}/contacts` (incluida la copia en `historic/`), `POST /agents/{agent}/{campaign}/contacts` (legacy), los tres `GET /supervisors/...`, `GET /get/chats/{agentId}/{campaignId}` y `POST /contacts/pending`;
  - respaldos y multimedia: `POST /backups`, `GET /backups/latest/…`, `POST /backups/chat`, `GET /backups/chat/…`, `GET /backups/chats/…` y `POST /media`.
- Una campaña o un agente vacíos tras normalizar se tratan como ausentes (400 actual de cada ruta).
- La columna de usuario del CSV de credenciales no cambia: `/auth/verify` ya compara el usuario en minúsculas en ambos lados.
- Las respuestas que devuelven `agent`, `campaign`, `key` o `prefix` reportan el valor normalizado.
- Migración única: un script (dry-run por defecto, sin sobrescribir ni borrar) copia a la llave normalizada los objetos cuyo segmento de campaña o nombre de archivo de agente (`{agent}-contacts-*.csv`) tenga mayúsculas o espacios, bajo `agents/` (credenciales y contactos listos) y `assignments/agents/` del bucket `ana-backend-storage-prod`.
- Suite mínima de pruebas (vitest) en `v3/ana-backend` que fija la llave S3 usada por cada ruta.
- **BREAKING** (operativo, no para el CLI): consultas de supervisor con `Erick`/`Prueba` pasan a operar sobre `erick`/`prueba`; objetos existentes con mayúsculas dejan de verse por la API hasta ejecutar la migración.

Fuera de alcance: plantillas (`/templates`, bucket compartido con el motor; ver design.md).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v3/campaign-credentials`: la ubicación del CSV usa la campaña normalizada en consulta, carga y regeneración; las respuestas reportan la campaña normalizada.
- `v3/agent-auth`: la fuente de credenciales usa la misma normalización (incluye quitar espacios laterales), y el escenario "Campaña con mayúsculas en S3" cambia de rechazo a éxito cuando el CSV se subió por la API.
- `v3/agent-assignments`: la disposición de llaves usa la campaña normalizada y usa campaña y agente normalizados y se agrega el requisito de normalización de ambos en todas las rutas de contactos y asignaciones.
- `v3/chat-backups`: se agrega el requisito de normalización de campaña y agente en respaldos y multimedia.

## Impact

- Código: `v3/ana-backend/src/handlers/{credentials,auth,supervisors,chats,contacts,backups,chatBackups,media}.ts` y nuevo helper en `v3/ana-backend/src/lib/campaign.ts`.
- Herramientas: script de migración en `v3/ana-backend/scripts/` (se ejecuta una vez contra prod con el perfil AWS `pernexium`).
- Dependencias de desarrollo: `vitest`, `aws-sdk-client-mock` y `tsx` en `v3/ana-backend` (no afectan el bundle de Lambda).
- CLI instalado: sin cambios; ya envía campaña y agente en minúsculas, por lo que para sus rutas la normalización no cambia ninguna llave.
- Procesos externos que suben contactos (v4 `master.ts` vía `POST /supervisors/...`): sus archivos pasan a quedar en el prefijo en minúsculas, que es el único que el CLI lee.
- Coordinación con `secure-assignment-consumption`: ambos cambios tocan `chats.ts`, `supervisors.ts` y `auth.ts` (ver design.md, Dependencias con otros cambios).
