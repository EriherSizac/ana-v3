# 📱 WhatsApp CLI Mass Sender

Sistema de línea de comandos para envío masivo de mensajes por WhatsApp con captura de respuestas.

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

### Flujo del Programa:

1. **Carga archivos**
   - Lee `contactos.csv`
   - Lee `mensaje.txt`

2. **Abre WhatsApp Web**
   - Se abre una ventana de Chromium
   - Si es primera vez, escanea el código QR
   - Si ya tienes sesión guardada, se conecta automáticamente

3. **Envía mensajes**
   - Procesa cada contacto uno por uno
   - Reemplaza las variables con los datos del contacto
   - Envía el mensaje
   - Espera 10 segundos por si hay respuesta
   - Espera 5 segundos antes del siguiente mensaje

4. **Guarda resultados**
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

Puedes modificar estos valores en `index.js`:

```javascript
const CONFIG = {
  inputCsv: 'contactos.csv',           // Archivo de entrada
  outputCsv: 'resultados.csv',         // Resultados completos
  responsesCsv: 'respuestas.csv',      // Solo respuestas
  sessionPath: 'whatsapp-session',     // Carpeta de sesión
  delayBetweenMessages: 5000,          // 5 segundos entre mensajes
  waitForResponse: 10000,              // 10 segundos esperando respuesta
};
```

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
║   WhatsApp CLI Mass Sender v1.0       ║
╚════════════════════════════════════════╝

📝 Plantilla de mensaje cargada
✅ 2 contactos cargados desde CSV
📊 Total de contactos: 2

🚀 Iniciando WhatsApp Web...
📱 Si ves un código QR, escanéalo con tu teléfono
✅ WhatsApp Web conectado!

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

✨ Proceso completado!
```

## ⚠️ Notas Importantes

1. **Primera vez:** Tendrás que escanear el código QR
2. **Sesión guardada:** La carpeta `whatsapp-session` guarda tu sesión
3. **No cierres la ventana:** Déjala abierta durante todo el proceso
4. **Formato de números:** Incluye código de país sin `+` (ej: 521234567890)
5. **Retraso:** Usa mínimo 5 segundos entre mensajes para evitar bloqueos
6. **Respuestas:** El sistema espera 10 segundos, ajusta si necesitas más tiempo

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
