# Spec Delta

## MODIFIED Requirements

### Requirement: Descarga de media prefirmada
`GET /media/url?key=` SHALL requerir que `key` empiece con `media/` y que su segundo segmento sea una codificación válida de operador (si no, 400 `{"error":"key inválida"}`), tomar como dueño el operador decodificado y autorizar igual que "ver como" de conversaciones: propio usuario o admin; si no, 403 `{"error":"sin permiso"}`. Responde 200 `{"url"}` con un GET prefirmado. Requiere `ana:chats:conversation:view` (sujeto al flag).

#### Scenario: Media de otro agente
- **WHEN** un agente no admin pide `key = media/otro/123_a.jpg`
- **THEN** el sistema responde 403

#### Scenario: Media propia con caracteres especiales
- **WHEN** el operador `a@b` pide una llave de su propia media `media/a~40b/123_a.jpg`
- **THEN** el sistema responde 200 con la URL

#### Scenario: Usuario parecido
- **WHEN** el operador `a_b` pide `media/a~40b/123_a.jpg`
- **THEN** el sistema responde 403

## ADDED Requirements

### Requirement: Segmento de operador en llaves S3
El segmento `<usuario>` de las llaves `media/<usuario>/…` y `wa-sessions/<usuario>/session.zip` MUST ser la codificación inyectiva del `operatorId` canónico: cada carácter de `[a-z0-9._-]` se conserva y cualquier otro byte UTF-8, incluido `~`, se escribe como `~` seguido de dos dígitos hexadecimales en minúsculas. Dos operadores distintos SHALL NOT compartir prefijo ni sesión de WhatsApp.

#### Scenario: Usuarios que antes colisionaban
- **WHEN** existen los operadores `a@b` y `a_b`
- **THEN** sus sesiones se guardan en `wa-sessions/a~40b/session.zip` y `wa-sessions/a_b/session.zip`, y ninguno puede obtener la URL de la del otro

#### Scenario: Username común
- **WHEN** el operador es `erick.silva`
- **THEN** su media se guarda bajo `media/erick.silva/`
