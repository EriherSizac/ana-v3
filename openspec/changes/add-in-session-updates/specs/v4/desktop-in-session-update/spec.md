# Spec Delta

## Purpose

Que el desktop v4 se actualice solo durante la sesión, sin bloquear la interfaz ni cortar el job en curso.

## ADDED Requirements

### Requirement: Detección durante la sesión
Tras pasar la pantalla de arranque, la app instalada SHALL consultar el feed cada 30 min, al reanudar el equipo y al recibir `release.available` con `ref.scope = desktop` (con espera aleatoria de 0–30 s). Un chequeo durante una actualización en curso se ignora. Solo una versión mayor que la instalada MUST iniciar la actualización.

#### Scenario: Release publicado con la app abierta
- **WHEN** se sube un `latest.yml` con versión mayor mientras el operador trabaja
- **THEN** la app empieza a actualizarse en segundos (canal activo) o en máximo 30 min

### Requirement: Aviso no bloqueante y obligatorio
Durante la actualización a media sesión la app SHALL mostrar un aviso fijo, sin botón para cerrarlo ni posponerlo, con "Nueva versión X — se actualizará automáticamente" y el estado (descargando N %, terminando el envío en curso, reiniciando en N s). El resto de la interfaz MUST seguir usable, incluidas las respuestas manuales.

#### Scenario: Operador en Chats
- **WHEN** empieza la descarga a media sesión
- **THEN** el operador sigue viendo y respondiendo chats con el aviso visible

### Requirement: Pausa de jobs e instalación silenciosa
Al detectar la versión, la app SHALL dejar de tomar jobs nuevos (el job en curso termina con su acuse), descargar, esperar el job en curso hasta 3 min, mostrar "Reiniciando para actualizar en N s" durante 60 s, cerrar WhatsApp conservando la sesión e instalar en modo silencioso reabriendo la app.

#### Scenario: Job enviándose al terminar la descarga
- **WHEN** termina la descarga con un job en curso
- **THEN** el job termina, corre la cuenta de 60 s y la app se reinstala y reabre sola

### Requirement: Error de descarga a media sesión
Si la descarga o el chequeo a media sesión fallan, la app SHALL volver a tomar jobs, mostrar un aviso de error no bloqueante y reintentar en el siguiente chequeo; nunca MUST mostrar la pantalla bloqueante por ese error.

#### Scenario: Sin red durante la descarga
- **WHEN** se corta la red a mitad de la descarga
- **THEN** el poller reanuda y el aviso indica que se reintentará más tarde
