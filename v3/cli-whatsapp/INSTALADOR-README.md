# 📦 Sistema de Instalador Portable para ANA

Este directorio contiene todo lo necesario para generar un instalador Windows (.exe) que incluye **Node.js, Playwright y todas las dependencias** en un solo ejecutable.

## 🎯 Solución Implementada

### ¿Qué incluye el instalador?

El instalador generado es **completamente autónomo** e incluye:

- ✅ **Node.js v18.20.2 portable** (no requiere instalación previa)
- ✅ **Playwright con Chromium** (navegador incluido)
- ✅ **Todas las dependencias npm** (csv-parser, csv-writer, etc.)
- ✅ **Scripts de inicio** (.bat para ejecución fácil)
- ✅ **Configuración automática** de variables de entorno

### Ventajas sobre la solución anterior (pkg)

| Característica | pkg (anterior) | Portable (nuevo) |
|----------------|----------------|------------------|
| Node.js incluido | ❌ No | ✅ Sí |
| Playwright completo | ⚠️ Parcial | ✅ Completo |
| Sin dependencias externas | ❌ No | ✅ Sí |
| Fácil de distribuir | ⚠️ Medio | ✅ Muy fácil |
| Tamaño final | ~100 MB | ~350 MB |

## 🚀 Uso Rápido

### Opción 1: Build Completo Automatizado (Recomendado)

```powershell
.\build-completo.ps1
```

Este script ejecuta automáticamente:
1. Verificación de requisitos
2. Build portable
3. Compilación del instalador con Inno Setup

**Resultado:** `dist-portable\ANA-Setup-Portable.exe` listo para distribuir

### Opción 2: Paso a Paso

```powershell
# 1. Verificar requisitos
.\verificar-build.ps1

# 2. Generar archivos portables
.\build-portable.ps1

# 3. Compilar instalador (manual)
# Abre Inno Setup y compila: installer\ANA-portable.iss
```

## 📁 Archivos del Sistema

### Scripts de Build

- **`build-completo.ps1`** - Script todo-en-uno (recomendado)
- **`build-portable.ps1`** - Genera archivos portables con Node.js
- **`verificar-build.ps1`** - Verifica requisitos previos
- **`build.ps1`** - Script anterior (usa pkg, obsoleto)

### Configuración de Inno Setup

- **`installer/ANA-portable.iss`** - Configuración del instalador portable (nuevo)
- **`installer/ANA.iss`** - Configuración anterior (obsoleto)
- **`installer/README-INSTALADOR.md`** - Documentación para usuarios finales

### Documentación

- **`BUILD-INSTALADOR.md`** - Guía completa de build
- **`INSTALADOR-README.md`** - Este archivo

## 📋 Requisitos

### Para Generar el Instalador

