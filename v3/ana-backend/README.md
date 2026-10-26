## **Mapa de Endpoints**

Base URL: **`https://ow24p7ablb.execute-api.us-east-1.amazonaws.com`**

## **Autenticación de supervisor**

Las rutas de administración exigen el header `X-Admin-Key` con la llave `ADMIN_API_KEY`, definida en el `.env` de despliegue de `v3/ana-backend` (ver `.env.example`). Sin header o con llave incorrecta responden **401**; si el backend no tiene llave configurada responden **503**.

| **Método** | **Ruta** |
| --- | --- |
| **GET** | **`/credentials/{campaign}`** |
| **POST** | **`/credentials/upload`** |
| **POST** | **`/credentials/regenerate`** |
| **POST** | **`/supervisors/agents/{agent}/{campaign}/contacts`** |
| **POST** | **`/agents/{agent}/{campaign}/contacts`** (deprecated) |
| **POST** | **`/supervisors/files/download`** |
| **POST** | **`/templates`** |

Ejemplo:

```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY"   https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/prueba
```

Para configurar una campaña de prueba completa con `setup-campaign.sh`:

```bash
export ADMIN_API_KEY=...   # o: set -a; source .env; set +a
chmod +x setup-campaign.sh
./setup-campaign.sh
```

Detalle y opciones (`BASE_URL`) en [README-SUPERVISORES.md](README-SUPERVISORES.md#ejemplo-3-script-completo-de-configuración).

### **Contactos & Chats (flujo principal)**

| **Método** | **Ruta** | **Handler** | **S3 Path** | **Descripción** |
| --- | --- | --- | --- | --- |
| **POST** | **`/supervisors/agents/{agent}/{campaign}/contacts`** | uploadAgentContacts | **`agents/{campaign}/`** + **`historic/`** | **Supervisor sube CSV** con mensaje. El CLI lo consume desde aquí |
| **GET** | **`/get/chats/{agentId}/{campaignId}`** | getChats | Lee y **borra** de **`agents/{campaign}/`** | **CLI descarga contactos** (consume-once) |
| **POST** | **`/agents/{agent}/{campaign}/contacts`** | publishAgentContactsDeprecated | **`agents/{campaign}/`** | **Deprecated.** Sube CSV multipart al path legacy |

### **Supervisores - Consulta**

| **Método** | **Ruta** | **Handler** | **Descripción** |
| --- | --- | --- | --- |
| **GET** | **`/supervisors/agents/{agent}/{campaign}/contacts`** | getAgentContacts | Ver contactos subidos de un agente |
| **GET** | **`/supervisors/assignments/agents/{agent}/{campaign}`** | listAgentAssignments | Listar assignments de un agente |
| **GET** | **`/supervisors/assignments/agents/{agent}/{campaign}/contacts`** | getAgentAssignments | Ver contactos en assignments |
| **POST** | **`/supervisors/files/download`** | downloadFilesByKey | Descargar archivos por S3 key |

### **Backups**

| **Método** | **Ruta** | **Handler** | **Descripción** |
| --- | --- | --- | --- |
| **POST** | **`/backups`** | **`uploadBackup`** | Subir backup general |
| **GET** | **`/backups/latest/{agentId}/{campaign}`** | **`getLatestBackup`** | Último backup de un agente |
| **POST** | **`/backups/chat`** | **`saveChatBackup`** | Guardar backup de chat individual |
| **GET** | **`/backups/chat/{campaign}/{agentId}/{contactPhone}`** | **`getChatBackup`** | Obtener backup de un chat específico |
| **GET** | **`/backups/chats/{campaign}/{agentId}`** | **`listChatBackups`** | Listar todos los chats respaldados |

### **Otros**

| **Método** | **Ruta** | **Handler** | **Descripción** |
| --- | --- | --- | --- |
| **POST** | **`/contacts/pending`** | updatePendingContacts | Actualizar contactos pendientes |
| **POST** | **`/media`** | uploadMedia | Subir media |
| **POST** | **`/auth/verify`** | **`verifyCredentials`** | Verificar credenciales |
| **GET** | **`/credentials/{campaign}`** | **`getCampaignCredentials`** | Obtener credenciales de campaña |
| **POST** | **`/credentials/upload`** | **`uploadCampaignCredentials`** | Subir credenciales |
| **POST** | **`/credentials/regenerate`** | **`regenerateDailyPasswords`** | Regenerar passwords diarios |