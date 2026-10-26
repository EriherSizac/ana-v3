# Spec Delta

## REMOVED Requirements

### Requirement: Protección con llave de administración
**Reason**: Las rutas `/credentials/*` se retiran junto con la palabra del día; la identidad del agente la da Cognito y la pertenencia a campañas el roster (`v3/agent-roster`).
**Migration**: Los agentes se derivan de los roles del User Pool (`add-agent-roster-management`); los supervisores solo deshabilitan excepciones desde ANA Admin. Las rutas se mantienen durante la transición y se eliminan de `serverless.yml` al final del despliegue (API Gateway responde 404).

### Requirement: Ubicación del CSV de credenciales
**Reason**: `agents/{campaign}/credentials.csv` deja de leerse y escribirse.
**Migration**: Tras retirar las rutas, extraer solo los usernames a `legacy/agents/{campaign}.json` (referencia del historial legado, no insumo del roster), archivar cada `credentials.csv` en `ana-legacy-archive-prod` verificando el conteo y borrarlo del bucket de producción.

### Requirement: Consulta de credenciales
**Reason**: Se retira `GET /credentials/{campaign}`.
**Migration**: Consultar los agentes de una campaña en ANA Admin o con `GET /admin/campaigns/{campaign}/roster` (`v3/agent-roster`).

### Requirement: Carga de credenciales
**Reason**: Se retira `POST /credentials/upload`.
**Migration**: Dar de alta agentes en el User Pool con un rol de la campaña que otorgue `ana:campaign:message:send`.

### Requirement: Regeneración de palabras del día
**Reason**: La palabra del día se elimina; no hay frases que rotar.
**Migration**: Para cortar el acceso de un agente, deshabilitarlo en ANA Admin, quitarle el rol o deshabilitar su usuario / revocar sus sesiones en Cognito.
