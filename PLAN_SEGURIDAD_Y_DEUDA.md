# Plan de medidas — ana-v3

Creado: 2026-10-08 · Rama: `installer-2` · Estado: **D1–D4 resueltas; pendiente luz verde para ejecutar** (nada aplicado)

Origen: reporte de seguridad/rendimiento/deuda técnica + revisión del repo.

---

## 0. Hallazgos de la revisión (correcciones al reporte)

| # | Hallazgo | Impacto |
|---|---|---|
| H1 | **v3 backend sin ningún authorizer** (0 de 39 rutas en `v3/ana-backend/serverless.yml`). CORS `*` es el síntoma menor; cualquiera con la URL lee/escribe. | **Crítico** |
| H2 | `credentials.ts` sirve el CSV de credenciales por campaña sin auth; si no existe lo crea con `admin,acceso2024`. 30 frases hardcodeadas, generadas con `Math.random()`. | **Crítico** |
| H3 | CORS `*` en **dos capas**: `httpApi.cors.allowedOrigins: '*'` (yml L23-25) y 79 ocurrencias en 9 handlers (`supervisors` 41, `credentials` 17, `auth` 8, `media` 5, `chatBackups` 4, `backups`/`chats`/`contacts`/`templates` 1). Tocar solo handlers no basta. | Alcance mayor |
| H4 | v4 ya reutiliza clientes (`dynamo.ts`, `s3.ts`, `db.ts` a nivel de módulo). v3 tiene 9 `new S3Client` a nivel de módulo (se reutilizan en caliente) pero duplicados y con regiones inconsistentes. No hay DB ni API de WhatsApp en lambdas (WhatsApp corre en Electron/CLI). | Alcance menor que el reporte |
| H5 | v4 usa Cognito JWT (Bearer, sin cookies): CORS `*` ahí es riesgo bajo. Renderer empaquetado usa `loadFile` → origen `file://`/`null`; allowlist estricta puede romper la app de escritorio. | Riesgo de regresión |
| H6 | `playwright.config.ts` vive en v3 (`testDir: './tests'` inexistente, `headless: false`). v4 (lo desplegado) sin tests ni CI (`.github/` no existe). | Deuda técnica |
| H7 | Datos sensibles/basura versionados (CSVs con teléfonos y credenciales, `.agent-config.json`, `.serverless/meta.json`, `.claude/settings.json`). | Alto |

---

## 1. Fases

### Fase 1 — v3 se queda vivo y se cierra (opción B) + CORS v4
Decisión 2026-10-08: v4 es una migración a medias y v3 sigue en producción (stack `ana-backend-prod`, us-east-1). **No se retira.**

Restricción de diseño descubierta: el CLI v3 (Node) llama al API con `fetch` plano, sin token (solo `/auth/verify` con palabra del día). Un authorizer Cognito en todas las rutas **rompería la flota instalada**, así que el cierre es por capas:

1. **CORS**: `httpApi.cors` solo `https://pernexium.com.mx`, `https://*.pernexium.com.mx`, `https://pernexium.com`, `https://*.pernexium.com`. Se eliminan los 79 literales `Access-Control-Allow-Origin: '*'` y las 18 funciones/rutas OPTIONS (API Gateway responde el preflight). El CLI no envía Origin, no se afecta.
2. **Rutas de administración con `X-Admin-Key`** (`src/lib/adminAuth.ts`, fail-closed, `timingSafeEqual`): `/credentials/*`, `/supervisors/files/download`, `/supervisors/agents/.../contacts` POST, `/agents/.../contacts` POST, `POST /templates`.
3. **`/credentials/{campaign}`**: se conserva porque los supervisores lo usan para repartir la palabra del día (README-SUPERVISORES) y **el CLI nunca lo llama** (solo usa `/auth/verify`, que valida del lado servidor). Por eso pasa a admin-only. Se elimina la creación automática de `admin,acceso2024` (ahora 404) y se genera la palabra con `crypto.randomInt` + sufijo de 4 dígitos (antes 1 de 30 con `Math.random`).
4. **Rutas que el CLI sí usa** (`/auth/verify`, `/backups*`, `/get/chats`, `/media`, `/contacts/pending`, `GET /templates`) quedan sin token: riesgo residual hasta liberar un CLI que envíe credenciales. Mitigación pendiente: throttling del stage.
5. **Lecturas de asignaciones** (`GET /supervisors/assignments/...`, `GET .../contacts`): se dejan abiertas por no poder descartar que el agente o un sistema externo las consuma (no aparecen en este repo). Verificar en logs y cerrarlas.
6. **Despliegue**: NO realizado. Requiere `ADMIN_API_KEY` en `v3/ana-backend/.env` y avisar a supervisores del header nuevo.
7. **CORS v4 (D1 = a)**: pendiente, `app://ana` + allowlist en `v4/backend/serverless.yml` (ver arriba), independiente de v3.
8. Auth v4: confirmar que todas las rutas (incl. `POST /send`) tienen authorizer o `SEND_API_KEY`.

