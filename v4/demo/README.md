# Demo — prueba de envío

Dos CSV de ejemplo, uno por formato. **v4 acepta ambos sin configurar nada**: las columnas del estándar v3 (el que ya circula en supervisores, reportes y el CRM) se normalizan con alias a sus equivalentes en español y viceversa.

## Formatos soportados

| Estándar v3 (el usado en otros sistemas) | Alias v4 (español) |
|---|---|
| `phone_number` / `contact_phone` | `telefono` / `phone` |
| `first_name` / `last_name` | `nombre_pila` / `apellido` |
| `name` / `contact_name` | `nombre` |
| `credit` / `credit_id` / `id_credito` | `credito` |
| `discount` | `descuento` |
| `total_balance` / `balance` | `saldo` |
| `product` | `producto` |
| `message` | `mensaje` |

En la plantilla puedes usar cualquiera de los dos nombres (`{saldo}` funciona sobre un CSV con `total_balance`). También se acepta la sintaxis vieja `{{variable}}` de v3.

## Archivos

- `contactos-demo.csv` — formato v4 mínimo (`telefono,nombre,saldo`)
- `contactos-demo-v3.csv` — formato estándar v3 completo (`phone_number,first_name,last_name,credit,discount,total_balance,product,message`), con plantilla por contacto en la columna `message` y expresión matemática

## Cómo probar

1. Conecta WhatsApp (escanea QR).
2. Tab **Campañas** → sube cualquiera de los dos CSV.
   - Para el v3: la columna teléfono configurada (`telefono`) no existe en el archivo — no importa, el fallback de alias encuentra `phone_number` solo.
3. Plantilla:
   - demo v4: `Hola {nombre}, tu saldo es {saldo}. Realiza tu pago hoy.` → `{saldo}` sale como `$1,234.50`.
   - demo v3: usa `{message}` como plantilla para mandar el mensaje por contacto de la columna `message`, o escribe una propia con `{first_name}`, `{total_balance}`, `{total_balance*0.85:dinero}`…
4. **Sin** "repartir" → los jobs quedan asignados a tu propio operador.
5. Tab **Mi asignación** → aparecen los contactos; selecciona, ajusta plantilla si quieres (preview en vivo) y pulsa **Enviar**.
6. El envío respeta el ritmo anti-bloqueo (7 msgs/20 min) y se registra en el CRM.

Mensaje resultante (demo v4):
> Hola Erick, tu saldo es $1,234.50. Realiza tu pago hoy.
