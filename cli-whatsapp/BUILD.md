# 📦 Guía para Crear Ejecutable de WhatsApp Sender

## 🎯 Objetivo
Crear un archivo `.exe` que incluya Node.js y todas las dependencias para ejecutar en cualquier PC con Windows sin necesidad de instalar Node.js.

## 📋 Requisitos Previos
- Node.js instalado (solo para crear el ejecutable)
- npm instalado

## 🔨 Pasos para Crear el Ejecutable

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Instalar pkg (herramienta de empaquetado)
```bash
npm install --save-dev pkg
```

### 3. Construir el Ejecutable
```bash
npm run build
```

Esto creará:
- `dist/whatsapp-sender.exe` - Ejecutable principal (~100MB)

## 📦 Contenido del Paquete Distribuible

Para distribuir la aplicación, necesitas incluir:

```
whatsapp-sender/
├── whatsapp-sender.exe          # Ejecutable principal
├── message-template.txt          # Plantilla de mensaje
├── config.js                     # Configuración (opcional)
└── README-USUARIO.md            # Instrucciones para el usuario
```

## 🚀 Uso del Ejecutable

### En la PC del Usuario:
1. Copiar la carpeta `whatsapp-sender` a cualquier ubicación
2. Doble clic en `whatsapp-sender.exe`
3. La aplicación se ejecutará automáticamente

### Requisitos en la PC del Usuario:
- ✅ Windows 10/11 (64-bit)
- ✅ Conexión a Internet (para WhatsApp Web)
- ❌ NO requiere Node.js instalado
- ❌ NO requiere npm instalado

## 📝 Notas Importantes

### Playwright y Navegadores
El ejecutable incluye Playwright, pero los navegadores Chromium se descargan automáticamente la primera vez que se ejecuta.

### Archivos de Sesión
Los archivos de sesión de WhatsApp se guardan en:
- `./whatsapp-session` (modo automático)
- `./whatsapp-session-manual` (modo manual)

Estos archivos deben mantenerse para no tener que escanear el QR cada vez.

### Configuración
El archivo `config.js` contiene la configuración de la aplicación. Puede ser editado antes de distribuir.

## 🐛 Solución de Problemas

### Error: "Cannot find module"
- Asegúrate de incluir todos los archivos `.js` en la carpeta
- Verifica que `message-template.txt` esté presente

### Error: "Playwright browsers not found"
- La primera ejecución descargará los navegadores automáticamente
- Requiere conexión a Internet

### El ejecutable es muy grande
- Es normal, incluye Node.js completo (~50MB) + Playwright (~50MB)
- No se puede reducir significativamente

## 🔄 Actualizar el Ejecutable

Para crear una nueva versión:
1. Modificar el código fuente
2. Actualizar la versión en `package.json`
3. Ejecutar `npm run build`
4. Distribuir el nuevo `.exe`

## 📊 Estructura del Proyecto

```
cli-whatsapp/
├── index.js                 # Punto de entrada principal
├── whatsapp.js             # Lógica de automatización
├── whatsapp-manual.js      # Ventana manual
├── chat-backup.js          # Sistema de respaldo
├── agent-config.js         # Configuración de agente
├── message-utils.js        # Utilidades de mensajes
├── config.js               # Configuración general
├── message-template.txt    # Plantilla de mensaje
├── package.json            # Configuración de npm y pkg
└── dist/                   # Carpeta de salida
    └── whatsapp-sender.exe # Ejecutable generado
```

## 🎁 Distribución Final

Crear un archivo ZIP con:
```
whatsapp-sender-v1.0.zip
├── whatsapp-sender.exe
├── message-template.txt
├── config.js
└── README-USUARIO.md
```

El usuario solo necesita:
1. Descomprimir el ZIP
2. Ejecutar `whatsapp-sender.exe`
3. ¡Listo! 🎉
