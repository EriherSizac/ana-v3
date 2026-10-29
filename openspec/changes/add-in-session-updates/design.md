# Design

## Context

- **CLI v3**: `self-update.js` solo corre al arrancar (descarga y abre el asistente del instalador o, en pkg, reemplaza el `.exe`). La instalación vigente es la portable de Inno Setup (`installer/ANA-portable.iss`): `AppId` fijo, `PrivilegesRequired=lowest`, `{autopf}\ANA` (sin admin = `%LOCALAPPDATA%\Programs\ANA`), `[Run]` con `skipifsilent` y datos del agente en `%APPDATA%\ANA` (fuera de `{app}`). El proceso es `{app}\nodejs\node.exe` con cwd `{app}\app`; el lanzador es `{app}\ANA.bat`, que reenvía sus argumentos.
- `index.js`: ciclo bajo `createLoopSupervisor` con latido (`liveness.js`), espera entre polls interrumpible (`poll-wait.js`), registro local de asignación (`assignment-journal.js`, reanuda pendientes y marca "en curso" como por revisar), detector de reanudación y canal realtime (`realtime.js`, catálogo `KNOWN_EVENTS`).
- `latest.json` se escribe en `build-portable.ps1` antes de compilar el instalador (no puede llevar su hash); `upload-to-s3.py` lo sube tal cual.
- **Desktop v4**: `UpdaterCore` (puro) con `autoDownload`, chequeo cada 30 min y `installWhenIdle` (pausa jobs, espera ≤ 3 min, `quitAndInstall(false, true)`). El renderer pone `UpdatingOverlay` bloqueante a media sesión. `power/resume.ts` coordina la reanudación; `realtime/wiring.ts` enruta eventos.
- **Realtime**: puente v3 (regla `RealtimeBridgeRule` us-east-1 → bus v4; `translateS3`) y `notify` (us-east-2). El bucket `ana-desktop-updates` (us-east-2) se creó a mano (README v4); no está en IaC.

## Goals / Non-Goals

**Goals:** actualización obligatoria a media sesión en ambos clientes sin cerrar la app; nunca cortar un envío a medias; instalador verificado; reapertura sola; recuperación si falla.

**Non-Goals:** cambiar la actualización al arrancar (CLI y pantalla bloqueante del desktop); el modo pkg del CLI (legado); firmar instaladores; downgrade o canales.

## Decisions

