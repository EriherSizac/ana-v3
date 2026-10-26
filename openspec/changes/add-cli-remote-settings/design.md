# Design

## Context

- El registro "Consulta No Whatsapp" sale de `whatsapp-manual.js` (`injectNoWhatsappInfoButton`, ~línea 336). `fix-no-whatsapp-modal-duplicates` lo convierte en un botón explícito; el coordinador ajusta esa change para mostrar el botón solo si `noWhatsappConsultRegistration` es `true`.
- `migrate-cli-to-cognito-login` ya declara `GET /agent/settings` como ruta `/agent/*` con ID token siempre exigido (sin modo de transición) y authorizer JWT nativo desde su creación.
- `add-agent-roster-management` aporta `cognitoAdminJwt` y `requireAdminAccess` (v4 `GET /me`) en v3; `add-admin-web-foundation` aporta `isDeveloper` en el BFF.

## Goals / Non-Goals

**Goals:**
- Apagar/encender comportamientos del CLI sin release, con valor seguro ante cualquier falla.
- Que el catálogo de flags crezca sin cambiar rutas ni UI (la página se arma desde el catálogo).

**Non-Goals:**
- Overrides por campaña/agente, flags para v4, historial completo de cambios (solo último autor/fecha; el detalle queda en logs de CloudWatch).

## Decisions

### D1. Configuración global, sin override por campaña
El único flag es de producto (el subdictamen no se usa en ninguna campaña). Un override por campaña obligaría a resolver la campaña del CLI y validar roster en la lectura, y a una UI por campaña. El documento tiene `schemaVersion` para agregar después `campaigns: {<c>: {...}}` sin romper lectores (versión 2 con migración).
- Alternativa: global + overrides desde ya — descartada por YAGNI.

### D2. S3 `config/cli-settings.json` y catálogo en código
Mismo bucket del backend (v3 es S3 puro); el catálogo vive en `src/lib/cliSettings.ts` (llave, tipo, default, descripción en español) y se devuelve en `GET /admin/cli-settings` para que la página no lo duplique. Escritura condicional con ETag como el roster.
- Alternativa: SSM Parameter Store / AppConfig — descartada: nueva dependencia/IAM para un JSON pequeño; AppConfig además requiere agente o polling propio.

### D3. Rol Developer como único criterio de escritura y lectura admin
Se usa `roleNames` de v4 `GET /me` con la normalización de `isLeaderRole` (NFD, sin diacríticos, minúsculas) y la regex `/developer/`. No es un permiso `ana:*` por decisión del usuario: la configuración es técnica y la gobierna el equipo de desarrollo; los admins de operación no deben tocarla. El BFF aplica el mismo criterio (`isDeveloper`) y v3 lo vuelve a aplicar (defensa en profundidad).
- Alternativa: permiso nuevo `ana:admin:cli-settings:manage` — descartada por la decisión explícita; queda como evolución si se necesita delegar.

### D4. Autenticación de `GET /agent/settings`
Se adopta el contrato ya escrito en `migrate-cli-to-cognito-login`: `/agent/*` siempre con ID token. Los CLIs anteriores al login con Cognito no la pueden leer y por lo tanto usan el valor por defecto (`false`), que es justo el comportamiento deseado (no registrar). Por eso el consumo en el CLI se publica con o después del release con Cognito, y la ruta + la página pueden desplegarse antes.
- Alternativa: ruta pública durante la transición — descartada: contradice el contrato `/agent/*` de la otra change y no aporta, porque el valor por defecto ya es el seguro.

### D5. CLI: módulo `remote-settings.js`
Un solo poller en el proceso principal (tras el login y cada 5 min, `AbortSignal.timeout(5000)`, `Authorization` del módulo de sesión de la otra change, `X-Ana-Cli-Version`), estado en memoria con `get(key)` y suscripción `onChange`. Las ventanas leen por ese módulo (la manual lo recibe al inyectar el botón vía `page.exposeFunction`/evaluación con el valor actual). No se persiste en disco para no arrastrar valores viejos entre ejecuciones.

## Risks / Trade-offs

- [Un Developer activa el flag por error] → `ConfirmDialog` explícito, auditoría visible y propagación ≤ 5 min para revertir.
- [Dependencia de v4 para autorizar a Developers] → fail-closed 503 en admin; la lectura del CLI no depende de v4.
- [CLIs sin token nunca ven el flag] → aceptado (D4); se documenta en el release.

## Migration Plan

1. v3: desplegar `GET/POST /admin/cli-settings` (con `cognitoAdminJwt`) y `GET /agent/settings` (con el authorizer de agentes de `migrate-cli-to-cognito-login`; si esa change aún no despliega su authorizer, esta ruta espera a ese despliegue).
2. ANA Admin: página Configuración.
3. CLI: release con `remote-settings.js` junto con o después del login Cognito, y con el ajuste de `fix-no-whatsapp-modal-duplicates`.
- Rollback: borrar `config/cli-settings.json` devuelve todos los valores por defecto.

## Decisiones de implementación

- `GET /agent/settings` **no se registró** todavía: depende de `requireAgentToken` y del authorizer `cognitoAgentJwt` de `migrate-cli-to-cognito-login`, que aún no existen en el código. El cuerpo de la respuesta está implementado y probado (`agentSettingsResponse` en `src/handlers/cliSettings.ts`); falta envolverlo con esa autenticación y agregar la función a `serverless.yml` (tarea 1.3).
- El catálogo incluye además `label` (nombre legible) para que ANA Admin no lo duplique; `GET /admin/cli-settings` lo devuelve junto con `key/type/default/description`.
- La comprobación de rol Developer en v3 reutiliza `requireAdminAccess` (v4 `GET /me`) + `isDeveloper` de `src/lib/adminAccess.ts` (misma normalización que `isLeaderRole`).
- CLI: `remote-settings.js` es un módulo nuevo con dependencias inyectables (`createRemoteSettings`) y una instancia única (`remoteSettings`, `startRemoteSettings`, `getRemoteSetting`). El token lo provee `setTokenProvider`, que conectará el módulo de sesión de `migrate-cli-to-cognito-login`; **sin token no consulta** y el valor queda en el por defecto (seguro), para no generar 401 desde CLIs sin sesión Cognito.
- Hook mínimo en `index.js`: import + `startRemoteSettings()` tras `initWhatsApp()` (el login actual), para no chocar con los cambios concurrentes del CLI. La exposición a las páginas de las ventanas (`page.exposeFunction`) y su uso en el modal de la ventana manual quedan para `fix-no-whatsapp-modal-duplicates`/tarea 2.2.
- La URL base del CLI se toma de `ANA_API_URL` (misma que `agent-config.js`); `X-Ana-Cli-Version` de `ANA_CLI_VERSION` (o `unknown`).