### Fase 2 — Limpiar datos del repo
`git rm`:
- `v3/ana-backend/credenciales-ejemplo.csv` (coincide con `DAILY_PHRASES`)
- `v3/ana-backend/contactos-ejemplo.csv`, `v3/cli-whatsapp/contactos2.csv`, `v3/cli-whatsapp/erick.csv`
- `v3/cli-whatsapp/.agent-config.json`, `v3/.serverless/meta.json`, `v3/.claude/settings.json`
- `v3/contacts-example.csv`, `v4/demo/*.csv`

Reemplazo: `docs/examples/contactos.example.csv` con datos falsos. Actualizar READMEs.
`.gitignore`: `*.csv` (excepto `!**/*.example.csv`), `.serverless/`, `.agent-config.json`, `.claude/settings*.json`.
Historial (D3: datos no reales): **sin reescritura ni force-push**; solo borrar de HEAD.
Checks: `git grep` de AKIA/secrets, `.env` no versionado.

### Fase 3 — Reutilización de clientes
1. ~~v3 `clients.ts`~~ descartado (v3 retirado, D2).
2. v4 `fetch` externos (`roles.ts`, `interactions.ts`, `dashboard.ts`): keep-alive ya es default en Node 20; añadir `AbortSignal.timeout`, reintentos acotados, cache en memoria (revisar `accessCache.ts`).
3. v4 pg Pool: ya correcto, no tocar.
4. Medir `Init Duration`/`Duration` en CloudWatch antes y después.

### Fase 4 — Pruebas
1. Vitest en `v4/backend` (`normalizeContactRow`, `permissions`, `access`, `rolePerms`, `roles` con fetch mock, `http`) y `v4/desktop/electron/whatsapp` (`phone`, `template`, `formatMoney`). Deduplicar `normalizeContactRow` (existe en backend y desktop). Cobertura inicial 60% en `lib/`.
2. Playwright E2E en `v4/desktop` con `_electron.launch` + backend mock (login OTP, campañas, carga CSV, vista equipo). Borrar config huérfana de v3 (`v3/playwright.config.ts`); `headless: true` en CI.
3. CI `.github/workflows/ci.yml`: `tsc --noEmit`, Vitest, lint por PR; E2E en job aparte.

---

## 2. Orden y riesgo

| Orden | Fase | Esfuerzo | Riesgo de romper |
|---|---|---|---|
| 1 | F2 limpieza de datos | bajo | bajo |
| 2 | F1.1–1.6 cerrar v3 (código hecho, deploy pendiente) | medio | medio (supervisores deben usar X-Admin-Key) |
| 3 | F1.4–1.7 CORS v4 + `app://` | medio | medio (puede romper desktop) |
| 4 | F4 unit + CI | medio | bajo |
| 5 | F3 clientes v4 | bajo | bajo |
| 6 | F4 E2E | alto | bajo |

Un commit por fase, rama `installer-2`, sin Co-Authored-By.

## 3. Decisiones (resueltas 2026-10-08)

- **D1 = (a)**: protocolo `app://` en la allowlist de CORS v4. Fallback (b) si API Gateway no acepta el esquema.
- **D2 (revisada)**: v3 **sigue en producción** (verificado en AWS). Se cierra en lugar de retirarse: ver Fase 1.
- **D3**: CSV **no reales** → sin reescritura de historial ni force-push.
- **D4**: auth Cognito. v4 ya lo usa; v3 irrelevante por D2.

---

## 4. Registro de ejecución

Se llena conforme se aplique cada medida.

