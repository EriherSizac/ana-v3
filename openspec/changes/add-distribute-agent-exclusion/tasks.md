# Tasks

## 1. Plan y BFF

- [x] 1.1 `buildPlan` acepta `excluded` en "Repartir" (error si quedan cero); verificar con `test/contacts/contacts-lib.test.ts`.
- [x] 1.2 `parseUploadRequest` valida `excluded` (lista de usernames, máx. 500) y `verifyPlan`/`verifyLargePlan` lo aplican; verificar con `test/server/routes-uploads.test.ts` (entrega sin el quitado, 409, 400).

## 2. Página

- [x] 2.1 Lista de destinatarios con X / + y "Reagregar todos" en `ContactsUploadView`; exclusiones en la vista previa y en la confirmación; reinicio al cambiar destino. Verificar con `test/contacts/contacts-view.test.tsx`.
- [x] 2.2 Documentar en `admin-web/README.md` (sección Contactos).

## 3. Integración

- [x] 3.1 `npm run lint`, `typecheck`, `test`, `check:design`, `build` en `admin-web` sin errores.

## Workflow follow-up

- Desplegar admin-web (rama `installer-2`) y probar en `ana.pernexium.com.mx/contactos`.
- Archivar el cambio después de `add-contact-upload-console`.
