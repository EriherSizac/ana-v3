# cli-distribution Specification

## Purpose
Describe cómo se empaqueta, publica y auto-actualiza el CLI v3 de WhatsApp (`v3/cli-whatsapp`) para los agentes en Windows: versionado, build portable con Node.js embebido o ejecutable pkg, instalador Inno Setup, publicación en S3 y protocolo de auto-actualización basado en el manifiesto `versions/latest.json`.

## Requirements

### Requirement: Versión local
El CLI SHALL determinar su versión actual a partir de la variable `ANA_VERSION` (inyectada en el bundle del build pkg) o, si no existe, del campo `version` del `package.json` ubicado junto al código. Si no puede determinar una versión mayor que `0.0.0`, MUST omitir la auto-actualización.

#### Scenario: Instalación portable
- **WHEN** el CLI se ejecuta desde la instalación portable (`node index.js`)
- **THEN** la versión local es la del `package.json` de la carpeta `app`

### Requirement: Manifiesto de versiones
El CLI SHALL leer el manifiesto desde la variable `ANA_UPDATE_MANIFEST_URL` o, por defecto, `https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/latest.json`, con un GET HTTPS con `Cache-Control: no-cache` y timeout de 20 s. El manifiesto MUST ser JSON con `version` y opcionalmente `url`; el CLI SHALL eliminar BOM, rechazar respuestas vacías o HTML y, ante cualquier error, omitir la actualización.

#### Scenario: Manifiesto inaccesible
- **WHEN** S3 responde con un estado no 2xx o el manifiesto no es JSON
- **THEN** el CLI registra "Auto-update: error leyendo manifest" y arranca normalmente

### Requirement: Comparación de versiones
El CLI SHALL comparar versiones como tres componentes numéricos `major.minor.patch` (ignorando caracteres no numéricos y tratando componentes faltantes como 0), y solo MUST actualizar cuando la versión remota es estrictamente mayor que la local.

#### Scenario: Misma versión
- **WHEN** la versión remota es `1.0.46` y la local es `1.0.46`
- **THEN** se imprime "Auto-update: no hay actualización disponible" y no se descarga nada

#### Scenario: Versión remota mayor
- **WHEN** la versión remota es `1.0.47` y la local `1.0.46`
- **THEN** el CLI inicia la descarga

### Requirement: Descarga de la actualización
Cuando hay una versión mayor, el CLI SHALL descargar `manifest.url` o, si falta, `https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-<versión>.exe` a `%TEMP%\ANA-<versión>.exe`, mostrando progreso (barra en consola interactiva o cada 5% en no interactiva), con timeout de inactividad de 60 s. Si la descarga falla, MUST borrar el archivo parcial y continuar sin actualizar.

#### Scenario: Descarga interrumpida
- **WHEN** la conexión falla durante la descarga
- **THEN** el archivo temporal se elimina y el CLI arranca con la versión actual

### Requirement: Aplicación de la actualización en instalación portable
Cuando el CLI no corre como ejecutable pkg (instalación portable con `node index.js`), tras descargar SHALL lanzar el instalador descargado mediante `cmd /c start`, con lanzamiento directo como respaldo, y MUST terminar su flujo principal sin abrir ventanas para que el agente complete la instalación.

#### Scenario: Instalación portable desactualizada
- **WHEN** un agente con la instalación portable abre ANA y hay una versión nueva publicada
- **THEN** se descarga `ANA-<versión>.exe`, se abre el asistente del instalador y el CLI termina sin abrir WhatsApp

#### Scenario: No se puede lanzar el instalador
- **WHEN** fallan tanto `cmd /c start` como el lanzamiento directo
- **THEN** el CLI continúa el arranque normal con la versión actual

> Nota: el comentario en `index.js:265` indica "solo EXE/pkg", pero la verificación también corre en modo portable y en desarrollo (`npm start`), donde lanzaría el instalador si la versión publicada es mayor; en desarrollo debe usarse `--no-self-update`.