| Fecha | Fase/Ítem | Hallazgo | Impacto | Remediación aplicada | Commit | Verificación | Estado |
|---|---|---|---|---|---|---|---|
| 2026-10-08 | F2 | H7: CSVs de contactos/credenciales versionados en v3 (`credenciales-ejemplo`, `contactos-ejemplo`, `contactos2`, `erick`, `contacts-example`) con teléfonos de 8+ dígitos, montos y contraseñas que coinciden con `DAILY_PHRASES` | Alto: exposición de PII y credenciales en el repo | `git rm` de los 5 CSV. Los README de v3 ya generan esos archivos por heredoc, no dependían de ellos | F2 | `git grep` de referencias: sin dependencias rotas | Hecho |
| 2026-10-08 | F2 | H7: artefactos locales versionados (`v3/.serverless/meta.json`, `v3/.claude/settings.json`, `v3/cli-whatsapp/.agent-config.json` con agente `erick` y campaña `2-pernexium`) | Medio: config personal y ruido de build | `git rm` de los 3. `.agent-config.json` se regenera en runtime (`agent-config.js`), solo se ignora | F2 | `git check-ignore` confirma que quedan ignorados | Hecho |
| 2026-10-08 | F2 | H7: `v4/demo/*.csv` con teléfono personal real | Medio: PII | Teléfono reemplazado por `525500000001`, nombre por `Persona Ejemplo`; renombrados a `*.example.csv`; `v4/demo/README.md` actualizado | F2 | Contenido revisado; solo datos falsos | Hecho |
| 2026-10-08 | F2 | H7: sin `.gitignore` raíz que impida reintroducir datos | Medio: recurrencia | `.gitignore` raíz: `*.csv` salvo `!**/*.example.csv`, `.serverless/`, `.agent-config.json`, `.claude/settings*.json`, `.env*` salvo `.env.example` | F2 | `git check-ignore -v` sobre rutas de prueba | Hecho |
| 2026-10-08 | F2 | Búsqueda de secretos (AKIA, claves privadas, `password=`) y `.env` versionado | — | Ninguno encontrado; sin `.env` en el índice | — | `git grep` + `git ls-files` | Verificado, sin acción |
| 2026-10-08 | F2 | D3: historial contiene los CSV | Bajo: datos no reales | Sin reescritura ni force-push, por decisión | — | — | Aceptado |
| 2026-10-08 | F1.1-1.2 | **Premisa D2 contradicha por AWS (solo lectura)**: stack `ana-backend-prod` (us-east-1, cuenta 509399624341) está en `UPDATE_COMPLETE`; `ana-backend-dev` no existe. Su bucket `ana-backend-storage-prod` tiene 2752 objetos / ~7 GB (`agents/`, `assignments/`, `backups/`, `chats/`, `credentials`, `historic/`, `media/`, `versions/` con instaladores ANA-1.0.x hasta feb-2026 y el manifest de autoactualización `versions/latest.json`) | Alto: `serverless remove` rompería el autoupdate de los CLI v3 instalados y puede borrar datos de chats/credenciales sin respaldo; la API pública sin auth sigue expuesta mientras exista | **Retiro NO ejecutado.** Pendiente decisión: (A) respaldo del bucket a otra ubicación + `remove`; (B) dejar v3 vivo pero cerrar: authorizer + CORS + sin `credentials`; (C) congelar: revocar acceso público y mantener solo `versions/` | — | `aws cloudformation describe-stacks`, `aws s3 ls` | Resuelto: se elige B (cerrar v3) |
| 2026-10-08 | F1.1 | H3: CORS `*` en 2 capas (yml + 79 literales en 9 handlers) | Alto: cualquier origen web podía invocar la API | `allowedOrigins` = `*.pernexium.com.mx`/`.com` (+ apex); borrados los literales y 18 rutas OPTIONS; `allowedMethods` reducido a GET/POST/OPTIONS (únicos usados) | _commit F1_ | `tsc --noEmit` limpio; 0 ocurrencias de `Access-Control` en handlers; **no desplegado** | Código listo, falta deploy |
| 2026-10-08 | F1.2 | H1: rutas de supervisor/administración públicas | Crítico | `requireAdmin` (X-Admin-Key, fail-closed) en credentials×3, supervisors×4, `POST /templates` | _commit F1_ | tsc limpio; falta prueba funcional tras deploy | Código listo, falta deploy |
| 2026-10-08 | F1.3 | H2: `GET /credentials/{campaign}` entregaba claves en texto plano y creaba `admin,acceso2024`; generador con 30 opciones y `Math.random` | Crítico | Admin-only; sin default (404); `randomInt` + sufijo 4 dígitos. Justificación: el CLI no lo usa, solo supervisores | _commit F1_ | tsc limpio; **hay que regenerar claves tras deploy** | Código listo, falta deploy |
| 2026-10-08 | F1.4 | Riesgo residual: rutas del CLI sin token; lecturas de asignaciones abiertas | Medio | Documentado; pendiente throttling y revisar logs | — | — | Abierto |
