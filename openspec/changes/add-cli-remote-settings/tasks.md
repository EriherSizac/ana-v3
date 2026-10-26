# Tasks

## 1. v3 backend: configuración del CLI

- [x] 1.1 Implementar `v3/ana-backend/src/lib/cliSettings.ts` (catálogo con `noWhatsappConsultRegistration`, lectura con regla de configuración efectiva y error ante JSON inválido o versión ≠ 1, escritura condicional con 3 reintentos); verificar con pruebas vitest: objeto inexistente = defaults, texto `"true"` ignorado, versión 2 = error, llave desconocida rechazada
- [x] 1.2 Implementar `src/handlers/cliSettings.ts` con `GET /admin/cli-settings` y `POST /admin/cli-settings` (rol Developer vía `requireAdminAccess` + `roleNames` normalizados, admin sin Developer → 403, 400/409) y registrarlas en `serverless.yml` con `cognitoAdminJwt`; verificar con pruebas de handler cada escenario del spec
- [x] 1.3 Implementar `GET /agent/settings` usando la autenticación de agente de `migrate-cli-to-cognito-login` y registrarla con su authorizer de agentes; verificar con pruebas: 200 con defaults, 500 con objeto ilegible, sin token rechazado
- [x] 1.4 Documentar en `v3/ana-backend/README.md` el catálogo, la llave S3, las rutas y quién puede cambiarlas; verificar que los ejemplos coinciden con las pruebas

## 2. CLI: consumo de la configuración

- [x] 2.1 Crear `v3/cli-whatsapp/remote-settings.js` (poller tras login y cada 5 min, timeout 5 s, último valor exitoso en memoria, defaults si nunca hubo éxito, `get`/`onChange`) con pruebas `node:test` y `fetch` mockeado; verificar los escenarios de arranque sin red, fallo posterior y cambio en caliente
- [ ] 2.2 Iniciar el poller en `index.js` después del login y exponer el valor vigente a las ventanas (manual, automatización, monitor) sin que lean la ruta por su cuenta; verificar manualmente en dev que cambiar el flag desde ANA Admin se refleja en la ventana manual en ≤ 5 min sin reiniciar
- [x] 2.3 Documentar en `v3/cli-whatsapp/README-USUARIO.md` que el registro de "Consulta No Whatsapp" se controla desde ANA Admin; verificar que el texto coincide con la UI

## 3. ANA Admin: página Configuración

- [x] 3.1 Crear `GET /api/cli-settings` y `POST /api/cli-settings` en el BFF (solo `isDeveloper`, propagación del token a v3, errores uniformes); verificar con pruebas de route handler: 403 para admin sin Developer, 200 para Developer
- [x] 3.2 Construir `/configuracion` desde el catálogo (toggle por flag booleano, descripción, valor por defecto, auditoría, Skeleton, `ConfirmDialog`, error inline y conflicto 409) y registrarla en la navegación solo para `isDeveloper`; verificar con pruebas de componente de los escenarios del spec

## 4. Integración

- [ ] 4.1 Prueba en dev de punta a punta: un Developer activa el flag, `config/cli-settings.json` refleja autor y fecha, un CLI con token lo recibe en `GET /agent/settings` y el botón de registro de `fix-no-whatsapp-modal-duplicates` aparece; al desactivarlo desaparece en ≤ 5 min; registrar evidencia en el PR
