# ana

App de envío y gestión de WhatsApp para cobranza (Pernexium). Arquitectura
híbrida: cliente de escritorio que corre `whatsapp-web.js` local + backend
serverless en AWS para datos y orquestación.

> Diseño y decisiones completas en [ARCHITECTURE.md](./ARCHITECTURE.md).
> Auth: [sso-cognito-cookie-storage.md](./sso-cognito-cookie-storage.md) ·
> UI: [design-system.md](./design-system.md).

## Estructura

```
backend/    Serverless (Lambda + DynamoDB + S3). API, jobs, trigger de CSV.
desktop/    Electron + Vite + React. whatsapp-web.js + UI del operador.
```

## Por qué híbrido

`whatsapp-web.js` necesita un Chromium con sesión persistente 24/7 → no corre en
Lambda. Vive en la PC del operador (Electron). El backend serverless solo guarda
datos (DynamoDB), recibe CSVs (S3) y reparte jobs de envío por operador; nunca
toca WhatsApp.

## Backend

Serverless **v4** (compila TypeScript nativo) + `serverless-prune-plugin`.

```bash
cd backend
npm install
serverless login            # v4 requiere cuenta (free) o SERVERLESS_ACCESS_KEY
cp .env.example .env        # pon ROLES_API_KEY (secreto, gitignored)
# despliega contra el User Pool de Pernexium (región us-east-2)
serverless deploy --stage prod \
  --param="issuer=https://cognito-idp.us-east-2.amazonaws.com/<POOL_ID>" \
  --param="clientId=<APP_CLIENT_ID>" \
  --param="permissionsEnforced=false"   # enciéndelo cuando valides permisos
```

El secreto `ROLES_API_KEY` va en `backend/.env` (serverless v4 lo carga solo);
los demás params (issuer/clientId, no secretos) en la línea de deploy.

Tablas (todas aisladas por `operatorId` salvo roleperms/agents/cache):
`conversations`, `messages`, `jobs`, `roleperms`, `agents`, `accesscache`.
Buckets: `csv`, `media`. Endpoints en [STRUCTURE.md](./STRUCTURE.md).

## Desktop

```bash
cd desktop
npm install
cp .env.example .env   # completa Cognito + API base
npm run electron:dev   # Vite + Electron en caliente
npm run dist           # instalador (electron-builder)
```

## Instalación masiva + auto-update

Instalador NSIS **oneClick** (sin wizard) + `electron-updater` con feed en S3.

### Bucket de updates (una vez)
```bash
aws s3 mb s3://ana-desktop-updates --region us-east-2 --profile pernexium
# los clientes deben poder LEER updates/* (public-read o CloudFront):
aws s3api put-bucket-policy --bucket ana-desktop-updates --profile pernexium --policy '{
  "Version":"2012-10-17",
  "Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject",
    "Resource":"arn:aws:s3:::ana-desktop-updates/updates/*"}]
}'
```

### Publicar una versión
```bash
cd desktop
# 1. sube la versión en package.json (ej 1.0.0 → 1.0.1)
npm run publish   # build + electron-builder --win --publish always (sube .exe + latest.yml a S3)
```

### Comportamiento en el cliente
- **Instalación**: el `.exe` oneClick instala solo (sin "siguiente, siguiente"), crea accesos y abre la app.
- **Update obligatorio**: al abrir, la app revisa S3. Si hay versión nueva → pantalla **bloqueante** mientras descarga; luego reinstala y reinicia. No se puede usar hasta estar al día. Sin red → permite continuar tras aviso (si no, quedaría inservible offline).
- Mass deploy: distribuye el primer `.exe` por GPO/Intune/script; las siguientes versiones llegan solas.

> Para evitar SmartScreen en Windows conviene **firmar** el `.exe` (cert code-signing). Funciona sin firmar, con advertencia la primera vez.

## Flujo de envío masivo

1. En **Campañas**: subes el CSV de contactos + plantilla `{columna}`.
2. El CSV va a S3 → `csvTrigger` genera los jobs en DynamoDB (de tu operador).
3. El proceso main pollea sus jobs, normaliza teléfonos y envía con WhatsApp.
4. Resultados y mensajes se persisten en DynamoDB y se ven en **Chats**
   (números enmascarados en la UI).
