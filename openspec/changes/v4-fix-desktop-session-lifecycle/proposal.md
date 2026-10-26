# Proposal

## Why

El proceso main del desktop v4 recibe el ID token de Cognito solo al iniciar sesión o al arrancar y nunca lo renueva: a la hora (vida típica del token) el poller, el respaldo de sesión de WhatsApp, la persistencia de mensajes y los reportes al CRM empiezan a recibir 401 y fallan en silencio; "Mi asignación" se vacía sin aviso y el agente cree que no tiene contactos. Además, el heartbeat anuncia "activo" a un agente cuyo WhatsApp está atascado en QR (así recibe contactos repartidos que no puede enviar), y la actualización "obligatoria" se puede saltar con "Continuar sin actualizar" ante cualquier error, registra listeners duplicados si el renderer se recarga y puede cortar un envío a la mitad. Estos tres puntos determinan si un agente realmente trabaja con la versión y la sesión correctas, por lo que conviene arreglarlos antes de comparar v4 con v3.

## What Changes

- **Renovación del ID token**: el renderer renueva la sesión de Amplify antes de que expire el ID token y lo re-entrega al main; el main, antes de cada llamada, pide un token nuevo si al actual le quedan menos de 2 minutos, y ante un 401 pide uno y reintenta una vez.
- **Sesión expirada visible**: si la renovación falla (refresh token vencido o revocado), la app vuelve al login con "Tu sesión expiró. Vuelve a iniciar sesión.", el main detiene el poller y conserva la sesión local de WhatsApp para el mismo operador.
- **Poller**: un 401 ya no se publica como asignación vacía; se conserva la última asignación y se dispara la renovación.
- **Heartbeat**: solo se envía con WhatsApp en estado `connected`.
- **Actualización obligatoria de verdad**: se retira "Continuar sin actualizar" del build instalado; ante error, la pantalla ofrece "Reintentar" y reintenta sola cada 60 s. El feed ausente (404) sigue sin bloquear. La única salida sin actualizar es un **acceso de emergencia de Sistemas** con contraseña maestra (hash scrypt inyectado al compilar, 5 intentos y bloqueo de 15 min, solo esa sesión, banner persistente y registro del uso).
- **Updater idempotente**: listeners e intervalo se registran una sola vez por proceso aunque el renderer pida el chequeo varias veces.
- **Instalación diferida**: si la descarga termina a media campaña, el main no inicia jobs nuevos y espera a que termine el job en curso (máximo 3 minutos) antes de instalar.
- Release del desktop por el feed S3.
- **BREAKING** (operativo): sin red o con el feed caído (no 404) el agente no puede entrar a la app hasta que el chequeo funcione o Sistemas use el acceso de emergencia.

Fuera de alcance: mover el almacenamiento de tokens de Amplify fuera de `localStorage` (se revisa con `v4-harden-desktop-shell`), MFA/recuperación de contraseña.

## Capabilities

### New Capabilities

_Ninguna._

### Modified Capabilities

- `v4/desktop-auth`: el token del main se renueva; se agregan la solicitud de token desde el main y la sesión expirada.
- `v4/job-processing`: el poller no confunde un 401 con "sin asignación".
- `v4/desktop-shell`: el heartbeat exige WhatsApp conectado.
- `v4/desktop-update`: sin salida "Continuar sin actualizar"; registro único del updater; instalación diferida tras el job en curso.

## Impact

- Código desktop: `electron/main.ts` (token, heartbeat, IPC nuevo), `electron/preload.ts` (`onTokenRequest`, `provideToken`), `electron/backend.ts` y `electron/jobs/poller.ts` (fetch con renovación y reintento), nuevo `electron/auth/tokenBroker.ts` (módulo puro), `electron/updater.ts`, `src/lib/auth.ts`, `src/App.tsx`, `src/routes/UpdateGate.tsx`, `src/types/ana.d.ts`.
- Backend: sin cambios.
- Pruebas: vitest en `v4/desktop` para módulos puros (`tokenBroker`, decisión de heartbeat, estado del updater).
- Distribución: release del desktop (electron-builder → `s3://ana-desktop-updates/updates`). Las versiones instaladas ya se actualizan solas; las nuevas ya no dejan saltar la actualización.
