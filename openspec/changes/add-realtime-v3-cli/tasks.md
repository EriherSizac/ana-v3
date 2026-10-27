# Tasks

## 1. Dependencia y configuración

- [x] 1.1 Agregar `ws` a `v3/cli-whatsapp/package.json` y marcar `bufferutil`/`utf-8-validate` como `--external` en `build:bundle`; agregar los módulos nuevos a `$filesToCopy` de `build-portable.ps1`; verificar con `npm ci`, un bundle de esbuild a un directorio temporal que incluye `ws` y carga sin errores, y `node --check` de los módulos
- [x] 1.2 Agregar `ANA_REALTIME_URL` (o `CONFIG.realtimeUrl`, vacío hasta el release) y `ANA_REALTIME` a `config.js`; verificar con `node --test` un test de lectura de ambas variables con y sin entorno (sin URL → canal deshabilitado)

## 2. Cliente realtime

- [x] 2.1 Crear `realtime.js` (`createRealtime`: subprotocolo `ana.v1, <token>`, `client=cli&v=<versión>`, `ping` al abrir y cada 5 min, activo tras el primer `pong`, timeout 30 s, backoff 1 s→5 min con jitter y 15 min tras 403 o 5 fallos, reconexión a los 110 min o con token nuevo con make-before-break, cierre con `stop()`, sin token en logs, tipos desconocidos ignorados); verificar con `node --test` y dobles de `WebSocket` y temporizadores cada escenario de "Conexión del CLI al canal", "Canal activo del CLI", "Reconexión del CLI" y "Latido del CLI"
- [x] 2.2 Filtro de avisos (`assignment.published` + campaña de la sesión en minúsculas) y `settings.changed` scope `cli`; verificar con `node --test` los escenarios de "Filtro de avisos de asignación" y "Lectura inmediata de configuración del CLI"
- [x] 2.3 Manejar `session.refresh` (cierre 4001, evento `refresh`, reconexión tras 0–10 s sin crecer el backoff) y agregar `backend.refreshAccess()` (`GET /agent/campaigns` siempre; ok/forbidden según la campaña); verificar con `node --test` los escenarios de "Actualización de acceso forzada en el CLI"

## 3. Integración en el bucle

- [x] 3.1 Extraer la espera entre polls a `poll-wait.js` (señal de despertar, `wakePending` para avisos durante ciclo/pausa, acortar a 30 s si el canal cae) con duración 2 min/30 s según `isActive()` y etiqueta "En vivo · respaldo en …"/"Próximo poll", y usarla en `index.js`; verificar con `node --test` los escenarios de `specs/v3/automated-sending/spec.md` y de "Avisos fuera de la espera" y "Estado del canal en el widget"
- [x] 3.2 Hacer `remote-settings.js` de intervalo variable (15 min activo / 5 min inactivo) con `refreshNow()`; verificar con `node --test` que los tests existentes siguen pasando y que `refreshNow` aplica el valor nuevo
- [ ] 3.3 Cablear en `index.js`: arrancar realtime tras `startRemoteSettings()` con `getIdToken`, lectura al reconectar, actualización forzada (`refreshAccess` + `refreshNow` + despertar), `stop()` en el cierre ordenado con Ctrl+C; verificar con `node --check index.js`, el bundle de esbuild y, en dev con `npm start` contra el gateway de dev: publicar desde "Mi asignación" (ANA Admin dev) inicia el ciclo en < 3 s; con `ANA_REALTIME=off` el widget muestra "Próximo poll" y los polls son cada 30 s
- [x] 3.4 Actualizar `README.md`/`HISTORIAL.md` del CLI con el canal, los intervalos, la actualización forzada y `ANA_REALTIME`/`ANA_REALTIME_URL`; verificar que los valores documentados coinciden con las constantes

## 4. Release

- [ ] 4.1 Fijar `CONFIG.realtimeUrl` con la URL `RealtimeWsUrl` de prod, subir la versión (siguiente a 1.0.47), `npm run build` y probar el `.exe` en una PC limpia: conecta (`ActiveConnections{client=cli}` sube), recibe una publicación de prueba en < 3 s y cierra con Ctrl+C sin errores
- [ ] 4.2 Publicar con `npm run upload` a toda la flota (sin piloto por agente) con el interruptor del servidor listo; verificar en CloudWatch la caída de invocaciones de `/get/chats` y la ausencia de alarmas `realtime-post-failing` durante la primera semana

## Workflow follow-up

- Rollout: requiere `add-realtime-gateway` (con el puente v3) desplegado en prod; rollback global con `realtimeEnabled=false`.
- Archivar después de `add-realtime-gateway`, `migrate-cli-to-cognito-login` y `add-cli-remote-settings`.
