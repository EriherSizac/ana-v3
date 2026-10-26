# desktop-update Specification

## Purpose
Describe la auto-actualización obligatoria de la app de escritorio v4 con `electron-updater` sobre un feed S3: chequeo al arrancar detrás de una pantalla bloqueante, descarga e instalación automáticas, tolerancia a feed ausente, salida de emergencia ante error, chequeos periódicos y overlay bloqueante cuando se encuentra una versión a media sesión.

> Nota: el chequeo inicial no es realmente obligatorio: ante cualquier error distinto de un 404 la pantalla ofrece "Continuar sin actualizar". Cada invocación del chequeo desde el renderer vuelve a registrar los listeners y el intervalo periódico (por ejemplo, si el renderer se recarga), duplicando eventos.

## Requirements

### Requirement: Pantalla bloqueante de actualización
Antes de mostrar login o cualquier vista, la app instalada SHALL mostrar una pantalla bloqueante con "PERNEXIUM" y "ana" y MUST pedir el chequeo de actualización solo después de suscribirse a los eventos de estado. Los textos SHALL ser "Buscando actualizaciones…", "Descargando actualización… N%" con barra de progreso, e "Instalando y reiniciando…". En desarrollo la pantalla se omite.

#### Scenario: Ya está al día
- **WHEN** el feed indica que no hay versión nueva
- **THEN** la pantalla se cierra sola y aparece el login o la vista principal

#### Scenario: Hay versión nueva
- **WHEN** el feed publica una versión mayor
- **THEN** la pantalla muestra el porcentaje de descarga y luego "Instalando y reiniciando…"

### Requirement: Descarga e instalación automáticas
En build instalado el updater SHALL descargar la versión nueva automáticamente e instalar al salir. Al terminar la descarga MUST emitir fase `installing`, detener el cliente de WhatsApp y su Chromium (ignorando errores) y, 500 ms después, lanzar el instalador NSIS en modo visible con reapertura de la app al terminar.

#### Scenario: Descarga completa
- **WHEN** termina la descarga de la actualización
- **THEN** WhatsApp se cierra, se ejecuta el instalador visible y la app se reabre actualizada

### Requirement: Feed ausente no bloquea
Un error del updater cuyo texto contenga `404`, `latest.yml`, `Not Found` o `ERR_FILE_NOT_FOUND` SHALL tratarse como "sin actualizaciones" (fase `none`). Cualquier otro error MUST emitir fase `error` con el mensaje. En desarrollo el updater SHALL emitir `none` sin consultar el feed.

#### Scenario: Canal sin publicar
- **WHEN** el bucket aún no tiene `latest.yml`
- **THEN** la app continúa como si estuviera al día

#### Scenario: Sin red
- **WHEN** el chequeo falla por falta de conexión
- **THEN** la pantalla muestra "No se pudo verificar la actualización", el mensaje y el botón "Continuar sin actualizar"

#### Scenario: Continuar sin actualizar
- **WHEN** el operador pulsa "Continuar sin actualizar"
- **THEN** la pantalla se cierra y la app sigue con la versión instalada

### Requirement: Chequeo periódico y overlay a media sesión
El updater SHALL volver a consultar el feed cada 30 minutos mientras la app esté abierta. Si durante la sesión llega fase `downloading` o `installing`, la app MUST reemplazar toda la interfaz por un overlay bloqueante con el porcentaje o "Instalando actualización y reiniciando…" y el texto "La app se reiniciará sola al terminar"; cualquier otra fase retira el overlay.

#### Scenario: Equipo que nunca cierra la app
- **WHEN** se publica una versión nueva mientras el operador trabaja
- **THEN** en máximo 30 minutos aparece el overlay, se instala la versión y la app se reinicia

> Nota: el overlay interrumpe cualquier envío de campaña en curso; el job que estuviera enviándose puede quedar sin acuse (ver `v4/job-processing`).
