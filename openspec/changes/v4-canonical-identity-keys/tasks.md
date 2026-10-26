# Tasks

## 1. Precheck

- [x] 1.1 Agregar `vitest` y `aws-sdk-client-mock` a `v4/backend` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.2 Crear `src/lib/identity.ts` (`canonicalOperatorId`, `encodeKeySegment`, `decodeKeySegment`, `sameCampaign`, `resolveCatalogCampaign`); verificar con vitest: `Ana.Lopez` → `ana.lopez`; `a@b` → `a~40b`; `~` → `~7e`; `.`/`..` codificados; ida y vuelta para 1000 strings aleatorios; escape inválido → `null`; `DIDI_VIP ` vs `didi_vip` iguales
- [ ] 1.3 Crear `scripts/migrate-canonical-ids.ts` con el precheck de design D5 paso 1 (dry-run por defecto) y ejecutarlo contra dev y prod con el perfil `pernexium`; verificar adjuntando al PR el reporte informativo (valor de `CaseSensitive`, usuarios afectados, colisiones esperadas = 0; cualquier colisión se revisa a mano antes de 3.1)

## 2. Backend

- [x] 2.1 Aplicar `canonicalOperatorId` en `claimUser` y en todo uso de username (acceso, superadmin, caché, roster, marcadores); verificar con vitest de `claimUser` y de `resolveUserAccess` con `Erick.Silva`
- [x] 2.2 Reemplazar `safeUser` por `encodeKeySegment` en `api.ts` (media, wa-sessions, csv-uploads, borrado) y decodificar el dueño en `presignMediaGet`, con aceptación transitoria del segmento legado (design D6) detrás de la variable `MEDIA_LEGACY_OWNER=true`; verificar con vitest de los escenarios de `specs/v4/media-and-session-storage/spec.md` y `specs/v4/csv-ingestion/spec.md`
- [x] 2.3 Canonizar y deduplicar destinatarios en `presignCsv` (`assignments`), `getEligibleAgents` y `csvTrigger` (pesos sumados); verificar con vitest del escenario "Usernames con mayúsculas"
- [x] 2.4 Usar `sameCampaign`/`resolveCatalogCampaign` en `api.ts`, `agents.ts`, `jobsAdmin.ts`, `directSend.ts`, `interactions.ts` y en `campaigns` de `access.ts`; verificar con vitest de los escenarios de `specs/v4/access-control/spec.md` (presign y heartbeat con otra grafía)

## 3. Migración de datos

- [ ] 3.1 Completar `migrate-canonical-ids.ts` con los pasos 2–4 de design D5 (`--apply`, sin sobrescribir, `--delete-source` separado) y probarlo en dev con usuarios de prueba `Prueba.Mayus` y `prueba@especial` (conversaciones, mensajes con media, jobs, sesión de WhatsApp); verificar con el reporte de conteos y entrando con esos usuarios en el desktop de dev tras el deploy (historial visible, WhatsApp sin QR)

## 4. Desktop

- [x] 4.1 Usar el canónico en `usernameFromJwt` (`electron/main.ts`) para `.ana-last-operator` y `wa.configure`; verificar con vitest de la función pura de decisión de cambio de operador (`Ana.Lopez` vs `ana.lopez` → mismo operador)

## 5. Documentación

- [x] 5.1 Documentar en `v4/ARCHITECTURE.md` el identificador canónico, la codificación de llaves y la regla de campañas, y en `v4/backend/scripts/README.md` (o encabezado del script) el procedimiento de migración; verificar que los ejemplos coinciden con las pruebas 1.2

## 6. Despliegue, migración y release

- [ ] 6.1 Prod, paso (a): ejecutar `migrate-canonical-ids.ts --apply` con el código viejo desplegado; verificar el reporte de conteos
- [ ] 6.2 Prod, paso (b): `npx serverless deploy --stage prod` con `MEDIA_LEGACY_OWNER=true`; verificar con un usuario afectado que ve su historial y su media
- [ ] 6.3 Prod, paso (c): segunda corrida `--apply`; verificar que copia solo lo escrito entre (a) y (b)
- [ ] 6.4 Release del desktop: subir `version`, `npm run publish`, verificar `latest.yml` en `s3://ana-desktop-updates/updates/` y en la PC piloto que un usuario afectado conecta WhatsApp sin QR
- [ ] 6.5 Una semana después, sin incidentes: `--delete-source` y redeploy con `MEDIA_LEGACY_OWNER=false`; verificar que las llaves legadas ya no existen y que `GET /media/url` con segmento legado responde 403

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/media-and-session-storage/spec.md` la mención al saneado y las colisiones.
