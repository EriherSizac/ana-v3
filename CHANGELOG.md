# Changelog

## [2.0.0] - Sistema de Plantillas Implementado

### ✨ Nuevas Características

#### Sistema de Plantillas con Variables Dinámicas
- Soporte completo para variables en mensajes: `{{first_name}}`, `{{credit}}`, `{{product}}`, etc.
- Reemplazo automático de variables por datos de cada contacto
- 8 variables disponibles para personalización de mensajes

#### Importación CSV Mejorada
- Soporte para múltiples campos en CSV
- Campos soportados:
  - `contact_pho` / `phone` / `telefono` - Número de teléfono
  - `first_name` / `nombre_pila` - Nombre de pila
  - `last_name` / `apellido` - Apellido
  - `name` / `nombre` - Nombre completo
  - `credit` / `credito` - Crédito disponible
  - `discount` / `descuento` - Descuento
  - `total_balanc` / `balance` / `saldo` - Balance total
  - `product` / `producto` - Producto

#### Interfaz de Usuario Mejorada
- Panel de ayuda con todas las variables disponibles
- Visualización de todos los campos importados en la lista de contactos
- Botón "Ver variables" con icono Info
- Ejemplo de uso de plantillas en tiempo real
- Diseño mejorado para mostrar datos adicionales de contactos

#### Sistema de Procesamiento
- Función `replaceTemplateVariables()` para reemplazo de variables
- Soporte de nombres alternativos para campos CSV (español/inglés)
- Construcción automática de nombre completo desde first_name + last_name
- Validación de contactos con número de teléfono

### 🔧 Mejoras Técnicas

#### Nuevos Archivos
- `lib/template.ts` - Sistema de plantillas y reemplazo de variables
- `TEMPLATE_GUIDE.md` - Guía completa de uso del sistema de plantillas
- `CHANGELOG.md` - Registro de cambios

#### Actualizaciones
- `app/page.tsx` - Interfaz actualizada con soporte de plantillas
- `lib/whatsapp.ts` - Lógica de envío con personalización de mensajes
- `contacts-example.csv` - Ejemplo actualizado con todos los campos
- `README.md` - Documentación completa del sistema de plantillas

#### Tipos TypeScript
- Interface `Contact` extendida con campos opcionales
- Soporte completo de tipos para todas las variables

### 📚 Documentación
- Guía completa de uso de plantillas
- Ejemplos de mensajes personalizados
- Tabla de campos soportados y sus alternativas
- Consejos de uso y mejores prácticas

---

## [1.0.0] - Versión Inicial

### Características Iniciales
- Interfaz Next.js 14 con TypeScript
- Automatización de WhatsApp Web con Playwright
- Gestión básica de contactos
- Envío masivo de mensajes
- Persistencia de sesión
- Historial de campañas
