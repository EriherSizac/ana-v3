# desktop-auth Specification

## Purpose
Describe el inicio de sesión del operador en la app de escritorio v4: autenticación directa contra el User Pool de Cognito con usuario y contraseña (SRP de Amplify, sin Hosted UI ni cookie SSO), retos de MFA y cambio forzado de contraseña, manejo del ID token, su entrega al proceso main y el cierre de sesión. El efecto del login sobre la sesión de WhatsApp se detalla en `v4/whatsapp-session`; la validación del token en el backend corresponde a las especificaciones del backend.

> Nota: los tokens de Cognito los guarda Amplify con su almacenamiento por defecto en el renderer (localStorage). El ID token se entrega al proceso main solo al iniciar sesión o al arrancar la app; el main no lo renueva, por lo que al expirar (típicamente 1 hora) el poller de jobs, el respaldo de sesión de WhatsApp y la persistencia de mensajes envían un token vencido y fallan en silencio hasta reiniciar la app o volver a entrar.

## Requirements

### Requirement: Configuración de Cognito
El renderer SHALL configurar Amplify con `VITE_COGNITO_USER_POOL_ID` y `VITE_COGNITO_CLIENT_ID` fijados en build, una sola vez al arrancar. Si falta cualquiera de los dos, MUST registrar un error en consola y dejar Amplify sin configurar.

#### Scenario: Build sin variables de Cognito
- **WHEN** el renderer se compiló sin `VITE_COGNITO_CLIENT_ID`
- **THEN** se registra "faltan VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_CLIENT_ID" y el login no puede completarse

### Requirement: Pantalla de login
La pantalla de login SHALL mostrar fondo azul de marca, el título "ana", el subtítulo "Acceso de operador", un campo "Usuario" de texto libre (no email) y un campo "Contraseña" con botón "Ver"/"Ocultar". El usuario MUST recortarse de espacios antes de enviarse. El botón "Entrar" SHALL mostrar "Entrando…" y deshabilitarse mientras se valida.

#### Scenario: Credenciales correctas sin MFA
- **WHEN** el operador escribe usuario y contraseña válidos y pulsa "Entrar"
- **THEN** la sesión queda iniciada y la app muestra la vista principal

#### Scenario: Credenciales incorrectas
- **WHEN** Cognito rechaza las credenciales
- **THEN** la pantalla muestra el mensaje de error devuelto o "No se pudo iniciar sesión"

### Requirement: Retos de verificación
Cuando Cognito pide un paso adicional la pantalla SHALL cambiar a la fase de verificación con la etiqueta del reto: código TOTP, código SMS, selección de método MFA (mostrando "Escribe: TOTP o SMS"), alta de TOTP (mostrando el secreto compartido) o nueva contraseña. Cualquier paso no reconocido MUST tratarse como sesión completada. "Volver" SHALL regresar a la fase de credenciales.

#### Scenario: Cambio de contraseña forzado
- **WHEN** Cognito exige nueva contraseña tras el primer login
- **THEN** se muestra "Nueva contraseña" con un campo de tipo contraseña y el botón "Continuar"

#### Scenario: Primer enrolamiento TOTP
- **WHEN** Cognito pide configurar TOTP
- **THEN** se muestra "Secreto: <clave>" y un campo para escribir el código de la app autenticadora

#### Scenario: Paso desconocido
- **WHEN** Cognito responde un paso que la app no mapea
- **THEN** la app considera la sesión iniciada y continúa

### Requirement: Captura de código OTP
Para retos TOTP y SMS la pantalla SHALL mostrar 6 casillas de un dígito que solo aceptan números, avanzan solas al escribir, retroceden con Backspace en casilla vacía y aceptan pegar el código completo. Al llenarse las 6 casillas el código MUST enviarse automáticamente sin botón; mientras se valida se muestra "Verificando…".

#### Scenario: Pegar código
- **WHEN** el operador pega "123456" en la primera casilla
- **THEN** las 6 casillas se llenan y el código se envía solo

#### Scenario: Código incorrecto
- **WHEN** Cognito rechaza el código
- **THEN** se muestra el error o "Código incorrecto" y las casillas conservan los dígitos escritos

### Requirement: Token entregado al proceso main
Tras completar el login, y al arrancar la app si ya había sesión viva, el renderer SHALL obtener el ID token (no el access token) y entregarlo al proceso main. Las llamadas del renderer al backend MUST enviar `Authorization: Bearer <id token>` obtenido en cada llamada, y omitir el encabezado si no hay sesión.

#### Scenario: Reapertura con sesión guardada
- **WHEN** el operador reabre la app y Amplify conserva una sesión válida
- **THEN** la app no pide login, re-entrega el token al main y carga `/me`

#### Scenario: Sin sesión
- **WHEN** no hay usuario actual o no hay ID token
- **THEN** la app muestra la pantalla de login

### Requirement: Cierre de sesión
El botón "Salir" SHALL cerrar la sesión de Amplify y luego informar al main un token nulo. Al recibirlo, el main MUST detener el poller de jobs, olvidar la campaña registrada, borrar la sesión local de WhatsApp (conservando el respaldo remoto) y emitir estado `disconnected`.

#### Scenario: Cambio de operador en la misma PC
- **WHEN** un operador pulsa "Salir"
- **THEN** vuelve la pantalla de login y el siguiente usuario no hereda el WhatsApp local del anterior
