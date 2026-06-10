# Instalador ANA - Información para Usuarios

## 🎯 ¿Qué es ANA?

**Asistente de Negociación Avanzada (ANA)** es una herramienta profesional para envío masivo de mensajes de WhatsApp con personalización avanzada.

## 📥 Instalación

1. **Descarga** el archivo `ANA-Setup-Portable.exe`
2. **Ejecuta** el instalador haciendo doble clic
3. **Sigue** las instrucciones en pantalla
4. **Listo** - ANA estará instalado y listo para usar

### Requisitos del Sistema

- ✅ Windows 10 o superior (64 bits)
- ✅ 2 GB de RAM mínimo
- ✅ 500 MB de espacio en disco
- ✅ Conexión a Internet (para WhatsApp Web)

**NO requiere:**
- ❌ Node.js instalado
- ❌ Python o dependencias adicionales
- ❌ Permisos de administrador

## 🚀 Primer Uso

### Opción 1: Desde el Escritorio
Haz doble clic en el icono **ANA** en tu escritorio.

### Opción 2: Desde el Menú Inicio
Busca "ANA" en el menú inicio de Windows.

### Opción 3: Desde la Carpeta de Instalación
Navega a la carpeta de instalación (por defecto: `C:\Program Files\ANA`) y ejecuta `ANA.bat`.

## 📱 Conectar WhatsApp

1. **Inicia ANA** usando cualquiera de los métodos anteriores
2. Aparecerá una ventana de navegador con **WhatsApp Web**
3. **Escanea el código QR** con tu teléfono:
   - Abre WhatsApp en tu teléfono
   - Ve a Configuración > Dispositivos vinculados
   - Toca "Vincular un dispositivo"
   - Escanea el código QR que aparece en la pantalla
4. **¡Listo!** Tu sesión quedará guardada para futuros usos

## 💬 Enviar Mensajes

### Modo Interactivo (Recomendado)

1. Ejecuta `ANA.bat`
2. Sigue las instrucciones en pantalla:
   - Selecciona archivo CSV con contactos
   - Escribe o carga tu mensaje
   - Configura el retraso entre mensajes
   - Confirma y envía

### Modo con Imagen

Si quieres enviar una imagen desde el portapapeles:

1. **Copia** la imagen que deseas enviar (Ctrl+C)
2. Ejecuta `ANA-con-imagen.bat`
3. La imagen se adjuntará automáticamente a tus mensajes

## 📊 Formato de Contactos (CSV)

Crea un archivo CSV con tus contactos. Ejemplo:

```csv
contact_pho,first_name,last_name,credit,product
5212345678901,Juan,Pérez,5000,Laptop HP
5219876543210,María,García,3000,iPhone 15
```

**Campos disponibles:**
- `contact_pho` - Número de teléfono (requerido)
- `first_name` - Nombre
- `last_name` - Apellido
- `credit` - Crédito
- `discount` - Descuento
- `total_balanc` - Balance
- `product` - Producto

## 🎨 Plantillas de Mensajes

Usa variables en tus mensajes para personalizar:

```
Hola {{first_name}},

Tu saldo actual es de ${{total_balanc}}.
Tienes un crédito de ${{credit}} disponible.

¡Gracias por tu preferencia!
```

**Variables disponibles:**
- `{{first_name}}` - Nombre
- `{{last_name}}` - Apellido
- `{{phone}}` - Teléfono
- `{{credit}}` - Crédito
- `{{discount}}` - Descuento
- `{{total_balanc}}` - Balance
- `{{product}}` - Producto

## ⚙️ Configuración Avanzada

### Cambiar Retraso entre Mensajes

Edita el archivo `config.js` en la carpeta de instalación:

```javascript
export const DEFAULT_DELAY = 5000; // 5 segundos (recomendado)
```

### Cambiar Límite de Mensajes por Día

```javascript
export const DAILY_MESSAGE_LIMIT = 100; // Máximo recomendado
```

## 🔒 Seguridad y Privacidad

- ✅ **Todos los datos se almacenan localmente** en tu computadora
- ✅ **No se envía información a servidores externos**
- ✅ **Tu sesión de WhatsApp está protegida**
- ✅ **Los contactos y mensajes no se comparten**

## ⚠️ Advertencias Importantes

### Límites de WhatsApp

WhatsApp puede **bloquear tu cuenta** si detecta:
- Envío masivo excesivo (>100 mensajes/día)
- Mensajes idénticos a muchos contactos
- Comportamiento automatizado obvio

### Recomendaciones

- ✅ Usa un **retraso mínimo de 5 segundos** entre mensajes
- ✅ **Personaliza los mensajes** con variables
- ✅ **No envíes más de 100 mensajes por día**
- ✅ **Prueba primero** con 2-3 contactos
- ✅ Usa una **cuenta secundaria** si es posible

## 🐛 Problemas Comunes

### "No se puede conectar a WhatsApp"

**Solución:**
1. Verifica tu conexión a Internet
2. Cierra y vuelve a abrir ANA
3. Escanea el código QR nuevamente

### "Los mensajes no se envían"

**Solución:**
1. Verifica que WhatsApp esté conectado (ventana abierta)
2. Revisa el formato de los números (deben incluir código de país)
3. Aumenta el retraso entre mensajes a 10 segundos

### "Error al leer archivo CSV"

**Solución:**
1. Verifica que el archivo tenga extensión `.csv`
2. Asegúrate de que tenga la columna `contact_pho`
3. Usa codificación UTF-8

### "La ventana de WhatsApp se cierra sola"

**Solución:**
1. No cierres la ventana manualmente durante el envío
2. Si se cierra sola, reinicia ANA
3. Verifica que no haya otro proceso de Chromium ejecutándose

## 🗑️ Desinstalación

1. Ve a **Configuración de Windows** > **Aplicaciones**
2. Busca **"Asistente de Negociacion Avanzada (ANA)"**
3. Haz clic en **Desinstalar**
4. Confirma la desinstalación

Esto eliminará:
- ✅ Todos los archivos de programa
- ✅ Iconos del escritorio y menú inicio
- ✅ Sesiones de WhatsApp guardadas

## 📞 Soporte

Para reportar problemas o solicitar ayuda:

1. **Revisa** esta documentación primero
2. **Consulta** el archivo `TROUBLESHOOTING.md` en la carpeta de instalación
3. **Contacta** al soporte técnico de Pernexium

## 📄 Licencia

Este software es propiedad de Pernexium y está licenciado para uso personal y comercial según los términos acordados.

## 🔄 Actualizaciones

Para actualizar ANA:

1. **Descarga** la nueva versión del instalador
2. **Ejecuta** el nuevo instalador
3. La instalación anterior se actualizará automáticamente
4. **Tu sesión de WhatsApp se mantendrá**

---

**Versión:** 1.0.0  
**Última actualización:** 2025  
**Desarrollado por:** Pernexium
