# Proposal

## Why

Hoy el CLI v3 solo busca actualización al arrancar y el desktop v4, a media sesión, tapa toda la app con un overlay bloqueante que corta el envío en curso. Los agentes dejan ANA abierto días enteros, así que un release tarda en llegar a la flota o interrumpe el trabajo. Queremos que ambos clientes se actualicen solos, sin que el agente cierre la app: detectar la versión nueva durante la sesión, pausar con orden, descargar, instalar en silencio y reabrirse.

## What Changes

- **CLI v3**: chequeo del manifiesto cada 30 min, al reanudar el equipo y con el aviso realtime `release.available`. Si hay una versión mayor, la actualización es **obligatoria** (sin "Más tarde"): aviso fijo en la ventana manual "Nueva versión X — se actualizará automáticamente" con el estado; pausa ordenada del ciclo (termina el contacto en curso y no inicia el siguiente; las respuestas manuales siguen permitidas); descarga con progreso y verificación de tamaño y SHA-256; cuenta regresiva de 60 s sin cancelar; cierre limpio de los navegadores; un ayudante desacoplado espera a que el proceso termine, corre el instalador Inno en modo silencioso, registra en `%APPDATA%\ANA\update.log` y reabre ANA. Si la instalación falla, se reabre la versión anterior y el error se muestra al siguiente arranque. Nunca se instala una versión menor o igual.
- **Publicación del CLI**: `latest.json` incluye `sha256` y `size` del instalador; los manifiestos sin `sha256` se siguen aceptando con verificación de tamaño.
- **Realtime**: nuevo evento `release.available` (`ref.scope` = `cli` | `desktop`) para todas las conexiones del tipo de cliente. El puente S3 de v3 lo emite al crearse `versions/latest.json`; una regla nueva en us-east-2 lo emite al crearse `updates/latest.yml` del bucket `ana-desktop-updates`. Los clientes viejos ignoran el tipo desconocido.
- **Desktop v4**: chequeo cada 30 min, al reanudar y con `release.available`. A media sesión: aviso no bloqueante (sin "Más tarde"), el poller deja de tomar jobs y termina el actual, descarga con progreso, cuenta regresiva de 60 s e instalación silenciosa con reapertura (`quitAndInstall(true, true)`). La pantalla bloqueante del arranque no cambia. **BREAKING** (comportamiento): desaparece el overlay bloqueante a media sesión.
- **Docs**: pasos de release para que los clientes tomen la versión (sha256 en `latest.json`, evento realtime, paso manual del bucket del desktop).

## Capabilities

### New Capabilities

- `v3/cli-in-session-update`: actualización obligatoria del CLI v3 durante la sesión (detección, pausa, descarga verificada, instalación silenciosa, reapertura y recuperación ante fallo).
- `v4/desktop-in-session-update`: actualización obligatoria del desktop v4 durante la sesión, sin bloquear la interfaz.
- `v4/release-notifications`: aviso realtime `release.available` cuando se publica una versión del CLI o del desktop.

### Modified Capabilities

- `v3/cli-distribution`: el manifiesto publicado incluye `sha256` y `size` del instalador.
- `v4/desktop-update`: el chequeo periódico ya no muestra el overlay bloqueante a media sesión (lo reemplaza `v4/desktop-in-session-update`).

## Impact

- CLI v3 (`v3/cli-whatsapp`): módulos nuevos de manifiesto, pausa, descarga, ayudante de instalación, aviso en la ventana manual y orquestador; cambios en `index.js`, `realtime.js`, `self-update.js`, `build-portable.ps1`, `build-completo.ps1`, `upload-to-s3.py`; pruebas `node --test`. Requiere release del CLI; **el primer release con esta función llega por el camino actual (actualización al arrancar)**.
- v3/ana-backend: patrón de la regla `RealtimeBridgeRule` (+`versions/latest.json`). Requiere deploy.
- v4/backend: catálogo realtime, puente, `notify` y regla del bucket del desktop en `serverless.yml`; pruebas vitest. Requiere deploy y habilitar EventBridge en `ana-desktop-updates` (paso manual).
- Desktop v4: `update/updaterCore.ts`, `updater.ts`, `main.ts`, `jobs/poller.ts`, `realtime/*`, renderer (`App.tsx`, aviso nuevo); pruebas vitest. Requiere release del desktop.
