# WhatsApp Mass Sender

Sistema automatizado de envío masivo de mensajes de WhatsApp usando Next.js 14 y Playwright.

## 🚀 Características

- ✅ Interfaz moderna y responsive con TailwindCSS
- ✅ Automatización de WhatsApp Web con Playwright
- ✅ **Sistema de plantillas con variables dinámicas**
- ✅ Gestión de contactos (agregar manualmente o importar CSV)
- ✅ **Importación CSV con múltiples campos** (crédito, descuento, balance, producto, etc.)
- ✅ Envío masivo de mensajes personalizados con retraso configurable
- ✅ Persistencia de sesión de WhatsApp
- ✅ Historial de campañas
- ✅ Estado de conexión en tiempo real

## 📋 Requisitos

- Node.js 18+ 
- npm o yarn
- Una cuenta de WhatsApp

## 🛠️ Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Instalar navegadores de Playwright:
```bash
npx playwright install chromium
```

## 🚀 Uso

1. Iniciar el servidor de desarrollo:
```bash
npm run dev
```

2. Abrir [http://localhost:3000](http://localhost:3000) en tu navegador

3. Hacer clic en "Conectar WhatsApp" y escanear el código QR con tu teléfono

4. Agregar contactos:
   - Manualmente: Ingresar teléfono (formato: 521234567890) y nombre
   - CSV: Importar archivo CSV con múltiples campos (ver formato abajo)

5. Escribir tu mensaje usando variables de plantilla como `{{first_name}}`, `{{credit}}`, `{{product}}`, etc.

6. Configurar el retraso entre envíos

7. Hacer clic en "Enviar Campaña"

## 📁 Estructura del Proyecto

```
ana-v3/
├── app/
│   ├── api/
│   │   └── whatsapp/
│   │       ├── connect/route.ts    # API para conectar WhatsApp
│   │       ├── status/route.ts     # API para verificar estado
│   │       └── send/route.ts       # API para enviar mensajes
│   ├── globals.css                 # Estilos globales
│   ├── layout.tsx                  # Layout principal
│   └── page.tsx                    # Página principal
├── lib/
│   ├── utils.ts                    # Utilidades
│   ├── template.ts                 # Sistema de plantillas
│   └── whatsapp.ts                 # Lógica de Playwright
├── whatsapp-session/               # Sesión persistente (auto-generado)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── playwright.config.ts
```

## ⚙️ Configuración

### Formato de Números de Teléfono

Los números deben incluir el código de país sin el símbolo +:
- ✅ Correcto: `521234567890` (México)
- ✅ Correcto: `5491123456789` (Argentina)
- ❌ Incorrecto: `+52 123 456 7890`

### Retraso entre Mensajes

Se recomienda un retraso mínimo de 5 segundos entre mensajes para evitar bloqueos de WhatsApp.

### Formato CSV

El archivo CSV puede incluir los siguientes campos (todos opcionales excepto `contact_pho`):

```csv
contact_pho,first_name,last_name,credit,discount,total_balanc,product
521234567890,Juan,Pérez,5000,10%,1500,Laptop HP
5491123456789,María,García,3000,15%,2500,iPhone 15
34612345678,Carlos,López,7000,20%,3200,Samsung TV
```

**Campos soportados:**
- `contact_pho` o `phone` o `telefono` - Número de teléfono (requerido)
- `first_name` o `nombre_pila` - Nombre de pila
- `last_name` o `apellido` - Apellido
- `name` o `nombre` - Nombre completo
- `credit` o `credito` - Crédito disponible
- `discount` o `descuento` - Descuento aplicable
- `total_balanc` o `balance` o `saldo` - Balance total
- `product` o `producto` - Producto asociado

### Sistema de Plantillas

Puedes usar variables en tus mensajes que se reemplazarán automáticamente con los datos de cada contacto:

**Variables disponibles:**
- `{{first_name}}` - Nombre de pila
- `{{last_name}}` - Apellido
- `{{name}}` - Nombre completo
- `{{phone}}` - Número de teléfono
- `{{credit}}` - Crédito
- `{{discount}}` - Descuento
- `{{total_balanc}}` - Balance total
- `{{product}}` - Producto

**Ejemplo de mensaje con plantilla:**
```
Hola {{first_name}},

Te informamos que tu saldo actual es de ${{total_balanc}}.
Tienes un crédito disponible de ${{credit}} y un descuento del {{discount}} en tu próxima compra de {{product}}.

¡Gracias por tu preferencia!
```

Este mensaje se personalizará automáticamente para cada contacto.

## 🔒 Seguridad

- La sesión de WhatsApp se guarda localmente en `whatsapp-session/`
- No se almacenan mensajes ni contactos en el servidor
- Toda la automatización se ejecuta en tu máquina local

## ⚠️ Advertencias

- **Uso responsable**: Este proyecto es para fines educativos. El envío masivo de mensajes puede violar los términos de servicio de WhatsApp.
- **Límites de WhatsApp**: WhatsApp puede bloquear tu cuenta si detecta actividad sospechosa.
- **Retraso recomendado**: Usa al menos 5 segundos de retraso entre mensajes.
- **Prueba primero**: Envía mensajes de prueba a números propios antes de una campaña masiva.

## 🐛 Solución de Problemas

### Error: "WhatsApp no está inicializado"
1. Haz clic en "Conectar WhatsApp" antes de enviar mensajes
2. Espera a que el indicador cambie a verde (Conectado)
3. Mantén la ventana del navegador de WhatsApp abierta

### El código QR no aparece
- Asegúrate de que Playwright esté instalado correctamente
- Elimina la carpeta `whatsapp-session/` y vuelve a conectar

### Los mensajes no se envían
- **Verifica la conexión**: El indicador debe estar en verde
- **Formato del número**: Debe incluir código de país sin símbolos (ej: 521234567890)
- **Ventana abierta**: No cierres el navegador de WhatsApp
- **Aumenta el retraso**: Mínimo 5 segundos entre mensajes

### Error de navegador
```bash
npx playwright install chromium --force
```

### Herramienta de Diagnóstico
Usa el botón **"🔍 Diagnóstico"** en la interfaz para obtener información detallada sobre el estado de conexión.

### Más información
- [DIAGNOSTICO_RAPIDO.md](./DIAGNOSTICO_RAPIDO.md) - Guía rápida de diagnóstico
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Solución de problemas completa
- [INSTRUCCIONES_USO.md](./INSTRUCCIONES_USO.md) - Instrucciones paso a paso

## 📝 Licencia

MIT

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor, abre un issue o pull request.

## 📧 Soporte

Para reportar problemas o sugerencias, abre un issue en el repositorio.
