# Proposal

## Why

En Contactos, "Repartir" siempre usa a todos los destinatarios habilitados de la campaña. Para dejar fuera a un agente en una carga (vacaciones, saturado, en capacitación) hoy hay que deshabilitarlo en Agentes y volver a habilitarlo después, lo que afecta también a otras cargas y al roster del CLI.

## What Changes

- En el paso "Destino", con modo "Repartir", la página lista los destinatarios habilitados; cada uno tiene una **X** para quitarlo del reparto y un **+** para reagregarlo, más "Reagregar todos".
- La vista previa y la entrega reparten solo entre los no quitados. Quitar a todos bloquea la vista previa.
- La confirmación envía `excluded` al BFF, que recalcula el plan con el roster vigente menos esos usuarios (sigue respondiendo 409 si difiere).
- Las exclusiones se reinician al cambiar campaña, flota o "Incluir supervisores"; una recarga del roster conserva las que siguen habilitadas.
- Sin cambios en v3/ana-backend ni en v4: ambos aceptan cualquier subconjunto de agentes habilitados.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `admin-web/contact-upload`: el reparto puede excluir destinatarios habilitados por carga.

## Impact

- `admin-web/src/lib/contacts/plan.ts` (`buildPlan` con `excluded`), `pipeline.ts`, `processor.ts`.
- `admin-web/src/server/contacts/delivery.ts` (`excluded` en la solicitud y en la verificación, también en la carga v3 por S3).
- `admin-web/src/components/contacts/ContactsUploadView.tsx` (lista con X / +).
- Pruebas en `test/contacts/` y `test/server/routes-uploads.test.ts`; README.
