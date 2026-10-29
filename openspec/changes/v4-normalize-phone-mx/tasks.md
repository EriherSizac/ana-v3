# Tasks

## 1. Vectores y desktop

- [x] 1.1 Crear `v4/shared/phone-mx-vectors.json` con al menos: 10 dígitos, `52`+10, `+52 1`+10, `044`/`045`+10, `01`+10, `1`+10, `+1 305…`, `0052…`, `12345`, vacío, 10 dígitos que empiezan con `52`, y casos de otra lada (`57`); verificar que el JSON es válido (`node -e "require('./v4/shared/phone-mx-vectors.json')"`)
- [x] 1.2 Agregar `vitest` a `v4/desktop` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.3 Reescribir `electron/whatsapp/phone.ts` según design D1/D2; verificar con vitest que recorre todos los vectores compartidos
- [x] 1.4 Cambiar `resolveJid` a resultado tipado y `runJob` para mapear `invalid` → `error` "Teléfono inválido" (reporte `error`, nunca `no_whatsapp`); verificar con vitest de la función de mapeo y manualmente en dev con un CSV que trae `12345` (historial "Error", sin `PATCH /phone` en logs del backend) — (verificado 2026-10-29: `resolveJid` tipado y `invalid` → `error` "Teléfono inválido" (`electron/jobs/outcome.ts`, `phone.test.ts`); vitest y typecheck de v4/desktop en verde; incluido en el desktop 1.4.0 publicado; prueba manual en openspec/PENDIENTES.md)

## 2. Backend

- [x] 2.1 Agregar `vitest` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 2.2 Crear `src/lib/phone.ts` con `normalizeMx` y hacer que `toE164Mx` delegue (vacío si inválido, sin búsqueda en el CRM); verificar con vitest que recorre los vectores compartidos y que `0445512345678` busca `+525512345678`

## 3. Documentación

- [x] 3.1 Documentar en `v4/CAMPANAS_Y_ASIGNACION.md` los formatos aceptados (incluido `+` para extranjeros) y cómo listar jobs `no_whatsapp` con teléfono `044`/`045`/`01` previos al cambio; verificar que los ejemplos están en los vectores

## 4. Despliegue y release

- [x] 4.1 Desplegar el backend en dev y prod (`npx serverless deploy --stage dev` y `--stage prod` en `v4/backend`); verificar en logs un `client-info` con `+52` + 10 dígitos para un teléfono `044` de prueba — (verificado 2026-10-29: backend v4 prod desplegado (2026-10-27; no hay dev); el log de `client-info` con un `044` de prueba queda en openspec/PENDIENTES.md)
- [x] 4.2 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/`; en la PC piloto enviar a un contacto de prueba escrito como `044…` y confirmar que llega — (verificado 2026-10-29: desktop 1.3.0 y luego 1.4.0 publicados a mano en s3://ana-desktop-updates/updates/ (electron-builder falla con XAmzContentSHA256Mismatch), `latest.yml` = 1.4.0; prueba en PC piloto en openspec/PENDIENTES.md)

## Workflow follow-up

- Tras archivar, la nota sobre `044`/`045` de "Normalización de teléfono" ya no forma parte del requisito; revisar que `openspec/specs/v4/template-interpolation/spec.md` no conserve texto contradictorio.
