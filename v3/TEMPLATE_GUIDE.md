# Guía de Uso del Sistema de Plantillas

## 📋 Formato del CSV

El sistema acepta archivos CSV con los siguientes campos. Solo `contact_pho` (o equivalente) es obligatorio:

### Campos Soportados

| Campo CSV | Alternativas | Descripción | Variable en Plantilla |
|-----------|--------------|-------------|----------------------|
| `contact_pho` | `phone`, `telefono` | Número de teléfono con código de país | `{{phone}}` |
| `first_name` | `nombre_pila` | Nombre de pila del contacto | `{{first_name}}` |
| `last_name` | `apellido` | Apellido del contacto | `{{last_name}}` |
| `name` | `nombre` | Nombre completo | `{{name}}` |
| `credit` | `credito` | Crédito disponible | `{{credit}}` |
| `discount` | `descuento` | Descuento aplicable | `{{discount}}` |
| `total_balanc` | `balance`, `saldo` | Balance o saldo total | `{{total_balanc}}` |
| `product` | `producto` | Producto asociado | `{{product}}` |

## 📝 Ejemplo de CSV

```csv
contact_pho,first_name,last_name,credit,discount,total_balanc,product
521234567890,Juan,Pérez,5000,10%,1500,Laptop HP
5491123456789,María,García,3000,15%,2500,iPhone 15
34612345678,Carlos,López,7000,20%,3200,Samsung TV
```

## 💬 Ejemplos de Mensajes con Plantillas

### Ejemplo 1: Recordatorio de Saldo
```
Hola {{first_name}},

Te recordamos que tu saldo actual es de ${{total_balanc}}.

Tienes disponible un crédito de ${{credit}} para tus próximas compras.

¡Gracias por confiar en nosotros!
```

### Ejemplo 2: Oferta Personalizada
```
¡Hola {{first_name}} {{last_name}}!

Tenemos una oferta especial para ti en {{product}}.

Descuento exclusivo: {{discount}}
Crédito disponible: ${{credit}}
Balance actual: ${{total_balanc}}

¡No dejes pasar esta oportunidad!
```

### Ejemplo 3: Notificación Simple
```
Estimado/a {{first_name}},

Su producto {{product}} está listo para entrega.

Balance pendiente: ${{total_balanc}}
Descuento aplicado: {{discount}}

Para más información, contáctenos.
```

### Ejemplo 4: Mensaje de Cobranza
```
Hola {{name}},

Le recordamos que tiene un balance pendiente de ${{total_balanc}}.

Cuenta con un crédito disponible de ${{credit}} que puede utilizar.

Gracias por su atención.
```

## 🎯 Consejos de Uso

1. **Personalización**: Usa `{{first_name}}` para mensajes más personales y cercanos
2. **Información completa**: Combina múltiples variables para mensajes informativos
3. **Valores vacíos**: Si un contacto no tiene un campo, la variable se reemplazará por texto vacío
4. **Formato de números**: Los valores se insertan tal cual están en el CSV
5. **Prueba primero**: Envía mensajes de prueba antes de una campaña masiva

## ⚠️ Notas Importantes

- Las variables deben escribirse exactamente como se muestran: `{{variable}}`
- Las llaves dobles `{{` y `}}` son obligatorias
- Las variables son case-sensitive (distinguen mayúsculas/minúsculas)
- Si una variable no existe en el CSV, se reemplazará por vacío
- El sistema automáticamente construye `{{name}}` a partir de `{{first_name}}` y `{{last_name}}` si no está presente

## 🔄 Proceso de Reemplazo

1. Importas el CSV con los datos de tus contactos
2. Escribes tu mensaje usando las variables `{{variable}}`
3. Al enviar la campaña, cada mensaje se personaliza automáticamente
4. Las variables se reemplazan con los datos específicos de cada contacto

## 📞 Ejemplo Completo

**CSV:**
```csv
contact_pho,first_name,last_name,credit,discount,total_balanc,product
5215512345678,Ana,Martínez,2000,15%,850,Tablet Samsung
```

**Plantilla:**
```
Hola {{first_name}},

Tu balance es ${{total_balanc}} y tienes ${{credit}} de crédito.
Descuento en {{product}}: {{discount}}

¡Aprovecha!
```

**Mensaje Final Enviado:**
```
Hola Ana,

Tu balance es $850 y tienes $2000 de crédito.
Descuento en Tablet Samsung: 15%

¡Aprovecha!
```
