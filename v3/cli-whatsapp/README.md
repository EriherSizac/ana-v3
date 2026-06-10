# 📱 WhatsApp CLI Mass Sender v2.0

Sistema de línea de comandos para envío masivo de mensajes por WhatsApp con **sistema de dos ventanas**: una para automatización y otra para respuestas manuales.

## 🚀 Instalación

```bash
# 1. Entrar a la carpeta
cd cli-whatsapp

# 2. Instalar dependencias
npm install

# 3. Instalar navegador de Playwright
npx playwright install chromium
```

## 📋 Archivos Necesarios

### 1. `contactos.csv` - Lista de contactos

Formato del CSV:
```csv
contact_pho,first_name,last_name,credit,discount,total_balanc,product
5215532009317,Juan,Pérez,5000,10%,1500,Laptop HP
5491123456789,María,García,3000,15%,2500,iPhone 15
```

**Campos soportados:**
- `contact_pho` / `phone` / `telefono` - Número con código de país
- `first_name` / `nombre_pila` - Nombre
- `last_name` / `apellido` - Apellido
- `name` / `nombre` - Nombre completo
- `credit` / `credito` - Crédito
- `discount` / `descuento` - Descuento
- `total_balanc` / `balance` / `saldo` - Balance
- `product` / `producto` - Producto

### 2. `mensaje.txt` - Plantilla del mensaje

Ejemplo:
```
Hola {{first_name}},

Tu saldo es ${{total_balanc}}
Crédito disponible: ${{credit}}
Descuento: {{discount}}

¿Necesitas ayuda?
```

**Variables disponibles:**
- `{{phone}}` - Teléfono
- `{{name}}` - Nombre completo
- `{{first_name}}` - Nombre
- `{{last_name}}` - Apellido
- `{{credit}}` - Crédito
- `{{discount}}` - Descuento
- `{{total_balanc}}` - Balance
- `{{product}}` - Producto

## ▶️ Uso

```bash
npm start
```

## 🪟 Sistema de Dos Ventanas

El sistema ahora abre **DOS ventanas de WhatsApp** simultáneamente:

### 🤖 Ventana de Automatización
- **Propósito**: Envío masivo automatizado
- **Sesión**: `whatsapp-session/` (tu cuenta principal)
- **Características**:
  - Overlay de protección (no se puede interactuar)
  - Envío automático de mensajes
  - Captura de respuestas
  - Se cierra automáticamente al terminar

### 💬 Ventana Manual
- **Propósito**: Responder mensajes manualmente
- **Sesión**: `whatsapp-session-manual/` (segunda cuenta/teléfono)
- **Características**:
  - ✅ Puedes interactuar libremente
  - ❌ Botones de llamada/videollamada ocultos
  - ❌ Botón de audio/grabación oculto
  - ❌ No puedes iniciar chats nuevos
  - ✅ Solo responder a contactos existentes
  - Permanece abierta hasta que presiones Ctrl+C

### Flujo del Programa:

1. **Carga archivos**
   - Lee `contactos.csv`
   - Lee `mensaje.txt`

2. **Abre ventanas según configuración**
   - **Si hay contactos**: Abre ventana de automatización
   - **Si `enableManualWindow: true`**: Abre ventana manual
   - **Si NO hay contactos**: Solo abre ventana manual

3. **Ventana de Automatización** (si hay contactos)
   - Escanea QR con tu teléfono principal
   - Se activa overlay de protección
   - Envía mensajes automáticamente
   - Guarda resultados y respuestas
   - Se cierra al terminar

4. **Ventana Manual** (si está habilitada)
   - Escanea QR con OTRO teléfono/cuenta
   - Muestra indicador "Modo Manual"
   - Restricciones UI aplicadas
   - Permanece abierta para responder

5. **Guarda resultados** (solo automatización)
   - `resultados.csv` - Todos los contactos con estado de envío
   - `respuestas.csv` - Solo los que respondieron

## 📊 Archivos de Salida

### `resultados.csv`
Contiene todos los contactos procesados:
```csv
phone,name,status,error,sent_at,response
5215532009317,Juan Pérez,sent,,2024-12-04T01:00:00.000Z,Gracias por la info
5491123456789,María García,error,Número inválido,2024-12-04T01:00:05.000Z,
```

