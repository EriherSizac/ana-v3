# backend-api-security Specification

## Purpose
Definir los controles transversales de acceso del backend v3 (HTTP API + Lambda + S3): política CORS, rutas protegidas con llave de administración, rutas intencionalmente públicas y métodos HTTP permitidos.

> Nota: el CLI de agentes es Node y no envía `Origin`, por lo que CORS no lo restringe; las rutas usadas por el CLI no tienen autenticación propia. Varias respuestas 500 incluyen el mensaje del error interno en el body. Este comportamiento corresponde al código en HEAD (commit 9a36660), aún no desplegado en producción.

## Requirements

### Requirement: Política CORS restringida a dominios Pernexium
El sistema SHALL responder las solicitudes preflight CORS desde API Gateway permitiendo únicamente los orígenes `https://pernexium.com.mx`, `https://*.pernexium.com.mx`, `https://pernexium.com` y `https://*.pernexium.com`, los headers `Content-Type`, `Authorization` y `X-Admin-Key`, los métodos `GET`, `POST` y `OPTIONS`, y un `maxAge` de 3600 segundos; los handlers no agregan headers CORS propios.

#### Scenario: Origen permitido
- **WHEN** un navegador en `https://app.pernexium.com.mx` envía un preflight a cualquier ruta
- **THEN** la respuesta incluye `Access-Control-Allow-Origin` con ese origen

#### Scenario: Origen no permitido
- **WHEN** un navegador en `https://ejemplo.com` llama a la API
- **THEN** la respuesta no incluye headers CORS que autoricen ese origen y el navegador bloquea la lectura

#### Scenario: Cliente sin Origin
- **WHEN** un cliente no navegador (CLI, curl) llama a la API sin header `Origin`
- **THEN** la solicitud se procesa normalmente sin intervención de CORS

### Requirement: Llave de administración en rutas de supervisor
El sistema MUST exigir el header `X-Admin-Key` (nombre sin distinguir mayúsculas) igual a la llave configurada en el entorno, comparada en tiempo constante, en estas rutas: `GET /credentials/{campaign}`, `POST /credentials/upload`, `POST /credentials/regenerate`, `POST /supervisors/agents/{agent}/{campaign}/contacts`, `POST /supervisors/files/download`, `POST /agents/{agent}/{campaign}/contacts` y `POST /templates`.

#### Scenario: Llave correcta
- **WHEN** la solicitud incluye `X-Admin-Key` igual a la llave configurada
- **THEN** el handler continúa con su validación y lógica normal

#### Scenario: Llave ausente o incorrecta
- **WHEN** el header falta o su valor difiere (incluida una longitud distinta)
- **THEN** el sistema responde 401 con `{"success":false,"message":"No autorizado"}` y `Content-Type: application/json`, sin acceder a S3

#### Scenario: Llave no configurada (fail-closed)
- **WHEN** la llave de administración del entorno está vacía o no definida
- **THEN** el sistema responde 503 con `{"success":false,"message":"Admin key no configurada"}` en todas las rutas protegidas, sin abrirlas

### Requirement: Rutas intencionalmente públicas
El sistema SHALL atender sin autenticación las rutas usadas por el CLI de agentes y las consultas de supervisor: `GET /`, `POST /auth/verify`, `POST /backups`, `GET /backups/latest/{agentId}/{campaign}`, `POST /backups/chat`, `GET /backups/chat/{campaign}/{agentId}/{contactPhone}`, `GET /backups/chats/{campaign}/{agentId}`, `GET /get/chats/{agentId}/{campaignId}`, `POST /media`, `POST /contacts/pending`, `GET /templates` y los tres `GET /supervisors/...`.

#### Scenario: Acceso público
- **WHEN** un cliente sin `X-Admin-Key` llama a `GET /supervisors/assignments/agents/{agent}/{campaign}`
- **THEN** el sistema procesa la solicitud y responde según la lógica de la ruta (200/404/500)

### Requirement: Endpoint raíz de prueba
El sistema SHALL responder `GET /` con 200 y `{"message":"Go Serverless v4! Your function executed successfully!"}`.

#### Scenario: Comprobación de vida
- **WHEN** se llama a `GET /`
- **THEN** el sistema responde 200 con el mensaje fijo

### Requirement: Rutas y métodos expuestos
El sistema MUST exponer únicamente las combinaciones de método y ruta declaradas en la configuración del servicio (solo `GET` y `POST`); cualquier otra combinación no llega a ningún handler.

#### Scenario: Método no declarado
- **WHEN** se envía `DELETE /backups`
- **THEN** API Gateway responde 404 sin invocar ninguna función

### Requirement: Aislamiento de almacenamiento
El sistema SHALL operar sobre el bucket de almacenamiento `ana-backend-storage-{stage}` con permisos de lectura, escritura, listado y borrado, y sobre el bucket de templates con escritura/lectura limitadas al prefijo `templates/` y listado del bucket.

#### Scenario: Lectura fuera del prefijo de templates
- **WHEN** se solicita una plantilla con una llave fuera de `templates/`
- **THEN** S3 deniega el acceso y la ruta responde 500
