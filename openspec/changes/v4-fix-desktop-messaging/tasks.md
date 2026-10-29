# Tasks

## 1. Plantillas y moneda

- [x] 1.1 Agregar `vitest` a `v4/desktop` si ningún cambio previo lo hizo; verificar con `npm test`
- [x] 1.2 Extraer `parseLocaleNumber` en `electron/whatsapp/template.ts` y usarlo en `formatMoney` y `evalMathExpr` (design D5); verificar con vitest: "1234,56", "1.234,56", "1,234.56", "12,345", "1234.5", "abc" y las expresiones existentes (`{saldo*0.9:dinero}`) sin regresión
- [x] 1.3 Extraer a un módulo puro (`src/lib/templateVars.ts`) la detección de variables desconocidas contra columnas + alias que usa "Campañas"; verificar con vitest (`{apodo}` desconocida; `{saldo}` con `total_balance` conocida) y que `Campaigns.tsx` sigue compilando con `npm run build`

## 2. Aprobación por archivo

- [x] 2.1 Cambiar `JobPoller.approve(jobIds, templatesBySrcKey)` para aplicar la plantilla del grupo de cada job y responder sin esperar el lote (design D1/D3); verificar con vitest de `JobPoller` con `runJob` falso (dos grupos → cada job con su plantilla; la promesa resuelve antes del primer `runJob`; segundo `approve` durante el envío → "Ya hay un envío en curso")
- [x] 2.2 Actualizar `main.ts`, `preload.ts` y `src/types/ana.d.ts` con la firma nueva; verificar con `npm run build` sin errores de tipos
- [x] 2.3 En `src/routes/Assignment.tsx`, un `TemplateEditor` por grupo de la selección, validación por grupo (D2), selección intersecada con pendientes (D4) y "Envío iniciado." inmediato; verificar manualmente en dev con dos CSV de plantillas distintas (cada contacto recibe la suya) y con una plantilla que usa `{apodo}` (botón deshabilitado) — (verificado 2026-10-29: `Assignment.tsx` con un `TemplateEditor` por grupo, validación por grupo e intersección con pendientes (`templateVars.test.ts`); vitest y typecheck de v4/desktop en verde; incluido en el desktop 1.4.0 publicado; prueba manual en openspec/PENDIENTES.md)

## 3. Chats y progreso

- [x] 3.1 En `src/routes/Chats.tsx`, estado de envío, conservación de texto/archivo y error "No se envió: <motivo>" (D6); verificar manualmente en dev desconectando WhatsApp (el texto queda y aparece el error) y con doble Enter (un solo mensaje en el hilo y en el respaldo) — (verificado 2026-10-29: `Chats.tsx` con estado de envío, conserva texto/archivo y muestra "No se envió: <motivo>"; vitest y typecheck de v4/desktop en verde; incluido en el desktop 1.4.0 publicado; prueba manual en openspec/PENDIENTES.md)
- [x] 3.2 Enmascarar el teléfono en `src/ui/FloatingProgress.tsx` con la función de máscara de las tablas; verificar con vitest de la función de máscara y visualmente en dev

## 4. Documentación

- [x] 4.1 Actualizar `v4/README.md` o `v4/CAMPANAS_Y_ASIGNACION.md` (sección "Mi asignación": plantilla por archivo; formatos de monto aceptados); verificar que los ejemplos coinciden con las pruebas 1.2

## 5. Release del desktop

- [x] 5.1 Subir `version` en `v4/desktop/package.json`, `npm run publish` y verificar `latest.yml` en `s3://ana-desktop-updates/updates/`; en la PC piloto, aprobar contactos de dos cargas y confirmar plantillas correctas y "Último: ***NNNN" en la tarjeta — (verificado 2026-10-29: desktop 1.3.0 y luego 1.4.0 publicados a mano en s3://ana-desktop-updates/updates/ (electron-builder falla con XAmzContentSHA256Mismatch), `latest.yml` = 1.4.0; prueba en PC piloto en openspec/PENDIENTES.md)

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/template-interpolation/spec.md` la mención a la coma decimal.