- Windows 10/11 (64 bits)
- PowerShell 5.0+
- Conexión a Internet (para descargar Node.js)
- [Inno Setup 6.x](https://jrsoftware.org/isdl.php)
- 2 GB de espacio libre en disco

### Para Ejecutar el Instalador (Usuario Final)

- Windows 10/11 (64 bits)
- 500 MB de espacio libre
- **NO requiere Node.js, Python ni dependencias**

## 🔧 Proceso Técnico

### 1. Descarga de Node.js Portable

El script descarga automáticamente Node.js portable desde nodejs.org:
```
https://nodejs.org/dist/v18.20.2/node-v18.20.2-win-x64.zip
```

### 2. Estructura Generada

```
dist-portable/
├── nodejs/              # Node.js portable
│   ├── node.exe
│   ├── npm.cmd
│   └── ...
├── app/                 # Aplicación
│   ├── index.js
│   ├── whatsapp.js
│   ├── node_modules/    # Dependencias
│   └── ...
├── browsers/            # Chromium de Playwright
│   └── chromium-*/
├── ANA.bat              # Launcher normal
└── ANA-con-imagen.bat   # Launcher con imagen
```

### 3. Scripts de Inicio (.bat)

Los scripts `.bat` configuran automáticamente:
- Variable `PLAYWRIGHT_BROWSERS_PATH` apuntando a `browsers/`
- Variable `PATH` incluyendo `nodejs/`
- Directorio de trabajo en `app/`

### 4. Instalador de Inno Setup

El instalador:
- Copia todos los archivos a `C:\Program Files\ANA\`
- Crea iconos en escritorio y menú inicio
- Configura desinstalador
- No requiere permisos de administrador

## 📊 Tamaños Aproximados

| Componente | Tamaño |
|------------|--------|
| Node.js portable | ~50 MB |
| Chromium (Playwright) | ~250 MB |
| Dependencias npm | ~30 MB |
| Código de la app | ~5 MB |
| **Instalador final** | **~350 MB** |

## 🎨 Personalización

### Cambiar Versión de Node.js

Edita `build-portable.ps1`:
```powershell
$NODE_VERSION = "18.20.2"  # Cambiar aquí
```

### Modificar Información del Instalador

Edita `installer\ANA-portable.iss`:
```ini
AppVersion=1.0.0
AppPublisher=Pernexium
DefaultDirName={autopf}\ANA
```

### Agregar Archivos Adicionales

En `build-portable.ps1`, modifica:
```powershell
$filesToCopy = @(
    "index.js",
    "whatsapp.js",
    # ... archivos existentes
    "nuevo-archivo.js"  # Agregar aquí
)
```

## 🐛 Solución de Problemas

### Error: "No se puede ejecutar scripts"

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Error: "No se encontró ms-playwright"

```powershell
npx playwright install chromium
```

### Error al descargar Node.js

Verifica tu conexión a Internet y que nodejs.org sea accesible.

### Inno Setup no encontrado

Descarga e instala desde: https://jrsoftware.org/isdl.php

## 📦 Distribución

### Antes de Distribuir

- [ ] Probar instalador en máquina limpia
- [ ] Verificar que ANA.bat funcione
- [ ] Probar conexión a WhatsApp
- [ ] Verificar envío de mensajes
- [ ] Escanear con antivirus
- [ ] Considerar firma digital del ejecutable

### Distribución

El archivo `ANA-Setup-Portable.exe` puede distribuirse directamente:
- Por correo electrónico
- En unidad USB
- Descarga desde sitio web
- Red corporativa

## 🔄 Comparación de Métodos

### Método 1: pkg (anterior)
```powershell
.\build.ps1
```
- ❌ No incluye Node.js
- ⚠️ Requiere Node.js instalado en el sistema
- ✅ Tamaño pequeño (~100 MB)

### Método 2: Portable (nuevo)
```powershell
.\build-completo.ps1
```
- ✅ Incluye Node.js portable
- ✅ Totalmente autónomo
- ⚠️ Tamaño mayor (~350 MB)

### Método 3: Electron (alternativa)
- ✅ Incluye todo
- ✅ Interfaz gráfica nativa
- ❌ Muy grande (~500 MB)
- ❌ Requiere reescribir la app

## 📚 Documentación Adicional

- **[BUILD-INSTALADOR.md](BUILD-INSTALADOR.md)** - Guía detallada de build
- **[installer/README-INSTALADOR.md](installer/README-INSTALADOR.md)** - Manual de usuario
- **[README.md](README.md)** - Documentación general del proyecto

## 🎉 Resultado Final

Después de ejecutar `build-completo.ps1`, obtendrás:

```
✓ ANA-Setup-Portable.exe (~350 MB)
  └─ Instalador Windows completo
     ├─ Node.js v18.20.2 incluido
     ├─ Playwright con Chromium
     ├─ Todas las dependencias
     └─ Listo para distribuir
```

El usuario final solo necesita:
1. Descargar `ANA-Setup-Portable.exe`
2. Ejecutar el instalador
3. Hacer doble clic en el icono de ANA
4. ¡Listo para usar!

---

**Versión:** 1.0.0  
**Última actualización:** Enero 2025  
**Desarrollado por:** Pernexium
