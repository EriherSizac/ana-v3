# Sistema de Límite de Mensajes

## Descripción

El sistema ahora implementa un **límite de 45 mensajes por lote** con una **pausa automática de 2 horas** entre lotes. Esto ayuda a evitar bloqueos de WhatsApp por envío masivo.

## Funcionamiento

### 1. Envío por Lotes
- El sistema envía un **máximo de 45 mensajes** consecutivos
- Después de cada lote, si quedan contactos pendientes:
  - Los contactos restantes se envían al servidor
  - El sistema entra en pausa de 2 horas
  - Automáticamente reanuda el envío después de la pausa

### 2. Actualización de Contactos Pendientes
Cuando se alcanza el límite:
1. Los contactos no enviados se extraen de la lista
2. Se envían al endpoint `/contacts/pending` en el backend
3. El archivo CSV en S3 se actualiza con solo los contactos pendientes
4. El sistema puede retomar desde donde quedó

### 3. Timer de 2 Horas
- **Duración**: 2 horas (7,200,000 ms)
- **Comportamiento**: El programa permanece activo durante la pausa
- **Reanudación**: Automática después de las 2 horas
- **Hora de reanudación**: Se muestra en consola en formato local

## Ejemplo de Flujo

```
Contactos totales: 100

╔════════════════════════════════════════╗
║     LOTE 1: 45 mensajes                ║
╚════════════════════════════════════════╝

[1/100] Procesando: Juan Pérez
[2/100] Procesando: María García
...
[45/100] Procesando: Pedro López

╔════════════════════════════════════════╗
║   LÍMITE ALCANZADO: 45 mensajes        ║
╚════════════════════════════════════════╝
📊 Mensajes enviados: 45
📋 Contactos restantes: 55

☁️  Actualizando contactos pendientes en el servidor...
✅ Contactos pendientes guardados correctamente

╔════════════════════════════════════════╗
║        PAUSA DE 2 HORAS                ║
╚════════════════════════════════════════╝
⏰ Se reanudará a las: 18/12/2024 14:58:00
⏳ Esperando...

[Después de 2 horas...]

╔════════════════════════════════════════╗
║      REANUDANDO ENVÍO...               ║
╚════════════════════════════════════════╝

╔════════════════════════════════════════╗
║     LOTE 2: 45 mensajes                ║
╚════════════════════════════════════════╝

[46/100] Procesando: Ana Martínez
...
```

## Backend Endpoint

### POST `/contacts/pending`

Actualiza el archivo CSV con los contactos pendientes.

**Request Body:**
```json
{
  "campaign": "campana-ventas-2024",
  "agent_id": "agente-001",
  "contacts": [
    {
      "phone": "+52 55 1234 5678",
      "name": "Juan Pérez",
      "variable1": "valor1"
    }
  ]
}
```

**Response:**
```json
{
  "message": "Contactos pendientes actualizados",
  "path": "chats/agente-001-campana-ventas-2024.csv",
  "remainingContacts": 55
}
```

## Configuración

### Modificar el Límite de Mensajes
En `index.js`, línea 92:
```javascript
const MESSAGE_LIMIT = 45; // Cambiar a tu límite deseado
```

### Modificar la Duración de la Pausa
En `index.js`, línea 93:
```javascript
const PAUSE_DURATION = 2 * 60 * 60 * 1000; // 2 horas
// Para 1 hora: 1 * 60 * 60 * 1000
// Para 30 minutos: 30 * 60 * 1000
```

## Ventajas

✅ **Previene bloqueos**: WhatsApp no detecta envío masivo  
✅ **Reanudación automática**: No requiere intervención manual  
✅ **Persistencia**: Los contactos pendientes se guardan en el servidor  
✅ **Transparente**: Muestra progreso y tiempo de reanudación  
✅ **Seguro**: Detiene el proceso si falla la actualización de contactos

## Notas Importantes

- El programa **debe permanecer ejecutándose** durante la pausa de 2 horas
- Si cierras el programa durante la pausa, deberás reiniciarlo manualmente
- Los contactos pendientes se obtienen automáticamente del servidor al reiniciar
- El sistema funciona tanto con contactos del servidor como del archivo local