**Campos:**
- `status`: `sent` (enviado) o `error` (falló)
- `error`: Descripción del error si falló
- `sent_at`: Fecha y hora de envío
- `response`: Respuesta del contacto (si hubo)

### `respuestas.csv`
Solo contactos que respondieron:
```csv
phone,name,sent_at,response
5215532009317,Juan Pérez,2024-12-04T01:00:00.000Z,Gracias por la info
```

## ⚙️ Configuración

Puedes modificar estos valores en `config.js`:

```javascript
const CONFIG = {
  inputCsv: 'contactos.csv',                    // Archivo de entrada
  outputCsv: 'resultados.csv',                  // Resultados completos
  responsesCsv: 'respuestas.csv',               // Solo respuestas
  sessionPath: 'whatsapp-session',              // Sesión automatización
  manualSessionPath: 'whatsapp-session-manual', // Sesión manual
  delayBetweenMessages: 5000,                   // 5 segundos entre mensajes
  waitForResponse: 10000,                       // 10 segundos esperando respuesta
  useClipboardMedia: false,                     // Pegar media desde portapapeles
  showOverlay: true,                            // 🛡️ Overlay en automatización
  enableManualWindow: true,                     // 🔓 Abrir ventana manual
};
```

### Opciones importantes:

- **`enableManualWindow`**: Si es `true`, abre la ventana manual. Si es `false`, solo automatización.
- **`manualSessionPath`**: Carpeta de sesión separada para la ventana manual (requiere otro teléfono/cuenta)

### 🛡️ Overlay de Protección

El overlay de protección es una capa visual que cubre la ventana de WhatsApp durante la automatización para:

- **Bloquear interacción** del usuario con la ventana automatizada
- **Indicar visualmente** que la ventana está siendo automatizada
- **Prevenir clics accidentales** que interrumpan el proceso

**Características:**
- Se activa automáticamente después de conectar WhatsApp
- No bloquea el escaneo del código QR (se activa después)
- Es semi-transparente para ver el progreso
- Bloquea completamente la interacción (`pointer-events: auto`)
- Persiste durante toda la automatización (se recrea cada segundo)
- Se puede desactivar poniendo `showOverlay: false` en la configuración

## 🎯 Casos de Uso

### Caso 1: Envío masivo + Respuestas manuales
**Escenario**: Tienes 100 contactos para enviar mensajes automáticos, pero quieres responder personalmente.

**Configuración**:
```javascript
enableManualWindow: true  // Activar ventana manual
```

**Resultado**:
- Ventana 1 (Automatización): Envía 100 mensajes automáticamente
- Ventana 2 (Manual): Puedes responder a los que contesten

### Caso 2: Solo respuestas manuales
**Escenario**: No tienes contactos.csv o está vacío, solo quieres responder mensajes.

**Configuración**:
```javascript
enableManualWindow: true  // Activar ventana manual
```

**Resultado**:
- Solo se abre la ventana manual
- Puedes responder libremente sin automatización

### Caso 3: Solo automatización
**Escenario**: Solo quieres envío masivo sin ventana manual.

**Configuración**:
```javascript
enableManualWindow: false  // Desactivar ventana manual
```

**Resultado**:
- Solo se abre la ventana de automatización
- Se cierra al terminar

## 📝 Ejemplo Completo

### 1. Preparar archivos

**contactos.csv:**
```csv
contact_pho,first_name,last_name,credit,discount,total_balanc,product
5215512345678,Ana,Martínez,2000,15%,850,Tablet Samsung
5215587654321,Pedro,Ramírez,5000,20%,1200,Smart TV LG
```

**mensaje.txt:**
```
Hola {{first_name}},

Tu balance es ${{total_balanc}}
Tienes ${{credit}} de crédito disponible
Descuento especial: {{discount}}

Producto destacado: {{product}}

¿Te interesa?
```

### 2. Ejecutar

```bash
npm start
```

### 3. Salida en terminal

