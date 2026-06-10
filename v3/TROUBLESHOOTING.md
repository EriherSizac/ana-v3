# Solución de Problemas

## Error: "WhatsApp no está inicializado"

### Causa
Este error ocurre cuando intentas enviar mensajes sin haber conectado WhatsApp Web primero.

### Solución

1. **Verifica el estado de conexión**
   - En la interfaz, busca el indicador de estado en la parte superior
   - Debe mostrar "Conectado" (círculo verde)
   - Si muestra "Desconectado" (círculo rojo), necesitas conectar

2. **Conectar WhatsApp**
   - Haz clic en el botón "Conectar WhatsApp"
   - Se abrirá una ventana del navegador con WhatsApp Web
   - Escanea el código QR con tu teléfono
   - Espera a que cargue completamente (verás tus chats)

3. **Verificar la conexión**
   - Una vez conectado, el indicador debe cambiar a verde
   - Ahora puedes enviar mensajes

### Pasos Detallados

```
1. Iniciar servidor: npm run dev
2. Abrir http://localhost:3000
3. Clic en "Conectar WhatsApp"
4. Escanear código QR
5. Esperar a que cargue (círculo verde)
6. Ahora puedes enviar mensajes
```

## Error: "WhatsApp no está conectado"

### Causa
La sesión de WhatsApp se cerró o perdió la conexión.

### Solución

1. **Refrescar la página**
   - Presiona F5 o recarga la página
   - Verifica el estado de conexión

2. **Reconectar**
   - Si sigue desconectado, haz clic en "Conectar WhatsApp" nuevamente
   - Puede que necesites escanear el QR otra vez

3. **Limpiar sesión**
   - Si el problema persiste, cierra el navegador de WhatsApp
   - Elimina la carpeta `whatsapp-session/`
   - Reinicia el servidor: `npm run dev`
   - Conecta nuevamente

## La ventana de WhatsApp se cierra sola

### Causa
El navegador de Playwright se cierra automáticamente.

### Solución

1. **No cierres la ventana manualmente**
   - La ventana del navegador debe permanecer abierta
   - Es la que mantiene la conexión con WhatsApp

2. **Verificar que no haya errores**
   - Revisa la consola del servidor (terminal)
   - Busca mensajes de error

## Los mensajes no se envían

### Verificaciones

1. **Estado de conexión**
   ```
   ✓ Indicador verde = Conectado
   ✗ Indicador rojo = Desconectado
   ```

2. **Formato de números**
   ```
   ✓ Correcto: 521234567890
   ✗ Incorrecto: +52 123 456 7890
   ✗ Incorrecto: (52) 123-456-7890
   ```

3. **Ventana de WhatsApp**
   - Debe estar abierta y visible
   - Debe mostrar tus chats

4. **Sesión activa**
   - WhatsApp Web debe estar activo en tu teléfono
   - No debe haber cerrado sesión

## Números inválidos

### Síntomas
- Mensaje: "Número inválido"
- El mensaje no se envía a ciertos contactos

### Solución

1. **Verificar formato**
   - Debe incluir código de país
   - Solo números, sin espacios ni símbolos
   - Ejemplo: `521234567890` (México)

2. **Verificar que el número exista**
   - El número debe estar registrado en WhatsApp
   - Prueba enviando un mensaje manual primero

## La sesión no persiste

### Causa
La carpeta `whatsapp-session/` no se está creando o guardando.

### Solución

1. **Verificar permisos**
   - Asegúrate de tener permisos de escritura en la carpeta del proyecto

2. **Verificar la carpeta**
   ```bash
   # Debe existir después de conectar
   ls whatsapp-session/
   ```

3. **Recrear sesión**
   ```bash
   # Eliminar sesión antigua
   rm -rf whatsapp-session/
   
   # Reiniciar servidor
   npm run dev
   
   # Conectar nuevamente
   ```

## Errores de Playwright

### Error: "Browser not found"

```bash
# Reinstalar navegadores
npx playwright install chromium
```

### Error: "Timeout waiting for selector"

**Causa**: WhatsApp Web cambió su estructura o está cargando lento.

**Solución**:
1. Aumentar el timeout en `lib/whatsapp.ts`
2. Verificar tu conexión a internet
3. Esperar más tiempo antes de enviar mensajes

## Debugging

### Ver información de debug

1. **Consola del navegador**
   - Abre DevTools (F12)
   - Ve a la pestaña Console
   - Busca errores en rojo

2. **Consola del servidor**
   - Revisa la terminal donde corre `npm run dev`
   - Busca mensajes de error

3. **Endpoint de status**
   ```bash
   # Ver estado actual
   curl http://localhost:3000/api/whatsapp/status
   ```

### Logs útiles

El sistema imprime logs en la consola del servidor:
- `✓ Mensaje enviado a...` - Éxito
- `✗ Error al enviar mensaje a...` - Fallo
- `Número inválido: ...` - Número no válido

## Mejores Prácticas

1. **Siempre conectar primero**
   - No intentes enviar sin conectar
   - Verifica el indicador verde

2. **Mantener la ventana abierta**
   - No cierres el navegador de WhatsApp
   - Minimízalo si es necesario

3. **Usar retraso adecuado**
   - Mínimo 5 segundos entre mensajes
   - Evita ser bloqueado por WhatsApp

4. **Probar primero**
   - Envía mensajes de prueba a tu propio número
   - Verifica que las variables se reemplacen correctamente

5. **Guardar la sesión**
   - No elimines `whatsapp-session/` innecesariamente
   - Te ahorra tener que escanear el QR cada vez

## Contacto de Soporte

Si el problema persiste:
1. Revisa los logs del servidor
2. Verifica que WhatsApp Web funcione en tu navegador normal
3. Asegúrate de tener la última versión de las dependencias
4. Abre un issue en el repositorio con los detalles del error
