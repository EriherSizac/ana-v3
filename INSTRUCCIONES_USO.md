# 📱 Instrucciones de Uso - WhatsApp Mass Sender

## ⚠️ IMPORTANTE: Flujo Correcto de Uso

### 🔴 Problema Común
Si ves el círculo verde (Conectado) pero al enviar dice "WhatsApp no está conectado", significa que el estado del frontend no está sincronizado con el backend.

### ✅ Solución: Flujo Correcto

#### Paso 1: Iniciar el Servidor
```bash
npm run dev
```

#### Paso 2: Abrir el Navegador
- Ve a: http://localhost:3000
- Verás el círculo ROJO (Desconectado)

#### Paso 3: Conectar WhatsApp (MUY IMPORTANTE)
1. **Haz clic en "Conectar WhatsApp"**
2. Se abrirá una ventana del navegador Chromium
3. **Escanea el código QR** con tu teléfono
4. **Espera a que cargue completamente** (verás tus chats)
5. **NO CIERRES** la ventana del navegador

#### Paso 4: Verificar Conexión
1. Después de escanear el QR, espera 5-10 segundos
2. Haz clic en el botón **"Verificar"** junto al estado
3. El círculo debe cambiar a **VERDE**
4. Si sigue rojo, vuelve a hacer clic en "Verificar"

#### Paso 5: Importar Contactos
1. Prepara tu archivo CSV con el formato correcto
2. Haz clic en "Importar CSV con datos"
3. Verifica que los contactos se carguen correctamente

#### Paso 6: Escribir Mensaje
1. Escribe tu mensaje usando variables: `{{first_name}}`, `{{credit}}`, etc.
2. Haz clic en "Ver variables" para ver todas las opciones
3. Configura el retraso (mínimo 5 segundos)

#### Paso 7: Enviar Campaña
1. **ANTES de enviar**, haz clic en "Verificar" una vez más
2. Asegúrate de que el círculo esté **VERDE**
3. Haz clic en "Enviar Campaña"
4. Los mensajes comenzarán a enviarse

## 🔍 Verificación de Estado

### Indicadores Visuales

| Color | Estado | Significado | Acción |
|-------|--------|-------------|--------|
| 🔴 Rojo | Desconectado | WhatsApp no está conectado | Haz clic en "Conectar WhatsApp" |
| 🟡 Amarillo | Conectando... | Proceso de conexión en curso | Espera a que termine |
| 🟢 Verde | Conectado | WhatsApp está listo | Puedes enviar mensajes |

### Botón "Verificar"
- **Cuándo usarlo**: Antes de enviar mensajes
- **Qué hace**: Consulta el estado REAL del backend
- **Resultado**: Actualiza el indicador con el estado correcto

## 🚨 Problemas Comunes y Soluciones

### Problema 1: Círculo verde pero error al enviar

**Causa**: Estado del frontend desincronizado

**Solución**:
1. Haz clic en "Verificar"
2. Si cambia a rojo, haz clic en "Conectar WhatsApp"
3. Escanea el QR nuevamente
4. Espera a que cargue
5. Haz clic en "Verificar" nuevamente

### Problema 2: La ventana de WhatsApp se cierra

**Causa**: Cerraste manualmente la ventana del navegador

**Solución**:
1. NO cierres la ventana del navegador Chromium
2. Puedes minimizarla, pero no cerrarla
3. Si la cerraste, haz clic en "Conectar WhatsApp" nuevamente

### Problema 3: El QR no aparece

**Solución**:
```bash
# Eliminar sesión guardada (PowerShell en Windows)
Remove-Item -Recurse -Force whatsapp-session

# Reiniciar servidor
npm run dev

# Conectar nuevamente
```

### Problema 4: Dice "conectado" pero no envía

**Diagnóstico**:
1. Abre la consola del navegador (F12)
2. Ve a la pestaña "Console"
3. Haz clic en "Verificar"
4. Revisa los logs que aparecen

**Solución**:
1. Revisa la consola del servidor (terminal)
2. Busca mensajes como:
   - ✅ WhatsApp conectado
   - ❌ WhatsApp no conectado
3. Si ves ❌, reconecta WhatsApp

## 📊 Logs del Sistema

### En el Navegador (F12 > Console)
```
Estado de conexión: {status: "connected", debug: {...}}
```

### En el Servidor (Terminal)
```
📍 URL actual: https://web.whatsapp.com/
✅ WhatsApp conectado
✓ Mensaje enviado a Juan (5215532009317)
```

## ✅ Checklist Antes de Enviar

- [ ] Servidor corriendo (`npm run dev`)
- [ ] Navegador abierto en http://localhost:3000
- [ ] Botón "Conectar WhatsApp" presionado
- [ ] Código QR escaneado
- [ ] WhatsApp Web cargado completamente
- [ ] Ventana del navegador Chromium ABIERTA
- [ ] Botón "Verificar" presionado
- [ ] Círculo en VERDE
- [ ] Contactos importados
- [ ] Mensaje escrito con variables
- [ ] Retraso configurado (mínimo 5 segundos)

## 🎯 Flujo Ideal (Sin Errores)

```
1. npm run dev
   ↓
2. Abrir http://localhost:3000
   ↓
3. Clic en "Conectar WhatsApp"
   ↓
4. Escanear QR con teléfono
   ↓
5. Esperar 5-10 segundos
   ↓
6. Clic en "Verificar"
   ↓
7. Verificar que esté VERDE
   ↓
8. Importar CSV
   ↓
9. Escribir mensaje con variables
   ↓
10. Clic en "Verificar" (de nuevo)
    ↓
11. Clic en "Enviar Campaña"
    ↓
12. ✅ Mensajes enviándose
```

## 💡 Consejos Importantes

1. **Siempre verifica antes de enviar**
   - Usa el botón "Verificar" antes de cada campaña

2. **Mantén la ventana abierta**
   - La ventana de Chromium debe estar abierta todo el tiempo
   - Puedes minimizarla pero NO cerrarla

3. **Espera después de conectar**
   - Después de escanear el QR, espera 5-10 segundos
   - WhatsApp necesita tiempo para cargar completamente

4. **Revisa los logs**
   - Consola del navegador (F12)
   - Terminal del servidor
   - Te dirán exactamente qué está pasando

5. **Usa retraso adecuado**
   - Mínimo 5 segundos entre mensajes
   - WhatsApp puede bloquear si envías muy rápido

## 🔧 Comandos Útiles

### Windows (PowerShell)
```powershell
# Eliminar sesión
Remove-Item -Recurse -Force whatsapp-session

# Iniciar servidor
npm run dev
```

### Linux/Mac
```bash
# Eliminar sesión
rm -rf whatsapp-session/

# Iniciar servidor
npm run dev
```

## 📞 ¿Necesitas Ayuda?

1. **Revisa los logs** en consola y terminal
2. **Consulta** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
3. **Verifica** que seguiste todos los pasos
4. **Abre un issue** con los logs si el problema persiste
