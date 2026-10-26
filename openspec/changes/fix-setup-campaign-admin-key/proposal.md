# Proposal

## Why

Desde el commit 9a36660 las rutas de credenciales y la carga de contactos exigen `X-Admin-Key`, pero `v3/ana-backend/setup-campaign.sh` no envía ese header: sus `curl` reciben 401 (o 503 si el servidor no tiene llave) y, como el script no revisa el código HTTP, termina imprimiendo "Configuración completa!" sin haber creado nada. La copia del script dentro de `README-SUPERVISORES.md` tiene el mismo problema.

## What Changes

- `setup-campaign.sh` lee `ADMIN_API_KEY` del entorno y aborta antes de cualquier llamada (código de salida distinto de 0 y mensaje claro) si no está definida o está vacía.
- Todas las llamadas del script (`POST /credentials/upload`, `POST /supervisors/agents/{agent}/{campaign}/contacts`, `GET /credentials/{campaign}`, `GET /supervisors/agents/{agent}/{campaign}/contacts`) envían `X-Admin-Key: $ADMIN_API_KEY`; las dos consultas `GET` también, porque son rutas de supervisor (y la segunda pasa a exigir la llave con `secure-assignment-consumption`).
- El script falla en el primer error HTTP (`set -euo pipefail` y `curl --fail-with-body`), en lugar de reportar éxito.
- `README-SUPERVISORES.md` (incluida la copia embebida del script y la sección "Cómo ejecutar el script"), `README.md` y `SUPERVISORES.md` de `v3/ana-backend` documentan cómo exportar `ADMIN_API_KEY` y agregan el header a los ejemplos `curl` que hoy no lo traen.

Sin cambios de comportamiento del backend ni del CLI: es herramienta interna y documentación, por lo que el cambio declara `skip_specs: true`.

Fuera de alcance: las palabras del día fijas y adivinables que el script sube (`sol-brillante-2024`, etc.) y los CSV que deja en el directorio actual; se señalan en el README como datos de demostración que no deben usarse en una campaña real (recomendación: ejecutar `POST /credentials/regenerate` después).

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

_Ninguna_ (sin cambios de requisitos; `skip_specs: true`).

## Impact

- Archivos: `v3/ana-backend/setup-campaign.sh`, `v3/ana-backend/README-SUPERVISORES.md`, `v3/ana-backend/README.md`, `v3/ana-backend/SUPERVISORES.md`.
- Usuarios: supervisores/operadores que ejecutan el script deben tener la llave de administración en su entorno.
- Sin despliegue: no cambia Lambda, `serverless.yml` ni el CLI.
