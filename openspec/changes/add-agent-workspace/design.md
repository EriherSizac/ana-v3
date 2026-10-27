# Design

## Context

- Referencia: `chatbot-v2-front` (`main`), `src/components/ana/AgentsManager.tsx`: el agente verificaba "palabra del día" (`POST /auth/verify`), listaba `GET /supervisors/assignments/agents/{agent}/{c}`, descargaba con URLs prefirmadas (`/supervisors/files/download` + proxy), combinaba CSV (unión de encabezados), filtraba/ordenaba/seleccionaba filas, escribía el mensaje con `{{col}}` y expresiones (`processMessageExpressions`), renderizaba por fila en el navegador y publicaba con `direct=true` a `agents/` vía la ruta de supervisor. Columnas de teléfono como metadata (el CLI las ignoraba). Las asignaciones nunca se consumían.
- CLI v3: `assignment-csv.js` (`parseAssignmentCsv`, `FIELD_MAPPING`) y `template-utils.js` (`renderTemplate`): renderiza `message` por fila al recibir el CSV (`GET /get/chats`), una sola pasada, `\n` literal → salto de línea.
- Autenticación: `requireAgentToken` (estricto, `/agent/*`) + `getEnabledAgentsCached`; authorizer `cognitoAgentJwt`. El id token de ANA Admin lo emite el mismo App Client que el del CLI (`1r6niimhkl2fmias6kk85n4ou4`, default de `COGNITO_ADMIN_CLIENT_IDS` y `COGNITO_AGENT_CLIENT_IDS`), así que el BFF reenvía el token del usuario sin cambios de configuración.

## Goals / Non-Goals

**Goals:**
- Lo que el agente ve en la vista previa es lo que envía el CLI.
- Ninguna fila publicada vuelve a quedar pendiente; un reintento no duplica envíos.
- El agente solo opera sobre sus propios archivos.

**Non-Goals:**
- Subir CSV propios desde "Mi asignación" (el agente trabaja lo que le asignan).
- Plantillas guardadas por campaña.

## Decisions

### D1. Renderizado en el servidor, vista previa con el mismo algoritmo
El navegador envía solo referencias (`key`, `etag`, índices de fila) + plantilla + columnas de teléfono; v3 relee las fuentes, renderiza y escribe. Así el agente no puede inyectar contactos ni filas de otro, y el backend es la fuente de verdad. La vista previa usa un port TS de `renderTemplate` y del parser del CLI en `admin-web/src/lib/workspace/`; v3 tiene su port en `src/lib/templateRender.ts` y `src/lib/assignmentCsv.ts`. Ambos se prueban contra los módulos reales del CLI (equivalencia con fixtures).
- Alternativa: renderizar en el navegador y subir el CSV final (como el portal anterior) — descartada: el backend no podría verificar que las filas son del agente.
- Alternativa: dejar la plantilla en `message` y que el CLI renderice — descartada: el usuario pidió la columna renderizada, y el render de servidor permite rechazar variables desconocidas antes de enviar.
- Re-render del CLI: el texto ya renderizado no contiene marcadores (se rechazan los no resueltos) y `\n` literal vuelve a ser salto de línea, así que el CLI envía lo mismo.

### D2. Fila combinada y teléfonos
Encabezado combinado = unión de encabezados en el orden de las fuentes (igual que `mergeCsvTables` del portal anterior). Para renderizar, la fila combinada (sin `ana_upload_id`) pasa por el mapeo del CLI y `phone` se fija al teléfono del contacto (una fila por teléfono elegido, ≥ 10 dígitos, sin repetir en la publicación). El archivo publicado pone ese teléfono en `phone_number` y omite los otros alias (el CLI se queda con el último alias del encabezado, y dos alias podrían discrepar).

### D3. Consumo con ETag y rollback
Orden: leer fuentes y verificar ETag (409) → escribir `agents/` + `historic/` → reescribir cada fuente con `IfMatch` (o borrarla) → manifiesto. Si falla el paso 2 o 3: borrar `agents/` (y `historic/`), restaurar las fuentes ya tocadas con su contenido original y 500. El manifiesto es best-effort (su fallo se registra y no revierte; el historial podría omitir esa publicación). La fila reescrita conserva el texto original de la línea (no se re-serializa). Filas inválidas sin publicar se conservan mientras quede alguna válida; si ya no quedan válidas el archivo se borra.
- Alternativa: marcar filas consumidas en un archivo de estado — descartada: dos fuentes de verdad para "pendiente" y más lecturas por consulta.
- Alternativa: borrado condicional `IfMatch` — no se usa en `DeleteObject`; el ETag ya se verificó al leer y el único escritor concurrente posible es el mismo agente.

