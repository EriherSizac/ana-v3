# Spec Delta

## Purpose

Avisar en segundos a los clientes conectados al canal realtime que hay una versión publicada.

## ADDED Requirements

### Requirement: Evento release.available
El canal realtime SHALL aceptar el tipo `release.available` con `ref.scope` igual a `cli` o `desktop` y MUST entregarlo a todas las conexiones de ese tipo de cliente (no a usuarios ni campañas). El sobre no trae versión ni URL: el cliente lee su manifiesto. Un `scope` distinto se rechaza como inválido. Los clientes que no conocen el tipo lo ignoran.

#### Scenario: Release del CLI
- **WHEN** se emite `release.available` con `scope = cli`
- **THEN** lo reciben todas las conexiones `client=cli` y ninguna `desktop` ni `admin`

### Requirement: Origen del aviso del CLI
El puente S3 de v3 SHALL reenviar la creación de `versions/latest.json` del bucket de v3 y traducirla a `release.available` con `scope = cli`. Otras llaves de `versions/` y los borrados MUST ignorarse.

#### Scenario: Publicación del CLI
- **WHEN** `upload-to-s3.py` sube `versions/latest.json`
- **THEN** los CLIs conectados reciben `release.available`

### Requirement: Origen del aviso del desktop
Una regla del bus por defecto de us-east-2 SHALL enviar a `notify` la creación de `updates/latest.yml` del bucket `ana-desktop-updates`, que la traduce a `release.available` con `scope = desktop`. El bucket MUST tener habilitadas las notificaciones a EventBridge.

#### Scenario: Publicación del desktop
- **WHEN** `npm run publish` sube `updates/latest.yml`
- **THEN** las apps de escritorio conectadas reciben `release.available`
