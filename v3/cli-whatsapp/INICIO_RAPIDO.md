# ⚡ Inicio Rápido - 3 Pasos

## 1️⃣ Instalar (solo primera vez)

```bash
cd cli-whatsapp
npm install
npx playwright install chromium
```

## 2️⃣ Preparar Archivos

### Edita `contactos.csv` con tus contactos:
```csv
contact_pho,first_name,last_name,credit,discount,total_balanc,product
5215532009317,Juan,Pérez,5000,10%,1500,Laptop HP
```

### Edita `mensaje.txt` con tu mensaje:
```
Hola {{first_name}},

Tu saldo es ${{total_balanc}}
Crédito: ${{credit}}

¿Necesitas ayuda?
```

## 3️⃣ Ejecutar

```bash
npm start
```

## 📊 Resultados

Después de ejecutar encontrarás:

- **`resultados.csv`** - Todos los contactos con estado de envío
- **`respuestas.csv`** - Solo los que respondieron

## 🎯 Eso es Todo!

El programa:
1. ✅ Abre WhatsApp Web
2. ✅ Lee tu CSV
3. ✅ Envía mensajes personalizados
4. ✅ Captura respuestas
5. ✅ Guarda todo en CSV

---

## 📝 Variables Disponibles

Usa estas en `mensaje.txt`:

- `{{first_name}}` - Nombre
- `{{last_name}}` - Apellido
- `{{name}}` - Nombre completo
- `{{phone}}` - Teléfono
- `{{credit}}` - Crédito
- `{{discount}}` - Descuento
- `{{total_balanc}}` - Balance
- `{{product}}` - Producto

---

## ⚠️ Importante

1. **Primera vez:** Escanea el código QR cuando se abra la ventana
2. **No cierres** la ventana de Chromium durante el proceso
3. **Formato de números:** Con código de país, sin `+` (ej: 521234567890)

---

## 🆘 Ayuda

Si algo no funciona:
1. Lee el `README.md` completo
2. Verifica que `contactos.csv` y `mensaje.txt` existan
3. Asegúrate de que los números tengan código de país

¡Listo! 🚀
