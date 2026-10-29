# Spec Delta

## Purpose

Que el manifiesto publicado permita verificar la integridad del instalador.

## ADDED Requirements

### Requirement: Integridad en el manifiesto
Al publicar, `upload-to-s3.py` SHALL regenerar `latest.json` con `version`, `url`, `sha256` (hex en minúsculas) y `size` (bytes) del instalador que sube, antes de subir el manifiesto y después del instalador. Los clientes MUST aceptar manifiestos sin `sha256` ni `size`, verificando entonces el tamaño contra `Content-Length`.

#### Scenario: Publicación de 1.0.51
- **WHEN** se publica el instalador `ANA-1.0.51.exe`
- **THEN** `versions/latest.json` trae `version: 1.0.51`, su `sha256` y su `size`

#### Scenario: latest.json local desactualizado
- **WHEN** `dist-portable/latest.json` trae otra versión o le falta el hash
- **THEN** se reescribe con los datos del instalador que se sube
