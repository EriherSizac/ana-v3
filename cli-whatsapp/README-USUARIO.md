# 📱 WhatsApp Sender - Guía de Usuario

## 🎯 ¿Qué es esto?
Sistema automatizado para enviar mensajes masivos de WhatsApp con dos ventanas:
- **Ventana Automática**: Envía mensajes automáticamente
- **Ventana Manual**: Para responder a los contactos

## 🚀 Inicio Rápido

### 1. Primera Ejecución
1. Doble clic en `whatsapp-sender.exe`
2. Se abrirán dos ventanas de WhatsApp Web
3. Escanea el código QR en cada ventana con teléfonos diferentes

### 2. Configuración Inicial
Al iniciar por primera vez, se te pedirá:
- **ID de Campaña**: Nombre de tu campaña (ej: `ventas-diciembre-2024`)
- **ID de Agente**: Tu identificador (ej: `agente-001`)

Esta configuración se guarda automáticamente.

## 📋 Requisitos

### En tu PC:
- ✅ Windows 10 o 11 (64-bit)
- ✅ Conexión a Internet
- ✅ Dos números de WhatsApp diferentes
- ❌ NO necesitas instalar Node.js
- ❌ NO necesitas instalar nada más

### Cuentas de WhatsApp:
- **Cuenta 1**: Para envío automático (ventana con overlay oscuro)
- **Cuenta 2**: Para respuestas manuales (ventana normal)

## 🎮 Cómo Usar

### Ventana Automática (Con Overlay Oscuro)
- ✅ Envía mensajes automáticamente
- ❌ NO interactúes con esta ventana
- ✅ El overlay te protege de hacer clics accidentales
- ✅ Se detiene automáticamente después de 45 mensajes

### Ventana Manual (Normal)
- ✅ Úsala para responder mensajes
- ✅ Puedes ver el historial de cada contacto
- ✅ Botón "Ver Historial" en la esquina inferior izquierda
- ✅ Botón "Respaldar Chats" para guardar conversaciones

## 📝 Preparar Mensajes

### Archivo de Contactos
El sistema obtiene contactos del servidor automáticamente.

### Plantilla de Mensaje
Edita `message-template.txt` con tu mensaje:

```
Hola {{first_name}},

Te escribo para informarte sobre tu crédito:

📋 Número de crédito: {{credit}}
💳 Saldo pendiente: ${{total_balance}}
🎁 Descuento disponible: {{discount}}%

¿Tienes alguna pregunta?

Saludos,
{{agent_name}}
```

### Variables Disponibles:
- `{{first_name}}` - Primer nombre
- `{{credit}}` - Número de crédito
- `{{total_balance}}` - Saldo total
- `{{discount}}` - Descuento
- `{{product}}` - Producto
- `{{agent_name}}` - Nombre del agente

## 🔒 Protecciones de Seguridad

### Ventana Automática:
- ✅ Overlay de protección siempre visible
- ✅ No se puede interactuar con ella
- ✅ Playwright controla todo automáticamente

### Ventana Manual:
- ✅ Clic derecho bloqueado
- ✅ DevTools bloqueadas (F12)
- ✅ Elementos de WhatsApp ocultos (llamadas, nuevo chat, etc.)
- ✅ Solo puedes responder mensajes

## ⏱️ Límites y Pausas

### Sistema de Lotes:
- **Límite**: 45 mensajes por lote
- **Pausa**: 2 horas entre lotes
- **Automático**: El sistema se pausa solo

### ¿Por qué hay límites?
Para evitar que WhatsApp bloquee tu cuenta por spam.

## 💾 Respaldo de Chats

### Crear Respaldo:
1. En la ventana manual, clic en "Respaldar Chats"
2. Espera a que termine (puede tardar varios minutos)
3. El respaldo se sube automáticamente al servidor

### Ver Historial:
1. Selecciona un contacto en la ventana manual
2. Clic en "Ver Historial" (esquina inferior izquierda)
3. Se mostrará el historial de mensajes con ese contacto

## 🐛 Solución de Problemas

### No se abre la aplicación
- Verifica que tengas Windows 10/11 de 64 bits
- Ejecuta como Administrador (clic derecho → "Ejecutar como administrador")

### "Target page has been closed"
- No cierres las ventanas de WhatsApp manualmente
- Deja que el sistema las maneje

### No aparece el código QR
- Espera unos segundos, puede tardar en cargar
- Verifica tu conexión a Internet

### Se cerró una ventana por accidente
- Cierra la aplicación completamente (Ctrl+C en la terminal si está visible)
- Vuelve a ejecutar `whatsapp-sender.exe`

### "Cannot find module"
- Asegúrate de tener todos los archivos en la misma carpeta
- No muevas el `.exe` a otra ubicación sin los demás archivos

## 📁 Archivos Importantes

### NO BORRAR:
- `whatsapp-session/` - Sesión de la ventana automática
- `whatsapp-session-manual/` - Sesión de la ventana manual
- `agent-config.json` - Tu configuración de agente

### PUEDES EDITAR:
- `message-template.txt` - Plantilla de mensaje
- `config.js` - Configuración avanzada (solo si sabes lo que haces)

## 🆘 Soporte

Si tienes problemas:
1. Lee esta guía completamente
2. Verifica la sección "Solución de Problemas"
3. Contacta al administrador del sistema

## 📊 Indicadores Visuales

### Ventana Automática:
- 🤖 Overlay oscuro con "Automatización en Proceso"
- ✅ Significa que está funcionando correctamente
- ❌ Si no ves el overlay, algo está mal

### Ventana Manual:
- 💬 Badge verde "Modo Manual - Solo Respuestas"
- 📋 Contador de contactos en automatización
- ☁️ Botón "Respaldar Chats"
- 📜 Botón "Ver Historial"

## ⚠️ Advertencias Importantes

1. **NO cierres las ventanas manualmente** - Deja que el sistema las maneje
2. **NO uses la misma cuenta en ambas ventanas** - Usa cuentas diferentes
3. **NO envíes más de 45 mensajes seguidos** - El sistema se pausa automáticamente
4. **NO compartas tu sesión** - Los archivos de sesión son personales
5. **NO edites archivos que no conozcas** - Puedes romper la aplicación

## ✅ Buenas Prácticas

1. ✅ Escanea el QR solo una vez, la sesión se guarda
2. ✅ Revisa la plantilla de mensaje antes de enviar
3. ✅ Responde los mensajes en la ventana manual
4. ✅ Haz respaldos periódicos de los chats
5. ✅ Respeta las pausas automáticas del sistema

## 🎉 ¡Listo!

Ahora estás listo para usar WhatsApp Sender. Si tienes dudas, consulta esta guía o contacta al soporte.

**¡Buena suerte con tus campañas! 📱💼**
