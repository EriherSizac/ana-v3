# Guía para Generar Instalador Portable de ANA

Esta guía explica cómo crear un instalador Windows (.exe) que incluye **Node.js, Playwright y todas las dependencias** en un solo ejecutable.

## 📋 Requisitos Previos

1. **Windows 10/11 de 64 bits**
2. **PowerShell** (incluido en Windows)
3. **Inno Setup 6.x** - [Descargar aquí](https://jrsoftware.org/isdl.php)
4. **Conexión a Internet** (para descargar Node.js durante el build)

## 🚀 Proceso de Build

### Paso 1: Ejecutar el Script de Build

Abre PowerShell en la carpeta `cli-whatsapp` y ejecuta:

```powershell
.\build-portable.ps1
```

Este script realizará automáticamente:

1. ✅ Descarga Node.js v18.20.2 portable (64-bit)
2. ✅ Extrae Node.js en `dist-portable/nodejs/`
3. ✅ Copia todos los archivos de la aplicación
4. ✅ Instala dependencias de producción con npm
5. ✅ Instala Playwright y descarga Chromium
6. ✅ Copia los navegadores a `dist-portable/browsers/`
7. ✅ Crea scripts de inicio (.bat)

**Tiempo estimado:** 5-10 minutos (depende de la velocidad de Internet)

### Paso 2: Compilar el Instalador con Inno Setup

1. Abre **Inno Setup Compiler**
2. Ve a `File > Open` y selecciona:
   ```
   cli-whatsapp\installer\ANA-portable.iss
   ```
3. Haz clic en `Build > Compile` o presiona `Ctrl+F9`
4. Espera a que termine la compilación

**Resultado:** Se generará el archivo:
```
cli-whatsapp\dist-portable\ANA-Setup-Portable.exe
```

## 📦 Contenido del Instalador

El instalador incluye:

```
ANA/
├── nodejs/              # Node.js v18.20.2 portable
│   ├── node.exe
│   ├── npm.cmd
│   └── ...
├── app/                 # Aplicación y dependencias
│   ├── index.js
│   ├── whatsapp.js
│   ├── node_modules/
│   └── ...
├── browsers/            # Navegadores de Playwright
│   └── chromium-*/
├── ANA.bat              # Script de inicio normal
└── ANA-con-imagen.bat   # Script con soporte de imagen
```

**Tamaño aproximado:** 300-400 MB (incluye Chromium completo)

## 🎯 Características del Instalador

- ✅ **Totalmente portable:** No requiere Node.js instalado en el sistema
- ✅ **Sin dependencias externas:** Todo incluido en el instalador
- ✅ **Instalación silenciosa:** No requiere permisos de administrador
- ✅ **Desinstalación limpia:** Elimina todos los archivos y configuraciones
- ✅ **Iconos en escritorio y menú inicio**
- ✅ **Variables de entorno configuradas automáticamente**

## 🔧 Scripts de Inicio

### ANA.bat
Inicia la aplicación en modo normal:
```batch
ANA.bat
```

### ANA-con-imagen.bat
Inicia con soporte para imagen desde portapapeles:
```batch
ANA-con-imagen.bat --clipboard-media
```

## 📝 Personalización

### Cambiar Versión de Node.js

Edita `build-portable.ps1` línea 11:
```powershell
$NODE_VERSION = "18.20.2"  # Cambiar a la versión deseada
```

### Modificar Información del Instalador

Edita `installer\ANA-portable.iss`:
```ini
AppVersion=1.0.0           # Versión de la app
AppPublisher=Pernexium     # Nombre del publicador
DefaultDirName={autopf}\ANA # Directorio de instalación
```

### Agregar Archivos Adicionales

En `build-portable.ps1`, agrega archivos a la lista `$filesToCopy`:
```powershell
$filesToCopy = @(
    "index.js",
    "whatsapp.js",
    # ... archivos existentes
    "tu-archivo.js"  # Agregar aquí
)
```

## 🐛 Solución de Problemas

### Error: "No se puede ejecutar scripts en este sistema"

Ejecuta PowerShell como Administrador y ejecuta:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Error: "No se encontró ms-playwright"

Asegúrate de que Playwright se instaló correctamente:
```powershell
cd cli-whatsapp
npx playwright install chromium
```

### Error al compilar con Inno Setup

Verifica que:
1. Inno Setup 6.x esté instalado
2. El archivo `ANA-portable.iss` esté en `installer/`
3. La carpeta `dist-portable/` exista y tenga contenido

### Instalador muy grande (>500 MB)

Es normal. El tamaño incluye:
- Node.js: ~50 MB
- Chromium: ~250 MB
- Dependencias npm: ~50 MB

Para reducir tamaño, considera usar solo los navegadores necesarios.

## 🔄 Build Automatizado (CI/CD)

Para automatizar el proceso completo:

```powershell
# Build + Instalador en un solo comando
.\build-portable.ps1
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "installer\ANA-portable.iss"
```

## 📊 Comparación de Métodos

| Método | Node.js | Playwright | Tamaño | Complejidad |
|--------|---------|------------|--------|-------------|
| **pkg** (anterior) | ❌ No incluido | ⚠️ Parcial | ~100 MB | Media |
| **Portable** (nuevo) | ✅ Incluido | ✅ Completo | ~350 MB | Baja |
| **Electron** | ✅ Incluido | ✅ Completo | ~500 MB | Alta |

## 📚 Recursos Adicionales

- [Documentación de Inno Setup](https://jrsoftware.org/ishelp/)
- [Node.js Downloads](https://nodejs.org/en/download/)
- [Playwright Documentation](https://playwright.dev/)

## ✅ Checklist de Distribución

Antes de distribuir el instalador:

- [ ] Probar instalación en máquina limpia (sin Node.js)
- [ ] Verificar que ANA.bat inicia correctamente
- [ ] Probar conexión a WhatsApp
- [ ] Verificar envío de mensajes
- [ ] Probar desinstalación completa
- [ ] Escanear con antivirus (evitar falsos positivos)
- [ ] Firmar digitalmente el ejecutable (opcional pero recomendado)

## 🎉 ¡Listo!

Ahora tienes un instalador profesional que puede distribuirse a usuarios finales sin requerir instalaciones previas de Node.js o dependencias.
