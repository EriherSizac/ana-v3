# Spec Delta

## REMOVED Requirements

### Requirement: Protección con llave de administración
**Reason**: Las rutas `/credentials/*` se retiran junto con la palabra del día; la identidad del agente la da Cognito y la pertenencia a campañas el roster (`v3/agent-roster`).
**Migration**: Los supervisores administran agentes en el roster desde la web de administración (`add-agent-roster-management`) y los usuarios en el User Pool. Las rutas se mantienen durante la transición y se eliminan de `serverless.yml` al final del despliegue (API Gateway responde 404).

### Requirement: Ubicación del CSV de credenciales
**Reason**: `agents/{campaign}/credentials.csv` deja de leerse y escribirse.
**Migration**: Tras retirar las rutas, borrar los `credentials.csv` del bucket de producción (los usuarios listados sirven antes como insumo para poblar el roster).

### Requirement: Consulta de credenciales
**Reason**: Se retira `GET /credentials/{campaign}`.
**Migration**: Consultar los agentes habilitados de una campaña en el roster (`v3/agent-roster`).

### Requirement: Carga de credenciales
**Reason**: Se retira `POST /credentials/upload`.
**Migration**: Dar de alta agentes en el User Pool y habilitarlos en el roster de la campaña.

### Requirement: Regeneración de palabras del día
**Reason**: La palabra del día se elimina; no hay frases que rotar.
**Migration**: Para cortar el acceso de un agente, deshabilitarlo en el roster o deshabilitar su usuario / revocar sus sesiones en Cognito.
