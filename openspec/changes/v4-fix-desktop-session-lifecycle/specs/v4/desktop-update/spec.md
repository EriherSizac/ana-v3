# Spec Delta

## MODIFIED Requirements

### Requirement: Feed ausente no bloquea
Un error del updater cuyo texto contenga `404`, `latest.yml`, `Not Found` o `ERR_FILE_NOT_FOUND` SHALL tratarse como "sin actualizaciones" (fase `none`). Cualquier otro error MUST emitir fase `error` con el mensaje; en build instalado la pantalla bloqueante SHALL mostrar "No se pudo verificar la actualización", el mensaje y "Reintentar", reintentar sola cada 60 segundos y no ofrecer un botón para continuar sin actualizar; la única salida sin actualizar SHALL ser el acceso de emergencia de Sistemas. En desarrollo el updater SHALL emitir `none` sin consultar el feed.

#### Scenario: Canal sin publicar
- **WHEN** el bucket aún no tiene `latest.yml`
- **THEN** la app continúa como si estuviera al día

#### Scenario: Sin red
- **WHEN** el chequeo falla por falta de conexión
- **THEN** la pantalla muestra "No se pudo verificar la actualización", el mensaje y el botón "Reintentar", sin opción para continuar

#### Scenario: Continuar sin actualizar
- **WHEN** el operador busca cómo seguir con la versión instalada tras un error del chequeo en el build instalado
- **THEN** no existe el botón "Continuar sin actualizar" y la app solo avanza cuando el chequeo termina en `none`, se instala la versión nueva o Sistemas usa el acceso de emergencia

#### Scenario: Reintento automático
- **WHEN** la red vuelve mientras la pantalla muestra el error
- **THEN** en máximo 60 segundos el chequeo se repite y, si está al día, la pantalla se cierra

## ADDED Requirements

### Requirement: Acceso de emergencia de Sistemas
En build instalado con la fase `error` (no 404) y solo si el build se compiló con un hash de contraseña maestra (`ANA_UPDATE_BYPASS_HASH`), la pantalla de error SHALL ofrecer "Acceso de emergencia (Sistemas)", que pide la contraseña maestra. El main MUST verificarla contra el hash scrypt con sal en tiempo constante; la contraseña en claro no SHALL estar en el código ni en el build.

#### Scenario: Feed caído y Sistemas desbloquea
- **WHEN** el chequeo falla por un error distinto de 404 y Sistemas escribe la contraseña maestra correcta
- **THEN** la app continúa sin actualizar

#### Scenario: Build sin hash
- **WHEN** el build se compiló sin `ANA_UPDATE_BYPASS_HASH`
- **THEN** la pantalla de error no muestra "Acceso de emergencia (Sistemas)"

### Requirement: Límite de intentos del acceso de emergencia
El acceso de emergencia MUST permitir como máximo 5 contraseñas incorrectas y luego bloquearse 15 minutos, conservando el bloqueo aunque la app se reinicie.

#### Scenario: Contraseña incorrecta repetida
- **WHEN** se escriben 5 contraseñas incorrectas
- **THEN** el acceso queda bloqueado 15 minutos, incluso tras reiniciar la app, y la pantalla sigue bloqueada

### Requirement: Alcance y registro del acceso de emergencia
Un acceso de emergencia válido SHALL desbloquear la app solo hasta que termine el proceso (no se persiste), MUST mostrar el banner persistente "Sin actualizar — acceso de emergencia" y SHALL registrar el evento con fecha, versión de la app y operador si se conoce.

#### Scenario: Banner y registro
- **WHEN** Sistemas desbloquea con la contraseña correcta
- **THEN** se muestra el banner "Sin actualizar — acceso de emergencia" y queda registrado el uso

#### Scenario: Reapertura tras el acceso de emergencia
- **WHEN** la app se cierra y se vuelve a abrir con el feed aún caído
- **THEN** la pantalla de error vuelve a bloquear y el acceso de emergencia debe usarse de nuevo

### Requirement: Registro único del updater
El main SHALL registrar los listeners del updater y el chequeo periódico una sola vez por proceso. Si el renderer vuelve a pedir el chequeo (por ejemplo, tras recargarse), el main MUST re-emitir la última fase conocida sin crear listeners ni intervalos nuevos.

#### Scenario: Recarga del renderer
- **WHEN** el renderer se recarga tres veces durante una sesión
- **THEN** cada evento del updater llega una sola vez y sigue habiendo un único chequeo cada 30 minutos

### Requirement: Instalación tras el job en curso
Al terminar la descarga de una versión, el main MUST dejar de iniciar jobs nuevos y SHALL esperar a que termine el job que se esté enviando, como máximo 3 minutos, antes de cerrar WhatsApp e instalar. Mientras espera, el overlay MUST mostrar "Terminando el envío en curso…".

#### Scenario: Actualización a media campaña
- **WHEN** la descarga termina mientras un job está en "escribiendo…"
- **THEN** ese job se envía y se reporta, ningún job nuevo empieza y luego se instala la versión

#### Scenario: Sin envío en curso
- **WHEN** la descarga termina sin ningún job en curso
- **THEN** la instalación empieza de inmediato
