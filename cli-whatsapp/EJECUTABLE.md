# 🎯 Guía Rápida: Crear Ejecutable de WhatsApp Sender

## 📦 Opción 1: Build Automático (Recomendado)

### Comando Simple:
```bash
npm run build:full
```

Este comando:
1. ✅ Instala todas las dependencias
2. ✅ Construye el ejecutable
3. ✅ Crea el paquete de distribución
4. ✅ Genera el archivo ZIP listo para enviar

### Resultado:
```
dist/
├── whatsapp-sender.exe              # Ejecutable (~100MB)
├── whatsapp-sender-v1.0.zip        # ZIP para distribuir
└── whatsapp-sender-package/         # Carpeta con todo
    ├── whatsapp-sender.exe
    ├── message-template.txt
    ├── config.js
    └── README-USUARIO.md
```

---

## 🔧 Opción 2: Build Manual

### Paso 1: Instalar pkg
```bash
npm install --save-dev pkg
```

### Paso 2: Construir
```bash
npm run build
```

### Paso 3: Preparar paquete manualmente
Copia estos archivos a una carpeta:
- `dist/whatsapp-sender.exe`
- `message-template.txt`
- `config.js`
- `README-USUARIO.md`

---

## 📤 Distribuir a Usuarios

### Enviar:
```
dist/whatsapp-sender-v1.0.zip
```

### El usuario debe:
1. Descomprimir el ZIP
2. Doble clic en `whatsapp-sender.exe`
3. ¡Listo! No necesita instalar nada

---

## ⚙️ Configuración de pkg

El archivo `package.json` incluye:

```json
{
  "pkg": {
    "assets": [
      "node_modules/playwright-core/**/*",
      "message-template.txt",
      "config.js",
      "*.js"
    ],
    "targets": [
      "node18-win-x64"
    ]
  }
}
```

### ¿Qué incluye?
- ✅ Node.js 18 (runtime completo)
- ✅ Playwright Core (automatización)
- ✅ Todos los archivos .js del proyecto
- ✅ Plantilla de mensaje
- ✅ Configuración

---

## 🐛 Problemas Comunes

### Error: "pkg: command not found"
```bash
npm install -g pkg
# O usar npx:
npx pkg . --targets node18-win-x64 --output dist/whatsapp-sender.exe
```

### Error: "Cannot find module 'playwright'"
Asegúrate de incluir playwright en assets:
```json
"assets": [
  "node_modules/playwright-core/**/*"
]
```

### El ejecutable no funciona
1. Verifica que todos los archivos .js estén incluidos
2. Revisa que `message-template.txt` esté presente
3. Ejecuta como Administrador en Windows

### El ejecutable es muy grande (>100MB)
Es normal. Incluye:
- Node.js completo (~50MB)
- Playwright (~50MB)
- Tu código (~1MB)

---

## 🎨 Personalización

### Cambiar el ícono del .exe
1. Crea un archivo `icon.ico`
2. Agrega a `package.json`:
```json
"pkg": {
  "assets": [...],
  "targets": [...],
  "icon": "icon.ico"
}
```

### Cambiar el nombre del ejecutable
En `package.json`:
```json
"scripts": {
  "build": "pkg . --targets node18-win-x64 --output dist/MI-NOMBRE.exe"
}
```

### Crear versión para otros sistemas
```json
"targets": [
  "node18-win-x64",    // Windows 64-bit
  "node18-linux-x64",  // Linux 64-bit
  "node18-macos-x64"   // macOS 64-bit
]
```

---

## 📊 Tamaño del Ejecutable

| Componente | Tamaño |
|------------|--------|
| Node.js Runtime | ~50 MB |
| Playwright Core | ~40 MB |
| Dependencias | ~10 MB |
| Tu Código | ~1 MB |
| **TOTAL** | **~100 MB** |

---

## ✅ Checklist de Distribución

Antes de enviar el ejecutable:

- [ ] Probado en una PC limpia (sin Node.js)
- [ ] Incluye `message-template.txt`
- [ ] Incluye `config.js`
- [ ] Incluye `README-USUARIO.md`
- [ ] El ZIP está completo
- [ ] Las instrucciones son claras

---

## 🚀 Comandos Rápidos

```bash
# Build completo (recomendado)
npm run build:full

# Solo ejecutable
npm run build

# Limpiar y rebuild
rm -rf dist node_modules
npm install
npm run build:full
```

---

## 📝 Notas Importantes

1. **Primera ejecución**: Playwright descargará Chromium (~100MB adicionales)
2. **Sesiones**: Los archivos de sesión NO se incluyen en el ejecutable
3. **Configuración**: El usuario puede editar `config.js` después de descomprimir
4. **Actualizaciones**: Para actualizar, solo envía un nuevo ZIP

---

## 🎉 ¡Listo!

Ahora puedes crear ejecutables de WhatsApp Sender y distribuirlos fácilmente.

**Comando mágico:**
```bash
npm run build:full
```

**Resultado:**
```
dist/whatsapp-sender-v1.0.zip → Listo para enviar! 📦
```
