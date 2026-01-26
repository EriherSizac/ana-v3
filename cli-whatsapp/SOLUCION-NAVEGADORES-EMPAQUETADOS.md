# 🔧 Solución: Navegadores Empaquetados en el Instalador

## Problema Original

Al ejecutar el instalador portable, la aplicación mostraba el error:
```
Executable doesn't exist at C:\Users\[Usuario]\AppData\Local\ms-playwright\chromium-1200\chrome-win64\chrome.exe
Please run: npx playwright install
```

## Causa

Playwright por defecto busca los navegadores en `AppData\Local\ms-playwright` del usuario que ejecuta la aplicación. En un instalador portable, los navegadores están empaquetados en la carpeta `browsers/` junto con la aplicación, no en AppData.

## Solución Implementada

Se implementó una solución de **doble capa** para garantizar que Playwright use los navegadores empaquetados:

### 1. Configuración en JavaScript (`setup-env.js`)

Se creó un módulo `setup-env.js` que se importa **antes** de Playwright en todos los archivos:

```javascript
// setup-env.js
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detectar si existe carpeta "browsers" empaquetada
const isPackaged = () => {
  const parentDir = path.dirname(__dirname);
  const browsersPath = path.join(parentDir, 'browsers');
  
  if (fs.existsSync(browsersPath)) {
    return browsersPath;
  }
  
  return null;
};

// Configurar PLAYWRIGHT_BROWSERS_PATH
const packagedBrowsersPath = isPackaged();

if (packagedBrowsersPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = packagedBrowsersPath;
  console.log(`✓ Usando navegadores empaquetados: ${packagedBrowsersPath}`);
}
```

### 2. Importación en Archivos Principales

Todos los archivos que usan Playwright ahora importan `setup-env.js` **primero**:

**`index.js`:**
```javascript
// IMPORTANTE: setup-env.js debe importarse PRIMERO
import './setup-env.js';

import fs from 'fs';
import path from 'path';
// ... resto de imports
```

**`whatsapp.js`:**
```javascript
// IMPORTANTE: setup-env.js debe importarse PRIMERO
import './setup-env.js';

import { chromium } from 'playwright';
// ... resto de imports
```

Lo mismo para:
- `whatsapp-manual.js`
- `whatsapp-monitor.js`

### 3. Configuración en Scripts .bat

Los scripts de inicio también configuran la variable de entorno como respaldo:

**`ANA.bat`:**
```batch
@echo off
setlocal EnableDelayedExpansion

REM Configurar ruta de navegadores de Playwright
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"

REM Agregar Node.js al PATH
set "PATH=%~dp0nodejs;%PATH%"

REM Cambiar al directorio de la aplicación
cd /d "%~dp0app"

REM Ejecutar la aplicación
"%~dp0nodejs\node.exe" index.js %*

endlocal
```

## Estructura del Instalador

```
C:\Program Files\ANA\
├── nodejs/              # Node.js portable
├── browsers/            # Navegadores de Playwright
│   └── chromium-1200/
│       └── chrome-win64/
│           └── chrome.exe  ← Chromium empaquetado
├── app/                 # Aplicación
│   ├── setup-env.js     ← Configura variables de entorno
│   ├── index.js
│   ├── whatsapp.js
│   └── node_modules/
├── ANA.bat              ← Script de inicio
└── ANA-con-imagen.bat
```

## Flujo de Ejecución

1. Usuario ejecuta `ANA.bat`
2. Script `.bat` configura `PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers`
3. Node.js inicia `index.js`
4. `index.js` importa `setup-env.js` **primero**
5. `setup-env.js` detecta la carpeta `browsers/` y configura `process.env.PLAYWRIGHT_BROWSERS_PATH`
6. Cuando se importa Playwright, ya sabe dónde buscar los navegadores
7. ✅ Chromium se carga desde `C:\Program Files\ANA\browsers\`

## Ventajas de Esta Solución

- ✅ **Funciona sin instalación de Playwright** en el sistema del usuario
- ✅ **Detección automática** de navegadores empaquetados
- ✅ **Compatible con desarrollo** (usa navegadores del sistema si no hay carpeta `browsers/`)
- ✅ **Doble capa de seguridad** (script .bat + código JavaScript)
- ✅ **Sin modificaciones a Playwright** (usa variables de entorno estándar)

## Verificación

Para verificar que funciona correctamente:

1. Instala el ejecutable en una máquina **sin Node.js ni Playwright**
2. Ejecuta `ANA.bat`
3. Deberías ver el mensaje:
   ```
   ✓ Usando navegadores empaquetados: C:\Program Files\ANA\browsers
   ```
4. WhatsApp Web debería abrirse sin errores

## Modo Desarrollo vs Producción

### Modo Desarrollo
- No existe carpeta `browsers/` en el directorio del proyecto
- `setup-env.js` no configura `PLAYWRIGHT_BROWSERS_PATH`
- Playwright usa navegadores de `AppData\Local\ms-playwright`
- Mensaje: `ℹ Usando navegadores del sistema (modo desarrollo)`

### Modo Producción (Instalador)
- Existe carpeta `browsers/` empaquetada
- `setup-env.js` configura `PLAYWRIGHT_BROWSERS_PATH`
- Playwright usa navegadores empaquetados
- Mensaje: `✓ Usando navegadores empaquetados: C:\Program Files\ANA\browsers`

## Archivos Modificados

1. **Nuevos:**
   - `setup-env.js` - Configuración de variables de entorno

2. **Modificados:**
   - `index.js` - Importa `setup-env.js` primero
   - `whatsapp.js` - Importa `setup-env.js` primero
   - `whatsapp-manual.js` - Importa `setup-env.js` primero
   - `whatsapp-monitor.js` - Importa `setup-env.js` primero
   - `build-portable.ps1` - Copia `setup-env.js` y mejora scripts .bat

## Solución de Problemas

### Error: "Executable doesn't exist"

**Causa:** La variable `PLAYWRIGHT_BROWSERS_PATH` no se configuró correctamente.

**Solución:**
1. Verifica que existe la carpeta `C:\Program Files\ANA\browsers\`
2. Verifica que `setup-env.js` esté en `C:\Program Files\ANA\app\`
3. Ejecuta desde `ANA.bat`, no directamente con `node index.js`

### No aparece el mensaje "Usando navegadores empaquetados"

**Causa:** `setup-env.js` no detecta la carpeta `browsers/`.

**Solución:**
1. Verifica la estructura de directorios
2. Asegúrate de que `browsers/` esté al mismo nivel que `app/`

### Funciona en desarrollo pero no en producción

**Causa:** `setup-env.js` no se copió al instalador.

**Solución:**
1. Verifica que `setup-env.js` esté en la lista de archivos a copiar en `build-portable.ps1`
2. Regenera el instalador con `.\build-completo.ps1`

## Referencias

- [Playwright Environment Variables](https://playwright.dev/docs/browsers#hermetic-install)
- Variable `PLAYWRIGHT_BROWSERS_PATH` - Especifica dónde buscar navegadores
- Documentación de Node.js sobre `process.env`

---

**Versión:** 1.0.0  
**Fecha:** Enero 2025  
**Estado:** ✅ Resuelto
