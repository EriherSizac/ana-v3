# Sistema de Historial de Mensajes

## Descripción

El sistema permite ver el historial de mensajes enviados a un contacto desde la ventana manual de WhatsApp. Busca automáticamente en los backups de los últimos 4 días.

## Características

### 🔍 Búsqueda Inteligente
- Busca backups desde **hoy hasta 4 días atrás**
- Retorna el backup más reciente encontrado
- Muestra la fecha del backup utilizado

### 📱 Detección Automática
- Detecta automáticamente el número del contacto seleccionado
- Funciona con contactos guardados y números sin guardar
- Filtra mensajes por número de teléfono

### 💬 Visualización de Historial
- Muestra todos los mensajes enviados al contacto
- Incluye respuestas recibidas (si las hay)
- Indica el estado de cada mensaje (enviado/error)
- Muestra fecha y hora de cada mensaje

## Uso

### 1. Abrir Ventana Manual
```bash
node index.js
```

### 2. Ubicar el Botón
El botón **"📜 Ver Historial"** aparece en la **esquina inferior izquierda** de la ventana manual.

### 3. Ver Historial
1. Selecciona un chat en WhatsApp
2. Haz clic en **"📜 Ver Historial"**
3. El sistema:
   - Detecta el número del contacto
   - Busca en los backups (últimos 4 días)
   - Muestra una burbuja con el historial

### 4. Navegar el Historial
- **Scroll**: Desplázate por los mensajes
- **Cerrar**: Haz clic en la "×" o presiona `ESC`

## Interfaz de Usuario

### Botón de Historial
```
┌─────────────────────┐
│ 📜 Ver Historial    │  ← Esquina inferior izquierda
└─────────────────────┘
```

### Burbuja de Historial
```
╔═══════════════════════════════════════╗
║ 📜 Historial de Mensajes          × ║
║ Fecha: 2024-12-18 | Total: 3 mensajes║
╠═══════════════════════════════════════╣
║                                       ║
║  ┌─────────────────────────────────┐ ║
║  │ Juan Pérez        10:30 AM      │ ║
║  │ Hola, te envío la información   │ ║
║  │ ┌─────────────────────────────┐ │ ║
║  │ │ RESPUESTA:                  │ │ ║
║  │ │ Gracias, recibido           │ │ ║
║  │ └─────────────────────────────┘ │ ║
║  │ Estado: ✅ Enviado              │ ║
║  └─────────────────────────────────┘ ║
║                                       ║
╚═══════════════════════════════════════╝
```

## Backend Endpoint

### GET `/backups/latest/{agentId}/{campaign}`

Obtiene el backup más reciente de un agente/campaña.

**Parámetros:**
- `agentId`: ID del agente
- `campaign`: ID de la campaña

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "date": "2024-12-18",
  "daysBack": 0,
  "data": {
    "results": [
      {
        "phone": "+52 55 1234 5678",
        "name": "Juan Pérez",
        "message": "Hola, te envío la información",
        "response": "Gracias, recibido",
        "status": "sent",
        "timestamp": "2024-12-18T10:30:00Z"
      }
    ],
    "summary": {
      "sent": 10,
      "errors": 0,
      "withResponse": 5,
      "total": 10
    }
  }
}
```

**Sin Backup (404):**
```json
{
  "success": false,
  "message": "No se encontró backup para agente-001/campana-ventas-2024 en los últimos 4 días"
}
```

## Lógica de Búsqueda

### Prioridad de Búsqueda
1. **Hoy** (día 0)
2. **Ayer** (día -1)
3. **Hace 2 días** (día -2)
4. **Hace 3 días** (día -3)

### Estructura de Archivos en S3
```
backups/
  └── {campaign}/
      └── {YYYY-MM}/
          ├── {agentId}_01.json
          ├── {agentId}_02.json
          └── {agentId}_18.json  ← Backup del día 18
```

### Ejemplo de Búsqueda
Si hoy es **18 de diciembre de 2024**:

1. Busca: `backups/campana/2024-12/agente_18.json` ✅ **Encontrado**
2. Retorna el backup del día 18

Si no existe:
1. Busca día 18 ❌
2. Busca día 17 ❌
3. Busca día 16 ✅ **Encontrado**
4. Retorna el backup del día 16

## Notificaciones

El sistema muestra notificaciones para diferentes situaciones:

### ⚠️ Advertencia (Naranja)
```
⚠️ Selecciona un chat primero
```
Aparece cuando no hay un chat seleccionado.

### 📭 Información (Azul)
```
📭 No hay historial disponible (últimos 4 días)
```
Aparece cuando no se encuentra ningún backup.

```
📭 No hay historial para este contacto
```
Aparece cuando el backup existe pero no tiene mensajes para el contacto.

### ❌ Error (Rojo)
```
❌ Error al obtener historial
```
Aparece cuando hay un error en la comunicación con el servidor.

## Características Técnicas

### Detección de Número
El sistema intenta múltiples métodos para detectar el número:

1. **Título del header**: Si el título es un número
2. **Atributo title**: Busca elementos con números
3. **Span con "+"**: Busca spans que contengan "+"

### Filtrado de Mensajes
```javascript
// Limpia ambos números y compara
const cleanPhone = phoneNumber.replace(/\D/g, '');
const resultPhone = result.phone.replace(/\D/g, '');

// Busca coincidencias parciales (permite diferentes formatos)
return resultPhone.includes(cleanPhone) || 
       cleanPhone.includes(resultPhone);
```

### Formato de Mensajes
Cada mensaje muestra:
- **Nombre del contacto** (o número si no tiene nombre)
- **Hora del mensaje**
- **Contenido del mensaje**
- **Respuesta** (si la hay, con borde verde)
- **Estado** (✅ Enviado / ❌ Error)

## Estilos y Diseño

### Colores
- **Botón**: Gradiente morado (#667eea → #764ba2)
- **Mensajes enviados**: Fondo azul claro (#e7f3ff)
- **Mensajes con error**: Fondo gris (#f5f5f5)
- **Respuestas**: Borde verde WhatsApp (#25D366)

### Animaciones
- **Hover en botón**: Escala 1.05x + sombra más intensa
- **Notificaciones**: Slide in/out con fade

## Requisitos

1. **Backend desplegado** con el endpoint `/backups/latest/{agentId}/{campaign}`
2. **Configuración de agente** (campaign y agent_id)
3. **Backups existentes** en los últimos 4 días

## Solución de Problemas

### El botón no aparece
- Verifica que haya configuración de agente (`.agent-config.json`)
- Revisa la consola para errores

### No muestra historial
- Verifica que existan backups en S3
- Confirma que el formato del número sea correcto
- Revisa que el backup tenga la estructura correcta

### Error al cargar
- Verifica la URL del API en `agent-config.js`
- Confirma que el backend esté desplegado
- Revisa los permisos de S3

## Deploy del Backend

```bash
cd ana-backend
serverless deploy
```

El endpoint estará disponible en:
```
GET https://[tu-api-url]/backups/latest/{agentId}/{campaign}
```