- **D1. Obligatoria, sin posponer.** Por decisión del usuario no hay "Más tarde": al detectar la versión se pausa, descarga, 60 s de cuenta y se instala. Alternativa descartada: 30 min / 2 h de aplazamiento (más estado y la flota tardaba más en converger).
- **D2. CLI en módulos puros e inyectables** (patrón de `realtime.js`/`liveness.js`): `update-manifest.js` (parseo con BOM, HTML, `sha256`/`size` opcionales, comparación), `update-pause.js` (compuerta de pausa), `update-download.js` (descarga con hash en flujo), `update-helper.js` (script del ayudante y disposición de la instalación), `update-banner.js` (aviso en la página) y `in-session-update.js` (orquestador con reloj y temporizadores inyectados). `self-update.js` reutiliza el parseo.
- **D3. Compuerta de pausa.** `request()` devuelve una promesa que resuelve cuando el ciclo se estaciona. El ciclo la consulta en puntos seguros: inicio de iteración, antes de marcar un contacto "en curso", y sus esperas (entre contactos, pausa por lote, entre polls) son interrumpibles. Al estacionarse late cada segundo para que el supervisor no lo reinicie. Si el ciclo no se estaciona en 10 min se sigue (el registro local marca "en curso" como por revisar). La pausa por lote interrumpida no reinicia el contador; un chequeo antes de enviar repite la pausa si quedó pendiente.
- **D4. Ayudante PowerShell desacoplado.** Script `.ps1` temporal (UTF-8 con BOM para rutas con acentos) lanzado con `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File`, `detached` y oculto. Todos los valores van como literales entre comillas simples (se duplican `'` y las comillas tipográficas que PowerShell también acepta); versión `N.N.N`, PID entero, indicadores `--[a-z0-9-]+` sin `--reset-*`/`--logout`. Pasos: esperar el PID (≤ 3 min, luego lo termina), instalador con `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /LOG=…` (≤ 15 min), escribir `%APPDATA%\ANA\update-result.json` y `update.log`, reabrir `ANA.bat` (Start-Process, nueva consola). Alternativa `cmd /c`: su escape es frágil con `&`, `^`, `%`.
- **D5. Orden del cierre.** Primero se lanza el ayudante (si falla, se reanuda el ciclo sin haber cerrado nada); después se cierran navegadores (cada uno ≤ 20 s) y se sale con código 0. Inno revierte archivos ante fallo; el ayudante reabre lo que haya instalado. El upgrade silencioso usa el mismo `AppId` y directorio previo y no ejecuta `[UninstallDelete]`; `%APPDATA%\ANA` no se toca.
- **D6. Fallo al siguiente arranque.** El CLI lee y borra `update-result.json`: si `ok=false`, aviso en consola y en la ventana manual. Luego corre la actualización de arranque de siempre (asistente visible), que es el respaldo manual.
- **D7. Integridad.** `upload-to-s3.py` reescribe siempre `latest.json` con `sha256`/`size` del instalador que sube (lo calcula al subir, después de compilar). `build-completo.ps1` lo imprime. Clientes: `size` del manifiesto o `Content-Length`; `sha256` si viene. Solo URLs `https:`.
- **D8. Evento `release.available`.** Tipo nuevo del catálogo con `ref.scope` (`cli`|`desktop`), entrega a `k#<cliente>`, sin `users`. v3: `versions/latest.json` al patrón de la regla y a `translateS3`. Desktop: regla `AnaDesktopReleaseRule` en el bus por defecto de us-east-2 (bucket por parámetro `desktopUpdatesBucket`, llave `updates/latest.yml`) → `notify`, que lo reconoce antes del filtro `V3_BUCKET`. Habilitar EventBridge en el bucket es manual (no está en IaC). Jitter 0–30 s en clientes para no golpear S3 a la vez.
- **D9. Desktop.** `UpdaterCore` distingue arranque (hasta la primera fase `none`) de sesión. En sesión: `update-available` → `pauseNewJobs` y fase `downloading` con `inSession`; `update-downloaded` → espera del job (≤ 3 min) → fase `restarting` con `secondsLeft` 60…1 → `beforeInstall` → `quitAndInstall(true, true)`. Error en sesión → `resumeJobs` y fase `error` con `inSession`. `checkNow()` para reanudación y realtime. El renderer muestra `UpdateBanner` (fijo, sin cerrar) en lugar del overlay.

## Risks / Trade-offs

- [El instalador falla en silencio] → `update.log`, `/LOG` de Inno, reapertura de la versión anterior y aviso al arrancar.
- [Muchos clientes descargan a la vez ~150 MB] → jitter 0–30 s y chequeo de 30 min desfasado por arranque; S3 lo absorbe.
- [El ciclo no se estaciona (llamada colgada)] → tope de 10 min; el registro local evita reenvíos.
- [SmartScreen/antivirus bloquea el ayudante o el instalador] → resultado de error registrado y reapertura; el arranque ofrece el asistente.
- [`/CLOSEAPPLICATIONS` cierra un Chromium huérfano] → aceptable: los perfiles persistentes ya se cerraron con orden.

## Migration Plan

1. Deploy v4/backend (catálogo + regla del desktop) y v3/ana-backend (patrón del puente); habilitar EventBridge en `ana-desktop-updates`.
2. Release del CLI con esta función: la flota lo toma con la actualización al arrancar (camino viejo); desde ahí, actualizaciones a media sesión.
3. Release del desktop: igual, por la pantalla de arranque o el overlay viejo.
4. Rollback: release anterior por el mismo camino; `realtimeEnabled=false` apaga el aviso (queda el chequeo de 30 min).

## Open Questions

- ¿Firmar el instalador del CLI para reducir bloqueos de SmartScreen en el modo silencioso?