### Requirement: Aplicación de la actualización en ejecutable pkg
Cuando el CLI corre como ejecutable pkg, tras descargar SHALL lanzar en segundo plano un script PowerShell temporal que, en hasta 90 intentos cada 500 ms, renombra el ejecutable actual a `<exe>.bak`, mueve el nuevo a su lugar y lo relanza con los mismos argumentos; el CLI MUST terminar su flujo principal sin abrir ventanas.

#### Scenario: Ejecutable pkg desactualizado
- **WHEN** el CLI corre como `ANA.exe` empaquetado con pkg y hay una versión nueva
- **THEN** el ejecutable se reemplaza (el anterior queda como `.bak`) y se relanza automáticamente con los mismos argumentos

### Requirement: Incremento de versión en cada build
Los scripts `build-portable.ps1` y `build.ps1` SHALL incrementar en 1 el componente patch de `version` en `package.json` al iniciar, y MUST generar un `latest.json` con `{version, url}` donde `url` es `https://ana-backend-storage-prod.s3.us-east-1.amazonaws.com/versions/ANA-<versión>.exe`.

#### Scenario: Build portable
- **WHEN** se ejecuta `build-portable.ps1` con `package.json` en `1.0.46`
- **THEN** `package.json` queda en `1.0.47` y `dist-portable/latest.json` contiene `version: 1.0.47`

### Requirement: Build portable con Node.js embebido
El build portable (`build-portable.ps1`, flujo vigente) SHALL regenerar desde cero `dist-portable/` con: `nodejs/` (Node.js 18.20.2 win-x64 de nodejs.org), `app/` (módulos JS del CLI, `package.json` y dependencias de producción) y `browsers/` (copia de `%LOCALAPPDATA%\ms-playwright` tras instalar Chromium). Cualquier paso fallido MUST terminar el script con código 1.

#### Scenario: Estructura generada
- **WHEN** `build-portable.ps1` termina correctamente
- **THEN** `dist-portable/` contiene `nodejs/`, `app/`, `browsers/`, `ANA.bat`, `ANA-con-imagen.bat` y `latest.json`

### Requirement: Lanzadores de la instalación portable
El build portable SHALL generar `ANA.bat` y `ANA-con-imagen.bat`, que MUST fijar `PLAYWRIGHT_BROWSERS_PATH` a `browsers`, anteponer `nodejs` al `PATH` y ejecutar `node index.js` desde `app` pasando sus argumentos; `ANA-con-imagen.bat` MUST añadir `--clipboard-media`. Al iniciar, el CLI SHALL usar la carpeta `browsers` del directorio padre o del propio directorio si existe.

#### Scenario: Ejecución del lanzador
- **WHEN** el agente abre el acceso directo "ANA"
- **THEN** se ejecuta `ANA.bat`, que inicia el CLI con el Node y el Chromium incluidos sin requerir instalaciones previas

#### Scenario: Lanzador con imagen
- **WHEN** el agente abre "ANA (con imagen)"
- **THEN** el CLI arranca con `--clipboard-media`

### Requirement: Build completo del instalador
`build-completo.ps1` SHALL ejecutar en orden `verificar-build.ps1`, `build-portable.ps1` y la compilación de `installer/ANA-portable.iss` con `ISCC.exe` de Inno Setup 6 (o 5), MUST renombrar la salida `dist-portable/ANA-Setup-Portable.exe` a `dist-portable/ANA-<versión>.exe` y SHALL continuar con la publicación en S3.

#### Scenario: Build completo
- **WHEN** se ejecuta `build-completo.ps1` con Inno Setup instalado
- **THEN** se genera `dist-portable/ANA-<versión>.exe` y a continuación se inicia la publicación en S3

#### Scenario: Inno Setup ausente
- **WHEN** no se encuentra `ISCC.exe` en las rutas conocidas
- **THEN** el script termina con código 1 e indica compilar manualmente `installer\ANA-portable.iss`

