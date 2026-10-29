# Spec Delta

## Purpose

Que el CLI v3 instalado se actualice solo durante la sesión, sin que el agente cierre ANA y sin perder la asignación en curso.

## ADDED Requirements

### Requirement: Detección de versión durante la sesión
El CLI instalado (portable con `ANA.bat`) SHALL leer el manifiesto cada 30 min mientras corre, al detectar una reanudación del equipo y al recibir `release.available` con `ref.scope = cli` (con espera aleatoria de 0–30 s). Solo una versión estrictamente mayor que la local MUST iniciar la actualización; un error de lectura se registra y se reintenta en el siguiente chequeo. Con `--no-self-update` o fuera de la instalación portable no se hace nada.

#### Scenario: Versión nueva publicada a media sesión
- **WHEN** se publica `1.0.51` y el CLI corre `1.0.50`
- **THEN** en máximo 30 min (o segundos con el canal realtime activo) inicia la actualización

#### Scenario: Manifiesto con versión menor
- **WHEN** el manifiesto anuncia `1.0.49` y el CLI corre `1.0.50`
- **THEN** no descarga nada

### Requirement: Aviso obligatorio sin posponer
Al iniciar la actualización, la ventana manual SHALL mostrar un aviso fijo, sin botón para cerrarlo ni posponerlo, con "Nueva versión X — se actualizará automáticamente" y el estado vigente (terminando el envío, descargando N %, reiniciando en N s). La consola MUST registrar cada fase. El aviso no bloquea el resto de la ventana.

#### Scenario: Agente respondiendo un chat
- **WHEN** aparece el aviso mientras el agente escribe en la ventana manual
- **THEN** puede seguir respondiendo y el aviso sigue visible con el estado

### Requirement: Pausa ordenada del ciclo
Al iniciar la actualización, el CLI SHALL pedir la pausa del ciclo principal: el contacto que se está enviando termina (envío, interacción y reporte) y no se inicia el siguiente; las esperas entre contactos, la pausa por lote y la espera entre polls se interrumpen. Lo pendiente MUST quedar en el registro local para reanudarse tras reabrir. Si el ciclo no se detiene en 10 min, se continúa igual.

#### Scenario: Asignación a medias
- **WHEN** se pide la pausa en el contacto 5 de 20
- **THEN** el contacto 5 termina, el 6 no se envía y tras reabrir ANA reanuda desde el 6

### Requirement: Descarga verificada
El CLI SHALL descargar el instalador a un archivo temporal mostrando el porcentaje. MUST verificar el tamaño (contra `size` del manifiesto o, si falta, contra `Content-Length`) y, si el manifiesto trae `sha256`, el hash SHA-256. Ante cualquier discrepancia o error, borra el archivo, reanuda el ciclo, muestra el error y reintenta en el siguiente chequeo.

#### Scenario: Hash distinto
- **WHEN** el SHA-256 del archivo descargado no coincide con el del manifiesto
- **THEN** el instalador se borra, no se instala y el ciclo continúa

#### Scenario: Manifiesto viejo sin sha256
- **WHEN** el manifiesto solo trae `version` y `url`
- **THEN** se acepta si el tamaño coincide con `Content-Length`

### Requirement: Instalación silenciosa y reapertura
Tras la descarga, el aviso SHALL mostrar "Reiniciando para actualizar en N s" durante 60 s, sin cancelar. Luego un ayudante desacoplado MUST esperar a que termine el proceso, ejecutar el instalador con `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS` y reabrir `ANA.bat` con los mismos indicadores. El CLI cierra antes sus navegadores sin borrar sesiones. Todo queda en `%APPDATA%\ANA\update.log`.

#### Scenario: Actualización exitosa
- **WHEN** termina la cuenta regresiva
- **THEN** ANA se cierra, se instala la versión nueva y se reabre sola con las sesiones de WhatsApp intactas

### Requirement: Recuperación ante fallo de instalación
Si el instalador termina con código distinto de 0, el ayudante SHALL reabrir la versión instalada y registrar el resultado. Al siguiente arranque el CLI MUST mostrar en consola y en la ventana manual que la actualización falló, con la versión y el código. Los datos de `%APPDATA%\ANA` nunca se tocan.

#### Scenario: Instalador falla
- **WHEN** el instalador silencioso devuelve un código de error
- **THEN** ANA se reabre con la versión anterior y muestra "No se pudo instalar la versión X"

### Requirement: Construcción segura del ayudante
Los valores que recibe el ayudante (rutas, versión, PID, indicadores) MUST viajar como literales escapados del script, nunca interpretados por un shell; la versión SHALL validarse como `N.N.N`, el PID como entero y solo se reenvían indicadores `--nombre` (sin `--reset-*` ni `--logout`).

#### Scenario: Ruta con comillas
- **WHEN** la ruta del perfil del usuario contiene `'` o espacios
- **THEN** el script resultante la trata como texto literal y no ejecuta nada adicional
