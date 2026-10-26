# Design

## Context

Ver proposal.md (Why). Hechos del código que condicionan el diseño:

- `src/handlers/supervisors.ts`: `listAgentAssignments` (`:121`), `getAgentAssignments` (`:279`) y `getAgentContacts` (`:1082`) no llaman `requireAdmin`; el resto de rutas de supervisor sí (`src/lib/adminAuth.ts`, comparación en tiempo constante, 401/503).
- Ningún archivo del CLI, de `v3/app`, `v3/lib` ni de `v4/` llama a `GET /supervisors/...` (v4 solo usa el `POST` de contactos, según `v4/api-agentes.md`). `setup-campaign.sh` sí llama a `GET /supervisors/agents/{agent}/{campaign}/contacts`; `fix-setup-campaign-admin-key` le agrega la llave.
- `PLAN_SEGURIDAD_Y_DEUDA.md` (F1.4) dejó estas lecturas abiertas por no poder descartar consumidores externos; se resuelve con verificación en CloudWatch antes de desplegar (tarea 3.1).
- La autenticación de agente para `GET /get/chats` y las demás rutas del CLI se planifica en `migrate-cli-to-cognito-login` (Cognito + roster); este cambio no la toca.

## Goals / Non-Goals

**Goals:**
- Cerrar las tres lecturas de supervisor con la llave existente, sin release del CLI.

**Non-Goals:**
- Autenticación de agente (token de sesión, Cognito) en cualquier ruta del CLI.
- Cambiar la semántica consume-once o la disposición de llaves S3.

## Decisions

### D1. `requireAdmin` al inicio de los tres handlers
Mismo guard y mismas respuestas que las demás rutas de supervisor (`401 {"success":false,"message":"No autorizado"}`, `503 {"success":false,"message":"Admin key no configurada"}`), llamado antes de cualquier `ListObjectsV2`/`GetObject`.
- Alternativa: authorizer de API Gateway (Lambda authorizer con la llave). Rechazada: duplica `requireAdmin` y el resto de rutas de supervisor ya lo usan en el handler.
- Alternativa: esperar a la web de administración con Cognito. Rechazada: deja datos de cobranza abiertos mientras tanto; la llave se puede cambiar por Cognito después sin romper a nadie que hoy no la use.

### D2. Retiro del token HMAC de agente
La versión previa emitía un token HMAC desde `/auth/verify`. Se descarta: la palabra del día desaparece con `migrate-cli-to-cognito-login`, que protege `GET /get/chats` con el ID token de Cognito y el roster. Mantener ambos obligaría a dos releases del CLI y a dos mecanismos de identidad en transición.

### D3. Pruebas con vitest + aws-sdk-client-mock
Si la suite ya existe (otro cambio pudo agregarla) se reutiliza; si no, este cambio la agrega (tarea 1.1).

## Risks / Trade-offs

- [Consumidor externo desconocido de las lecturas] → Verificación de invocaciones en CloudWatch antes del deploy (tarea 3.1); si aparece tráfico que no sea de supervisores, se detiene y se decide con el usuario.
- [Supervisores con scripts propios sin llave] → README-SUPERVISORES.md documenta el header; el error es un 401 explícito, no un fallo silencioso.

## Migration Plan

1. Verificar en CloudWatch (últimos 30 días) las invocaciones de `ana-backend-prod-getAgentContacts`, `-listAgentAssignments` y `-getAgentAssignments`.
2. Desplegar el backend (`npm run deploy -- --stage prod`).
3. Verificar con `curl` 401 sin llave y 200/404 con llave.
4. Rollback: redeploy de la versión anterior (no hay cambios de datos).
