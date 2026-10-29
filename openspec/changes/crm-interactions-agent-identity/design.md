# Design

## Context

El CLI v3 arma las interacciones en cuatro lugares (`index.js`, `whatsapp-manual.js` ×2, `whatsapp-monitor.js`) con la constante `INTERACTIONS_USER_ID`, y todas pasan por `insertInteractions` (`agent-config.js`). El backend v3 ya autentica al agente en `GET /agent/campaigns`, que el CLI llama en el login y en los refrescos de acceso.

## Goals / Non-Goals

**Goals:** registrar cada gestión con el `user_id` del agente, que el agente siempre sea identificable y que toda gestión indique que vino de ANA, sin romper CLIs instalados.

**Non-Goals:** v4 (pendiente), mapear agentes sin registro en Roles, persistir la identidad en disco.

## Decisions

- **D1 — v3 consulta Roles directamente** (no vía v4 `GET /me`): elimina la dependencia de despliegue con v4 y de que el authorizer de v4 acepte el token del CLI. Caché en memoria de 10 min solo de éxitos; `user_id` debe ser UUID; ante fallo `{crmUserId: null, displayName: null}` con 200.
- **D2 — Resolución centralizada en `insertInteractions`**: los builders siguen poniendo el legado; `insertInteractions` sustituye el legado (o su ausencia) por el `crmUserId` vigente y aplica la marca. Un `user_id` explícito distinto del legado se respeta. Así no se toca el loop de envío de `index.js` (otros cambios en curso).
- **D3 — Identidad ligada al username de la sesión**: solo se usa si coincide con el agente de la sesión; si no, se trata como sin identidad. No se persiste.
- **D4 — Fallback**: cualquier 4xx con el id del agente provoca un único reintento con el legado + sufijo; 5xx o error de red no reintentan (evita duplicados por timeouts). Sin `crmUserId`: legado + sufijo desde el primer intento.
- **D5 — Marca de ANA**: vacío → `Registrado vía ANA`; con contenido → `{comments} | vía ANA`; en fallback o sin identidad se añade ` · Agente: {username} ({name})`. Se quita una marca previa antes de aplicarla (sin duplicados). Límite asumido de 500 caracteres (el CRM no lo documenta); se trunca el original con `…` contando code points, y el nombre a 120.
- **D6 — Logs**: `[crm-identity] user_id=<agent|legacy_no_identity|legacy_fallback> agente=<username>`; sin nombre ni otros datos personales.

## Risks / Trade-offs

- Si el CRM acepta un `user_id` desconocido sin validarlo, se guardaría con un id huérfano → validar con un agente piloto antes del release general.
- Un 404 por teléfono (no por usuario) también dispara el reintento con legado; el costo es un POST extra.
- El límite de 500 es una suposición; ajustar `MAX_COMMENTS_LENGTH` si el CRM documenta otro.