### Requirement: Instalador Inno Setup
El instalador de `installer/ANA-portable.iss` SHALL instalar sin privilegios de administrador en `{autopf}\ANA`, solo en Windows x64 y en español, y MUST crear en el menú inicio los accesos "ANA", "ANA (con imagen)" y el desinstalador, con icono opcional en el escritorio y la opción de ejecutar ANA al finalizar.

#### Scenario: Windows de 32 bits
- **WHEN** se ejecuta el instalador en Windows de 32 bits
- **THEN** se muestra "Este instalador requiere Windows de 64 bits." y la instalación se cancela

> Nota: los documentos (`INICIO-RAPIDO-INSTALADOR.md`, `INSTALADOR-README.md`) indican `C:\Program Files\ANA`, pero con `PrivilegesRequired=lowest` `{autopf}` resuelve a la carpeta de programas del usuario. El desinstalador borra `{app}\app\whatsapp-session*`, pero los perfiles reales viven en `%APPDATA%\ANA`, por lo que sesiones y configuración sobreviven a la desinstalación. `AppVersion` está fijo en `1.0.0`.

### Requirement: Build alternativo con pkg
El script `build.ps1` (flujo anterior) SHALL empaquetar el CLI con esbuild en `dist/app.cjs` (inyectando `ANA_VERSION`, con `playwright` externo), generar `dist/ANA.exe` con pkg para `node18-win-x64`, copiar los navegadores a `dist/browsers` y escribir `dist/latest.json`. En modo pkg, el CLI MUST usar `browsers` junto al ejecutable y `%APPDATA%\ANA` como directorio de datos.

#### Scenario: Build pkg
- **WHEN** se ejecuta `build.ps1`
- **THEN** se generan `dist/ANA.exe`, `dist/browsers/` y `dist/latest.json`

> Nota: `build.ps1` termina invocando `setup-and-upload.ps1`, que publica el instalador de `dist-portable/` y no el `dist/ANA.exe` recién generado; `upload-to-s3.ps1` (AWS CLI) sí publica `dist/ANA.exe`. El instalador asociado `installer/ANA.iss` instala en `{localappdata}\Asistente de Negociacion Avanzada (ANA)`.

### Requirement: Entorno de publicación en S3
La publicación (`setup-and-upload.ps1`) SHALL verificar que Python está instalado, crear o reutilizar el entorno virtual `venv`, instalar `requirements.txt` y ejecutar `upload-to-s3.py`. Si no existe `.env`, MUST copiarlo de `.env.example` y esperar a que el operador lo edite con las credenciales AWS.

#### Scenario: Primera publicación
- **WHEN** se ejecuta la publicación sin `.env`
- **THEN** se crea `.env` desde `.env.example` y el script espera Enter antes de continuar

### Requirement: Artefactos publicados en S3
`upload-to-s3.py` SHALL subir al bucket `S3_BUCKET_NAME` (por defecto `ana-backend-storage-prod`, región por defecto `us-east-1`), en este orden: `versions/ANA-<versión>.exe` (de `dist-portable/ANA-<versión>.exe` o `dist-portable/ANA-Setup-Portable.exe`), `versions/latest.json` con `Content-Type: application/json` y una copia `versions/ANA-latest.exe`. MUST crear `latest.json` si falta y terminar con código 1 ante cualquier fallo.

#### Scenario: Publicación exitosa
- **WHEN** se ejecuta la publicación tras un build completo de la versión `1.0.47`
- **THEN** existen en S3 `versions/ANA-1.0.47.exe`, `versions/latest.json` con `version: 1.0.47` y `versions/ANA-latest.exe`
- **AND** los clientes con versión menor descargan la nueva versión en su siguiente arranque

#### Scenario: Sin credenciales AWS
- **WHEN** no hay credenciales AWS configuradas
- **THEN** el script imprime "No se encontraron credenciales de AWS" y termina con código 1

> Nota: si `dist-portable/latest.json` ya existe se sube tal cual, sin verificar que coincida con `package.json`. El orden de subida (ejecutable antes que manifiesto) evita que los clientes vean una versión cuyo instalador aún no existe.
