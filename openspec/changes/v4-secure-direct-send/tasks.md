# Tasks

## 1. Preparación

- [ ] 1.1 Registrar en el PR la evidencia de que no hay consumidores conocidos (0 invocaciones de `ana-backend-prod-directSend` en 90 días según CloudWatch, ningún llamador en otros repositorios); verificar con la métrica `Invocations` de la función en el PR
- [ ] 1.2 Agregar `vitest` y `aws-sdk-client-mock` como devDependencies de `v4/backend` con script `test` (solo si ningún cambio previo lo hizo); verificar con `npm test` en verde con una prueba vacía

## 2. Autenticación y límite de tasa

- [ ] 2.1 Crear `src/lib/apiKey.ts` con `matchesApiKey(header, keys[])` (SHA-256 + `timingSafeEqual`, evalúa todas las keys, vacías ignoradas); verificar con vitest: key actual, key `NEXT`, key incorrecta, header ausente y ambas vacías → false
- [ ] 2.2 Usar `matchesApiKey` en `directSend.ts` con `SEND_API_KEY` y `SEND_API_KEY_NEXT`; verificar con vitest del handler que sin keys configuradas responde 401 aunque llegue header
- [ ] 2.3 Cambiar `serverless.yml` para leer ambas variables de `${ssm:/ana/v4/${sls:stage}/send-api-key}` y `send-api-key-next` (opcional) y agregar `RouteSettings` de throttling para `POST /send` (5 rps, ráfaga 10); verificar con `npx serverless package --stage dev` que la plantilla contiene el `RouteSettings` y que no queda `${env:SEND_API_KEY}`

## 3. Encolado y validación

- [ ] 3.1 Generar `jobId` con sufijo aleatorio y soportar `idempotencyKey` con `PutCommand` condicional (`attribute_not_exists(jobId)`) y respuesta `duplicate: true`; verificar con vitest (aws-sdk-client-mock): dos llamadas mismo ms → ids distintos; misma clave → un solo `Put` exitoso y misma respuesta; clave inválida → 400
- [ ] 3.2 Validar `username` contra `getEligibleAgents(campaign)` sin distinguir mayúsculas (400 si no está, 503 si la fuente falla) y escribir con la grafía devuelta; verificar con vitest los tres casos de `specs/v4/direct-send/spec.md`

## 4. Documentación

- [ ] 4.1 Reescribir `v4/ENVIO_DIRECTO.md` sin el valor de la key (placeholder `<SEND_API_KEY>`), con dónde vive (SSM), cómo pedirla, rotación, errores 400 (campaña inexistente, agente fuera de campaña, `idempotencyKey` inválida), 429 y `idempotencyKey`; verificar con `git grep -n "04a272bf" -- v4` sin resultados

## 5. Despliegue y rotación

- [ ] 5.1 Crear en SSM `us-east-2` (perfil `pernexium`) los SecureString de dev y prod: `send-api-key` = key nueva de 32 bytes aleatorios y `send-api-key-next` vacío (la key expuesta no se guarda); verificar con `aws ssm get-parameter --with-decryption` que existen (sin pegar valores en el PR)
- [ ] 5.2 Desplegar en dev (`npx serverless deploy --stage dev` en `v4/backend`) y probar con `curl`: key nueva 200, key expuesta 401, ráfaga → 429, agente inexistente 400; registrar evidencia
- [ ] 5.3 Desplegar en prod (`npx serverless deploy --stage prod`); verificar con `curl` que la key expuesta responde 401 y monitorear 401 de `directSend` en CloudWatch durante una semana (la key nueva se entrega por canal seguro solo a quien la solicite)

## Workflow follow-up

- Tras archivar, quitar de la nota de Purpose de `openspec/specs/v4/api-auth/spec.md` y `openspec/specs/v4/direct-send/spec.md` las menciones a la key expuesta y a la comparación no constante.
