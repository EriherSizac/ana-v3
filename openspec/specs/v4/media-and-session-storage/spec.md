# media-and-session-storage Specification

## Purpose
Gestionar en el bucket `ana-backend-media-<stage>` el almacenamiento de media de WhatsApp (subida de adjuntos entrantes y descarga para visualizarlos) y el zip de sesión de WhatsApp de cada operador (RemoteAuth), siempre mediante URLs prefirmadas de 300 segundos y con claves acotadas al username del JWT.

> Nota: todas las claves usan el username saneado (cualquier carácter fuera de `[A-Za-z0-9_.-]` se reemplaza por `_`), por lo que dos usuarios que solo difieren en esos caracteres (p. ej. `a@b` y `a_b`) comparten prefijo de media y la misma sesión de WhatsApp.

## Requirements

### Requirement: Subida de media prefirmada
`POST /media/presign` con `{filename?, mimetype?}` SHALL responder 200 `{"url","key"}` con un PUT prefirmado a `media/<usuario>/<epochMs>_<filename>` (filename saneado, default `media.bin`). Solo requiere estar autenticado. Si el filename saneado es `.` o `..` MUST responder 400 `{"error":"filename inválido"}`.

#### Scenario: Imagen entrante
- **WHEN** el desktop pide `{"filename":"foto 1.jpg","mimetype":"image/jpeg"}`
- **THEN** recibe una URL para `media/<usuario>/<ts>_foto_1.jpg` con `Content-Type` `image/jpeg`

### Requirement: Content-Type controlado por el servidor
El `Content-Type` firmado SHALL ser el `mimetype` recibido (sin parámetros, en minúsculas) solo si empieza con `image/`, `audio/` o `video/`, o es exactamente `application/pdf` o `application/octet-stream`; en cualquier otro caso MUST firmarse `application/octet-stream`.

#### Scenario: Tipo no permitido
- **WHEN** se pide presign con `mimetype: "text/html"`
- **THEN** la URL se firma con `Content-Type: application/octet-stream`

### Requirement: Descarga de media prefirmada
`GET /media/url?key=` SHALL requerir que `key` empiece con `media/` (si no, 400 `{"error":"key inválida"}`), tomar como dueño el segundo segmento de la clave y autorizar igual que "ver como" de conversaciones: propio usuario o admin; si no, 403 `{"error":"sin permiso"}`. Responde 200 `{"url"}` con un GET prefirmado. Requiere `ana:chats:conversation:view` (sujeto al flag).

#### Scenario: Media de otro agente
- **WHEN** un agente no admin pide `key = media/otro/123_a.jpg`
- **THEN** el sistema responde 403

> Nota: el dueño se compara contra el username sin sanear, así que un usuario con caracteres especiales en su username no puede ver su propia media (solo un admin puede).

### Requirement: Sesión de WhatsApp por operador
El sistema SHALL guardar la sesión de WhatsApp de cada operador en `wa-sessions/<usuario>/session.zip`. `POST /wa-session/presign` con `{op}` MUST devolver 200 `{"url","key"}` con un PUT prefirmado (`Content-Type: application/zip`) si `op` es `"put"`, o un GET prefirmado en cualquier otro caso.

#### Scenario: Restaurar sesión
- **WHEN** el desktop llama `POST /wa-session/presign` con `{}`
- **THEN** recibe una URL GET para su propio `session.zip`

### Requirement: Existencia y borrado de la sesión
`GET /wa-session/exists` SHALL responder 200 `{"exists":true}` si el zip del operador existe y `{"exists":false}` ante cualquier error de lectura. `POST /wa-session/delete` MUST borrar el zip del operador ignorando errores y responder 200 `{"deleted":true}`.

#### Scenario: Logout
- **WHEN** el agente cierra sesión y el desktop llama `POST /wa-session/delete`
- **THEN** el zip se borra y la respuesta es `{"deleted":true}` aunque no existiera

> Nota: `exists:false` también se devuelve ante errores de permisos o de red de S3, no solo cuando falta el objeto.
