# Tasks

## 1. Script `setup-campaign.sh`

- [x] 1.1 Agregar `set -euo pipefail` y, antes de cualquier `curl`, abortar con `exit 1` y el mensaje "ADMIN_API_KEY no definida: exporta la llave de administración antes de ejecutar" si `${ADMIN_API_KEY:-}` está vacía; verificar con `ADMIN_API_KEY= bash v3/ana-backend/setup-campaign.sh; echo $?` que imprime el mensaje, sale con 1 y no crea `credenciales-prueba.csv`
- [x] 1.2 Permitir sobrescribir la URL con `BASE_URL="${BASE_URL:-https://ow24p7ablb.execute-api.us-east-1.amazonaws.com}"` (mismo valor por defecto) para poder probar contra dev; verificar con `bash -n v3/ana-backend/setup-campaign.sh` y, si está disponible, `shellcheck` sin errores (shellcheck no instalado: solo `bash -n`)
- [x] 1.3 Agregar `-H "X-Admin-Key: ${ADMIN_API_KEY}"` y `-sS --fail-with-body` a los cuatro `curl` (upload de credenciales, upload de contactos, `GET /credentials/{campaign}`, `GET /supervisors/agents/{agent}/{campaign}/contacts`); verificar contra el stage dev (`BASE_URL=https://ana-dev.pernexium.com.mx`; verificado con servidor local simulado porque el stage dev de v3 no existe) que con una llave incorrecta el script se detiene en el Paso 1 con código distinto de 0 y sin imprimir "Configuración completa!", y que con la llave correcta termina con 0 y los dos `GET` devuelven el CSV

## 2. Documentación

- [x] 2.1 En `v3/ana-backend/README-SUPERVISORES.md`, actualizar la copia embebida del script para que coincida exactamente con `setup-campaign.sh`, y la sección "Cómo ejecutar el script" con `export ADMIN_API_KEY=...` (o `set -a; source .env; set +a`) y `BASE_URL` opcional; agregar la advertencia de que las palabras del día del script son de demostración y deben regenerarse con `POST /credentials/regenerate` en campañas reales; verificar con `diff` entre el bloque del README y el script que no hay diferencias
- [x] 2.2 En `v3/ana-backend/SUPERVISORES.md` y en los ejemplos de `README-SUPERVISORES.md`, agregar `-H "X-Admin-Key: $ADMIN_API_KEY"` a cada `curl` de rutas de supervisor/credenciales que no lo tenga; verificar con `grep -n "curl" v3/ana-backend/SUPERVISORES.md v3/ana-backend/README-SUPERVISORES.md` que cada ejemplo de esas rutas incluye el header
- [x] 2.3 En `v3/ana-backend/README.md`, agregar una sección breve "Autenticación de supervisor" que indique qué rutas exigen `X-Admin-Key`, de dónde sale (`ADMIN_API_KEY` del `.env` de despliegue) y cómo ejecutar `setup-campaign.sh`; verificar que el comando documentado coincide con la sección del README de supervisores
