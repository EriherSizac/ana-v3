# 🚀 Inicio Rápido - Generar Instalador ANA

## Para Desarrolladores: Generar el Instalador

### Opción 1: Un Solo Comando (Recomendado)

```powershell
.\build-completo.ps1
```

**Esto hará:**
1. ✅ Verificar requisitos
2. ✅ Descargar Node.js portable
3. ✅ Instalar dependencias
4. ✅ Copiar navegadores de Playwright
5. ✅ Generar instalador .exe

**Resultado:** `dist-portable\ANA-Setup-Portable.exe`

**Tiempo:** 5-10 minutos

---

### Opción 2: Paso a Paso

#### 1. Verificar que todo esté listo
```powershell
.\verificar-build.ps1
```

#### 2. Generar archivos portables
```powershell
.\build-portable.ps1
```

#### 3. Compilar instalador
- Abre **Inno Setup Compiler**
- Abre: `installer\ANA-portable.iss`
- Presiona `Ctrl+F9` para compilar

---

## Para Usuarios Finales: Instalar ANA

### 1. Descargar
Descarga `ANA-Setup-Portable.exe`

### 2. Instalar
Doble clic en el instalador y sigue las instrucciones

### 3. Usar
- Busca "ANA" en el menú inicio
- O haz doble clic en el icono del escritorio

**¡Listo!** No necesitas instalar Node.js ni nada más.

---

## ❓ Preguntas Frecuentes

### ¿Qué incluye el instalador?
- ✅ Node.js v18.20.2
- ✅ Playwright con Chromium
- ✅ Todas las dependencias
- ✅ Todo en un solo .exe

### ¿Cuánto pesa?
~350 MB (incluye navegador Chromium completo)

### ¿Necesito Node.js instalado?
No, el instalador incluye Node.js portable

### ¿Funciona sin Internet?
Sí, después de instalado funciona sin Internet (excepto para WhatsApp Web)

### ¿Dónde se instala?
Por defecto en: `C:\Program Files\ANA\`

---

## 📚 Más Información

- **[BUILD-INSTALADOR.md](BUILD-INSTALADOR.md)** - Guía completa
- **[INSTALADOR-README.md](INSTALADOR-README.md)** - Documentación técnica
- **[installer/README-INSTALADOR.md](installer/README-INSTALADOR.md)** - Manual de usuario