### D4. Idempotencia por `publishId`
`agent-publications/{c}/{agent}/{publishId}.json`; si existe se devuelve sin escribir. El BFF genera `publishId` (`{ts}-{8 hex}`) por confirmación y reintenta una vez ante error de red con el mismo id.

### D5. ANA Admin
- `ENTRY_PERMISSIONS` += `ana:campaign:message:send`; sección `/mi-asignacion` con `isAllowed = hasPermission(CAMPAIGN_SEND)`. Las rutas BFF existentes ya exigen sus permisos propios, así que un agente solo opera "Mi asignación".
- BFF: `GET /api/agent/campaigns` (v3 `GET /agent/campaigns`), `GET /api/agent/assignments/{c}`, `GET /api/agent/assignments/{c}/file?key=`, `POST /api/agent/assignments/{c}/publish`, `GET /api/agent/assignments/{c}/publications`; `withAccess` con `CAMPAIGN_SEND` y alcance de campaña de `/me`; errores de v3 mapeados (401/403 → 403 `forbidden`, 409 → `conflict`).
- La página carga cada archivo por la ruta `file` (sin URLs prefirmadas ni proxy) y combina en el navegador.

### D6. Límites
5 MB por archivo leído (payload de Lambda 6 MB), 20 fuentes y 20 000 filas por publicación, plantilla ≤ 2000 caracteres, 5 columnas de teléfono. La publicación tiene `timeout: 29`.

## Risks / Trade-offs

- [Divergencia entre port TS y CLI] → pruebas de equivalencia en v3 y ANA Admin importando `template-utils.js` y `assignment-csv.js`.
- [Fallo entre escritura y consumo deja contactos en `agents/` y pendientes] → rollback D3; ventana mínima en la que el CLI podría consumir el archivo antes del rollback (se registra `evt:"agent_publish",status:"rollback"`).
- [Archivos grandes] → 413 y aviso en la UI; los archivos de la consola v3 son ≤ 4 MB.
- [PII en tránsito por el BFF] → no se registra contenido; solo vive durante la solicitud.

## Migration Plan

1. v3: `sls deploy` (rutas `/agent/assignments*`) junto con `add-supervisor-contact-access`.
2. ANA Admin: rebuild de Amplify.
3. Avisar a agentes v3: entrar a ana-admin.pernexium.com.mx → "Mi asignación".
- Rollback: ocultar la sección; las rutas nuevas no afectan a las existentes. Revertir `add-supervisor-contact-access` en v3 si se necesita volver a la entrega directa.

## Decisiones de implementación

- La construcción del archivo publicado vive en `v3/ana-backend/src/lib/publication.ts` (módulo puro, sin AWS) para que la prueba de ANA Admin compare la vista previa con lo que v3 publica; el workflow de CI de admin-web se dispara también con cambios en `publication.ts`, `assignmentCsv.ts` y `templateRender.ts`.
- "Sin resolver" = el marcador quedó idéntico tras el render del CLI (incluye expresiones cuyo valor no es numérico en alguna fila y `{x}` que solo coincidiría con `ana_upload_id`, que se excluye del render).
- Filas inválidas (menos columnas) se conservan en el pendiente mientras quede alguna fila válida sin publicar; si no, el archivo se borra (`remaining:0`).
- Errores de autenticación de las rutas `/agent/*` responden `{"error"}` (como el resto de `/agent/*`); los de negocio `{"success":false,"message"}`. El BFF traduce 401/403 de v3 a 403 "No estás habilitado como agente v3 en esta campaña" (o "Archivo no permitido").
- La tabla muestra hasta 500 filas a la vez (búsqueda y selección operan sobre todas); teléfonos enmascarados en cualquier columna de teléfono o con `tel`/`phone` en el nombre.
