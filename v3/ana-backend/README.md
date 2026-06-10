## **Mapa de Endpoints**

Base URL: **`https://ow24p7ablb.execute-api.us-east-1.amazonaws.com`**

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