```
╔════════════════════════════════════════╗
║   WhatsApp CLI Mass Sender v2.0       ║
║      Sistema de Dos Ventanas          ║
╚════════════════════════════════════════╝

📊 Contactos para automatización: 2
🔓 Ventana manual: ACTIVADA

📝 Plantilla de mensaje cargada
─────────────────────────────────────
Hola {{first_name}}, ...
─────────────────────────────────────

🤖 Iniciando WhatsApp Web (Automatización)...
📱 Si ves un código QR, escanéalo con tu teléfono
✅ WhatsApp Web (Automatización) conectado!
🛡️  Activando overlay de protección...
✅ Overlay activado - La ventana está protegida

[1/2] Procesando: Ana Martínez
📤 Enviando a Ana Martínez (5215512345678)...
✅ Mensaje enviado a Ana Martínez
⏳ Esperando respuesta (10s)...
💬 Respuesta recibida: "Sí, me interesa"

⏳ Esperando 5s antes del siguiente mensaje...

[2/2] Procesando: Pedro Ramírez
📤 Enviando a Pedro Ramírez (5215587654321)...
✅ Mensaje enviado a Pedro Ramírez
⏳ Esperando respuesta (10s)...
ℹ️  No se detectó respuesta

💾 Resultados guardados en: resultados.csv
💬 1 respuestas guardadas en: respuestas.csv

╔════════════════════════════════════════╗
║           RESUMEN FINAL                ║
╚════════════════════════════════════════╝
✅ Enviados exitosamente: 2
❌ Errores: 0
💬 Respuestas recibidas: 1
📊 Total procesados: 2

✨ Proceso de automatización completado!

═══════════════════════════════════════
🔓 Abriendo ventana manual para respuestas...
═══════════════════════════════════════

🔓 Iniciando ventana manual de WhatsApp...
⏳ Esperando a que WhatsApp Web (Manual) cargue...
📱 Escanea el código QR con OTRO teléfono/cuenta
✅ WhatsApp Web (Manual) conectado!
🔒 Restricciones aplicadas a la ventana manual

💬 Ventana manual lista para responder
⚠️  Esta ventana permanecerá abierta
   Presiona Ctrl+C para cerrar el programa
```

## ⚠️ Notas Importantes

### Sistema de Dos Ventanas
1. **Dos cuentas necesarias:** Necesitas DOS teléfonos/cuentas de WhatsApp para usar ambas ventanas
2. **Sesiones separadas:**
   - `whatsapp-session/` → Cuenta principal (automatización)
   - `whatsapp-session-manual/` → Segunda cuenta (manual)
3. **Primera vez:** Escanea QR en cada ventana con su respectivo teléfono
4. **Ventana manual:** Puedes desactivarla con `enableManualWindow: false`

### General
5. **Formato de números:** Incluye código de país sin `+` (ej: 521234567890)
6. **Retraso:** Usa mínimo 5 segundos entre mensajes para evitar bloqueos
7. **Respuestas:** Por defecto `waitForResponse: 0` (no espera). Cambia a 10000+ si quieres capturar respuestas
8. **Overlay:** El overlay bloquea completamente la interacción con la ventana de automatización

## 🐛 Solución de Problemas

### Error: "No se encontró el archivo contactos.csv"
```bash
# Verifica que el archivo existe
ls contactos.csv

# Debe estar en la misma carpeta que index.js
```

### Error: "No se encontró el archivo mensaje.txt"
```bash
# Crea el archivo
echo "Hola {{name}}" > mensaje.txt
```

### La ventana se cierra sola
- No cierres la ventana de Chromium manualmente
- Espera a que el programa termine

### No detecta respuestas
- Aumenta `waitForResponse` en la configuración
- Algunas respuestas pueden no detectarse si llegan muy tarde

## 📁 Estructura de Archivos

```
cli-whatsapp/
├── index.js              # Programa principal
├── package.json          # Dependencias
├── contactos.csv         # Tus contactos (EDITABLE)
├── mensaje.txt           # Tu mensaje (EDITABLE)
├── resultados.csv        # Resultados (GENERADO)
├── respuestas.csv        # Respuestas (GENERADO)
├── whatsapp-session/     # Sesión guardada (AUTO)
└── README.md             # Esta guía
```

## 🎯 Ventajas de la Versión CLI

✅ **Simple** - Un solo comando para ejecutar
✅ **Directo** - Sin servidor web, sin API
✅ **Persistente** - Sesión guardada automáticamente
✅ **Completo** - Captura respuestas automáticamente
✅ **Organizado** - Resultados en CSV separados
✅ **Robusto** - Manejo de errores por contacto

## 🚀 Siguiente Paso

```bash
cd cli-whatsapp
npm install
npm start
```

¡Listo para enviar mensajes! 🎉
