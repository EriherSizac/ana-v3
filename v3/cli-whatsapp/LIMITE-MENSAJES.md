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

### 2. Actualización de Contactos Pendientes y reanudación local
El servidor entrega cada asignación una sola vez (`GET /get/chats` la borra al entregarla), así que el progreso se protege en dos lugares:

1. **Registro local** (`%APPDATA%\ANA\assignment-journal-<agente>-<campaña>.json`): al recibir la asignación, antes del primer envío, el CLI guarda el CSV recibido y el estado de cada contacto (`pending`, `in_flight`, `done`, `por_revisar`). Marca `in_flight` antes de abrir el chat y `done` al obtener el resultado; cada escritura es atómica.
2. **Reporte tras cada contacto**: después de cada contacto procesado el CLI envía a `POST /contacts/pending` las filas originales de los contactos que faltan, en su orden. Así `chats/{agent_id}-{campaign}.csv` en S3 refleja los pendientes reales (sirve para recuperarlos si se pierde el equipo). Al terminar la asignación envía `contacts: []` y borra el registro local.

**Si el CLI se cierra a mitad de ciclo** (Ctrl+C, cierre de ventana, reinicio, autoupdate):
- Al volver a abrirlo, antes de consultar el servidor, reanuda la asignación registrada para el mismo agente y campaña y envía **solo los contactos pendientes**; los ya procesados no reciben un segundo mensaje.
- Un contacto que quedó `in_flight` (cierre justo durante el envío) **no se reenvía**: queda `por_revisar`, aparece en `resultados.csv` con `status: por_revisar` y se reporta al backend en el campo `review` para que el supervisor confirme en WhatsApp si el mensaje salió.
- Un registro de otro agente o campaña se conserva sin procesarse (se lista en consola al arrancar). Un registro ilegible se renombra a `*.invalid-<fecha>.json` y no se envía nada de él.
- La deduplicación es solo dentro de una asignación: una asignación nueva con los mismos deudores se envía completa.

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

Actualiza el archivo CSV con los contactos pendientes (filas originales de la asignación). El campo `review` es opcional: solo se envía si hay contactos por revisar y se guarda en `review/{campaign}/{agent_id}/{assignment_id}.csv`.

**Request Body:**
```json
{
  "campaign": "campana-ventas-2024",
  "agent_id": "agente-001",
  "contacts": [
    {
      "contact_phone": "5215512345678",
      "contact_name": "Juan Pérez",
      "message": "Hola {{name}}"
    }
  ],
  "review": {
    "assignment_id": "20261026T1530-ab12cd34",
    "contacts": [
      { "contact_phone": "5215598765432", "contact_name": "Ana López", "message": "Hola {{name}}" }
    ]
  }
}
```

**Response:**
```json
{
  "message": "Contactos pendientes actualizados",
  "path": "chats/agente-001-campana-ventas-2024.csv",
  "remainingContacts": 1,
  "reviewContacts": 1
}
```

Los supervisores consultan los contactos por revisar con `GET /supervisors/review/{campaign}` (cabecera `X-Admin-Key`).

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
- Al reiniciar, los contactos pendientes se retoman del registro local del equipo (no del servidor, que ya entregó la asignación)
- El sistema funciona tanto con contactos del servidor como del archivo local
