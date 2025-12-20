# 📋 Documentación de Endpoints para Supervisores

## 🎯 Descripción General

Este documento describe los endpoints disponibles para que los supervisores gestionen credenciales de campaña y contactos de agentes en el sistema de WhatsApp automatizado.

---

## 🔗 URL Base del Backend

```
https://ow24p7ablb.execute-api.us-east-1.amazonaws.com
```

---

## 📑 Tabla de Contenidos

1. [Gestión de Credenciales](#gestión-de-credenciales)
   - [Obtener Credenciales](#1-obtener-credenciales-de-campaña)
   - [Subir Credenciales](#2-subir-credenciales-de-campaña)
   - [Regenerar Contraseñas](#3-regenerar-contraseñas-diarias)
2. [Gestión de Contactos](#gestión-de-contactos)
   - [Subir Contactos](#1-subir-contactos-de-agente)
   - [Obtener Contactos](#2-obtener-contactos-de-agente)
3. [Autenticación](#autenticación)
4. [Estructura en S3](#estructura-en-s3)
5. [Ejemplos Completos](#ejemplos-completos)

---

## 🔐 Gestión de Credenciales

### 1. Obtener Credenciales de Campaña

Descarga el archivo CSV con las credenciales de todos los usuarios de una campaña.

**Endpoint:**
```
GET /credentials/{campaign}
```

**Parámetros de Ruta:**
- `campaign` (string): Nombre de la campaña

**Ejemplo:**
```bash
curl -X GET \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/prueba
```

**Respuesta Exitosa (200):**
```csv
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
```

**Respuesta Error (404):**
```json
{
  "success": false,
  "message": "CSV no encontrado"
}
```

---

### 2. Subir Credenciales de Campaña

Crea o actualiza el archivo CSV con las credenciales de usuarios para una campaña.

**Endpoint:**
```
POST /credentials/upload
```

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "campaign": "prueba",
  "csv": "user,dailyPassword\nerick,sol-brillante-2024\nadmin,luna-plateada-noche\nagente1,estrella-fugaz-cielo"
}
```

**Ejemplo:**
```bash
# Crear archivo CSV
cat > credenciales-prueba.csv << EOF
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
EOF

# Subir al backend
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/upload \
  -H "Content-Type: application/json" \
  -d '{
    "campaign": "prueba",
    "csv": "'"$(cat credenciales-prueba.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'"
  }'
```

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "CSV subido correctamente",
  "data": {
    "campaign": "prueba",
    "key": "agents/prueba/credentials.csv",
    "userCount": 3,
    "timestamp": "2024-12-20T18:15:00.000Z"
  }
}
```

---

### 3. Regenerar Contraseñas Diarias

Regenera automáticamente todas las contraseñas diarias de una campaña con frases aleatorias.

**Endpoint:**
```
POST /credentials/regenerate
```

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "campaign": "prueba"
}
```

**Ejemplo:**
```bash
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/regenerate \
  -H "Content-Type: application/json" \
  -d '{"campaign": "prueba"}'
```

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "Contraseñas regeneradas correctamente",
  "data": {
    "campaign": "prueba",
    "updatedCount": 3,
    "updates": [
      {
        "user": "erick",
        "oldPassword": "sol-brillante-2024",
        "newPassword": "oceano-azul-profundo"
      },
      {
        "user": "admin",
        "oldPassword": "luna-plateada-noche",
        "newPassword": "montana-nevada-alta"
      },
      {
        "user": "agente1",
        "oldPassword": "estrella-fugaz-cielo",
        "newPassword": "rio-cristalino-fluye"
      }
    ],
    "timestamp": "2024-12-20T18:20:00.000Z"
  }
}
```

**Frases Aleatorias Disponibles (30):**
- `sol-brillante-2024`
- `luna-plateada-noche`
- `estrella-fugaz-cielo`
- `montana-nevada-alta`
- `oceano-azul-profundo`
- `rio-cristalino-fluye`
- `bosque-verde-espeso`
- `viento-suave-primavera`
- `lluvia-fresca-manana`
- Y 21 más...

---

## 📇 Gestión de Contactos

### 1. Subir Contactos de Agente

Sube un archivo CSV con los contactos asignados a un agente específico, incluyendo el mensaje personalizado que se enviará.

**Endpoint:**
```
POST /supervisors/agents/{agent}/{campaign}/contacts
```

**Parámetros de Ruta:**
- `agent` (string): ID del agente
- `campaign` (string): Nombre de la campaña

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "csv": "phone,first_name,credit,total_balance,discount,product\n5215513023544,Juan,12345,5000,10,Producto A\n5215513023545,María,12346,3000,15,Producto B",
  "message": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}. Descuento: {{discount}}%. Producto: {{product}}."
}
```

**Formato del CSV (antes de agregar mensaje):**
```csv
phone,first_name,credit,total_balance,discount,product
5215513023544,Juan,12345,5000,10,Producto A
5215513023545,María,12346,3000,15,Producto B
```

**Ejemplo:**
```bash
# Crear archivo CSV
cat > contactos-erick.csv << EOF
phone,first_name,credit,total_balance,discount,product
5215513023544,Juan,12345,5000,10,Producto A
5215513023545,María,12346,3000,15,Producto B
5215513023546,Pedro,12347,8000,20,Producto C
EOF

# Subir con mensaje personalizado
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "'"$(cat contactos-erick.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'",
    "message": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}. Descuento: {{discount}}%. Producto: {{product}}."
  }'
```

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "CSV subido correctamente con mensaje agregado",
  "data": {
    "agent": "erick",
    "campaign": "prueba",
    "key": "agents/prueba/erick-contacts.csv",
    "contactCount": 3,
    "messageAdded": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}...",
    "timestamp": "2024-12-20T18:25:00.000Z"
  }
}
```

**CSV Resultante en S3:**
```csv
phone,first_name,credit,total_balance,discount,product,message
5215513023544,Juan,12345,5000,10,Producto A,"Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}. Descuento: {{discount}}%. Producto: {{product}}."
5215513023545,María,12346,3000,15,Producto B,"Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}. Descuento: {{discount}}%. Producto: {{product}}."
5215513023546,Pedro,12347,8000,20,Producto C,"Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}. Descuento: {{discount}}%. Producto: {{product}}."
```

**Variables Disponibles en el Mensaje:**
Puedes usar cualquier columna del CSV como variable con la sintaxis `{{nombre_columna}}`:
- `{{phone}}` - Número de teléfono
- `{{first_name}}` - Nombre
- `{{credit}}` - Crédito
- `{{total_balance}}` - Saldo total
- `{{discount}}` - Descuento
- `{{product}}` - Producto
- O cualquier otra columna personalizada

---

### 2. Obtener Contactos de Agente

Descarga el archivo CSV con los contactos de un agente específico.

**Endpoint:**
```
GET /supervisors/agents/{agent}/{campaign}/contacts
```

**Parámetros de Ruta:**
- `agent` (string): ID del agente
- `campaign` (string): Nombre de la campaña

**Ejemplo:**
```bash
curl -X GET \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts
```

**Respuesta Exitosa (200):**
```csv
phone,first_name,credit,total_balance,discount,product,message
5215513023544,Juan,12345,5000,10,Producto A,"Hola Juan, te contactamos sobre tu crédito 12345..."
5215513023545,María,12346,3000,15,Producto B,"Hola María, te contactamos sobre tu crédito 12346..."
```

**Respuesta Error (404):**
```json
{
  "success": false,
  "message": "CSV no encontrado"
}
```

---

## 🔑 Autenticación

### Verificar Credenciales

Este endpoint es usado por el CLI de WhatsApp para verificar las credenciales de los agentes.

**Endpoint:**
```
POST /auth/verify
```

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "user": "erick",
  "campaign": "prueba",
  "dailyPassword": "sol-brillante-2024"
}
```

**Ejemplo:**
```bash
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "user": "erick",
    "campaign": "prueba",
    "dailyPassword": "sol-brillante-2024"
  }'
```

**Respuesta Exitosa (200):**
```json
{
  "success": true,
  "message": "Credenciales verificadas correctamente",
  "data": {
    "user": "erick",
    "campaign": "prueba",
    "timestamp": "2024-12-20T18:30:00.000Z"
  }
}
```

**Respuesta Error (401):**
```json
{
  "success": false,
  "message": "Palabra del día incorrecta"
}
```

---

## 📁 Estructura en S3

Los archivos se almacenan en el bucket S3 con la siguiente estructura:

```
ana-backend-storage-dev/
└── agents/
    ├── prueba/                          # Campaña "prueba"
    │   ├── credentials.csv              # Credenciales de la campaña
    │   ├── erick-contacts.csv           # Contactos del agente "erick"
    │   ├── admin-contacts.csv           # Contactos del agente "admin"
    │   └── agente1-contacts.csv         # Contactos del agente "agente1"
    ├── ventas/                          # Campaña "ventas"
    │   ├── credentials.csv
    │   ├── vendedor1-contacts.csv
    │   └── vendedor2-contacts.csv
    └── cobranza/                        # Campaña "cobranza"
        ├── credentials.csv
        ├── cobrador1-contacts.csv
        └── cobrador2-contacts.csv
```

---

## 📚 Ejemplos Completos

### Ejemplo 1: Configurar Nueva Campaña Completa

```bash
# 1. Crear CSV de credenciales
cat > credenciales-ventas.csv << EOF
user,dailyPassword
vendedor1,montana-nevada-alta
vendedor2,rio-cristalino-fluye
supervisor,bosque-verde-espeso
EOF

# 2. Subir credenciales al backend
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/upload \
  -H "Content-Type: application/json" \
  -d '{
    "campaign": "ventas",
    "csv": "'"$(cat credenciales-ventas.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'"
  }'

# 3. Crear CSV de contactos para vendedor1
cat > contactos-vendedor1.csv << EOF
phone,first_name,credit,total_balance,discount,product
5215513023544,Juan,12345,5000,10,Producto A
5215513023545,María,12346,3000,15,Producto B
5215513023546,Pedro,12347,8000,20,Producto C
EOF

# 4. Subir contactos con mensaje personalizado
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/vendedor1/ventas/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "'"$(cat contactos-vendedor1.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'",
    "message": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo pendiente: ${{total_balance}}. Tenemos un descuento del {{discount}}% en {{product}}."
  }'

# 5. Verificar que todo se subió correctamente
curl -X GET \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/ventas

curl -X GET \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/vendedor1/ventas/contacts
```

---

### Ejemplo 2: Regenerar Contraseñas Diariamente

```bash
# Script para ejecutar diariamente (cron job)
#!/bin/bash

CAMPAIGNS=("prueba" "ventas" "cobranza")

for campaign in "${CAMPAIGNS[@]}"; do
  echo "Regenerando contraseñas para campaña: $campaign"
  
  curl -X POST \
    https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/regenerate \
    -H "Content-Type: application/json" \
    -d '{"campaign": "'$campaign'"}'
  
  echo ""
done

echo "✅ Contraseñas regeneradas para todas las campañas"
```

---

### Ejemplo 3: Actualizar Contactos de un Agente

```bash
# 1. Descargar CSV actual
curl -X GET \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts \
  > contactos-erick-actual.csv

# 2. Editar el CSV (agregar/modificar contactos)
# ... editar manualmente o con script ...

# 3. Subir CSV actualizado
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "'"$(cat contactos-erick-actualizado.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'",
    "message": "Hola {{first_name}}, mensaje actualizado sobre {{product}}."
  }'
```

---

## 🚀 Despliegue del Backend

Para desplegar el backend en AWS:

```bash
cd ana-backend
npm install
serverless deploy
```

Esto creará:
- API Gateway con los endpoints
- Funciones Lambda para cada handler
- Bucket S3 para almacenar los archivos
- Permisos IAM necesarios

---

## 🔒 Seguridad

- Todos los endpoints tienen CORS habilitado
- Las credenciales se almacenan en S3 (no en base de datos)
- Las contraseñas diarias cambian regularmente
- Los agentes solo pueden acceder a sus propios contactos
- Los supervisores gestionan todo desde endpoints dedicados

---

## 📞 Soporte

Para más información o soporte, consulta:
- Archivo principal: `SUPERVISORES.md`
- Código fuente: `src/handlers/`
- Configuración: `serverless.yml`

---

## 📝 Notas Importantes

1. **Formato CSV**: Siempre incluye headers en la primera línea
2. **Encoding**: Usa UTF-8 para caracteres especiales
3. **Números de teléfono**: Formato internacional (ej: 5215513023544)
4. **Variables en mensajes**: Usa `{{nombre_columna}}` para reemplazar valores
5. **Contraseñas**: Mínimo 5 caracteres, se recomienda usar frases
6. **Backup**: Descarga los CSV antes de modificarlos

---

---

## 📄 Archivos CSV de Ejemplo

### Ejemplo 1: CSV de Credenciales (`credenciales-ejemplo.csv`)

```csv
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
agente2,montana-nevada-alta
supervisor,oceano-azul-profundo
```

**Cómo usar:**
```bash
# Guardar como archivo
cat > credenciales-ejemplo.csv << 'EOF'
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
agente2,montana-nevada-alta
supervisor,oceano-azul-profundo
EOF

# Subir al backend
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/upload \
  -H "Content-Type: application/json" \
  -d '{
    "campaign": "prueba",
    "csv": "'"$(cat credenciales-ejemplo.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'"
  }'
```

---

### Ejemplo 2: CSV de Contactos (`contactos-ejemplo.csv`)

```csv
contact_phone,credit,discount,first_name,last_name,total_balance,product
5215513023544,600670615415.00,60,Antonio,Bonilla,13549.77,AMEX CARD
5215536767108,600670615415.00,60,Israel,Sanchez,13549.77,AMEX CARD
5243122222111,234324324323.00,89,Juan,Gonzalez,214.00,AMEX
5217151136840,600670615415.00,60,Enrique,Ramirez,13549.77,AMEX CARD
5215528921944,600670615415.00,60,Maria,Lopez,13549.77,AMEX CARD
5215512345678,500560505405.00,50,Carlos,Martinez,10000.00,VISA CARD
5215587654321,400450404404.00,45,Laura,Garcia,8500.50,MASTERCARD
5215598765432,300340303303.00,40,Pedro,Rodriguez,7200.25,AMEX GOLD
5215523456789,200230202202.00,35,Sofia,Hernandez,5500.00,VISA PLATINUM
5215534567890,100120101101.00,30,Diego,Fernandez,3800.75,MASTERCARD BLACK
```

**Mensaje de ejemplo para estos contactos:**
```
Hola {{first_name}} {{last_name}}, te contactamos sobre tu crédito {{credit}}. Tu saldo actual es de ${{total_balance}} MXN. Tenemos un descuento especial del {{discount}}% para tu {{product}}. ¿Te gustaría conocer más detalles?
```

**Cómo usar:**
```bash
# Guardar como archivo
cat > contactos-ejemplo.csv << 'EOF'
contact_phone,credit,discount,first_name,last_name,total_balance,product
5215513023544,600670615415.00,60,Antonio,Bonilla,13549.77,AMEX CARD
5215536767108,600670615415.00,60,Israel,Sanchez,13549.77,AMEX CARD
5243122222111,234324324323.00,89,Juan,Gonzalez,214.00,AMEX
5217151136840,600670615415.00,60,Enrique,Ramirez,13549.77,AMEX CARD
5215528921944,600670615415.00,60,Maria,Lopez,13549.77,AMEX CARD
5215512345678,500560505405.00,50,Carlos,Martinez,10000.00,VISA CARD
5215587654321,400450404404.00,45,Laura,Garcia,8500.50,MASTERCARD
5215598765432,300340303303.00,40,Pedro,Rodriguez,7200.25,AMEX GOLD
5215523456789,200230202202.00,35,Sofia,Hernandez,5500.00,VISA PLATINUM
5215534567890,100120101101.00,30,Diego,Fernandez,3800.75,MASTERCARD BLACK
EOF

# Subir al backend con mensaje personalizado
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "'"$(cat contactos-ejemplo.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'",
    "message": "Hola {{first_name}} {{last_name}}, te contactamos sobre tu crédito {{credit}}. Tu saldo actual es de ${{total_balance}} MXN. Tenemos un descuento especial del {{discount}}% para tu {{product}}. ¿Te gustaría conocer más detalles?"
  }'
```

**CSV Resultante (con columna message agregada automáticamente):**
```csv
contact_phone,credit,discount,first_name,last_name,total_balance,product,message
5215513023544,600670615415.00,60,Antonio,Bonilla,13549.77,AMEX CARD,"Hola Antonio Bonilla, te contactamos sobre tu crédito 600670615415.00. Tu saldo actual es de $13549.77 MXN. Tenemos un descuento especial del 60% para tu AMEX CARD. ¿Te gustaría conocer más detalles?"
5215536767108,600670615415.00,60,Israel,Sanchez,13549.77,AMEX CARD,"Hola Israel Sanchez, te contactamos sobre tu crédito 600670615415.00. Tu saldo actual es de $13549.77 MXN. Tenemos un descuento especial del 60% para tu AMEX CARD. ¿Te gustaría conocer más detalles?"
...
```

---

### Ejemplo 3: Script Completo de Configuración

```bash
#!/bin/bash

# Script para configurar una campaña completa con credenciales y contactos

CAMPAIGN="prueba"
AGENT="erick"
BASE_URL="https://ow24p7ablb.execute-api.us-east-1.amazonaws.com"

echo "🚀 Configurando campaña: $CAMPAIGN"
echo "👤 Agente: $AGENT"
echo ""

# 1. Crear y subir credenciales
echo "📝 Paso 1: Creando credenciales..."
cat > credenciales-${CAMPAIGN}.csv << 'EOF'
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
agente2,montana-nevada-alta
supervisor,oceano-azul-profundo
EOF

echo "📤 Subiendo credenciales..."
curl -X POST \
  ${BASE_URL}/credentials/${CAMPAIGN} \
  -H "Content-Type: text/csv" \
  --data-binary @credenciales-${CAMPAIGN}.csv

echo ""
echo "✅ Credenciales subidas"
echo ""

# 2. Crear y subir contactos
echo "📝 Paso 2: Creando contactos..."
cat > contactos-${AGENT}.csv << 'EOF'
contact_phone,credit,discount,first_name,last_name,total_balance,product
5215513023544,600670615415.00,60,Antonio,Bonilla,13549.77,AMEX CARD
5215536767108,600670615415.00,60,Israel,Sanchez,13549.77,AMEX CARD
5243122222111,234324324323.00,89,Juan,Gonzalez,214.00,AMEX
5217151136840,600670615415.00,60,Enrique,Ramirez,13549.77,AMEX CARD
5215528921944,600670615415.00,60,Maria,Lopez,13549.77,AMEX CARD
5215512345678,500560505405.00,50,Carlos,Martinez,10000.00,VISA CARD
5215587654321,400450404404.00,45,Laura,Garcia,8500.50,MASTERCARD
5215598765432,300340303303.00,40,Pedro,Rodriguez,7200.25,AMEX GOLD
5215523456789,200230202202.00,35,Sofia,Hernandez,5500.00,VISA PLATINUM
5215534567890,100120101101.00,30,Diego,Fernandez,3800.75,MASTERCARD BLACK
EOF

echo "📤 Subiendo contactos con mensaje personalizado..."
curl -X POST \
  ${BASE_URL}/supervisors/agents/${AGENT}/${CAMPAIGN}/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "'"$(cat contactos-${AGENT}.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'",
    "message": "Hola {{first_name}} {{last_name}}, te contactamos sobre tu crédito {{credit}}. Tu saldo actual es de ${{total_balance}} MXN. Tenemos un descuento especial del {{discount}}% para tu {{product}}. ¿Te gustaría conocer más detalles?"
  }'

echo ""
echo "✅ Contactos subidos"
echo ""

# 3. Verificar que todo se subió correctamente
echo "🔍 Paso 3: Verificando configuración..."
echo ""
echo "Credenciales:"
curl -X GET ${BASE_URL}/credentials/${CAMPAIGN}
echo ""
echo ""
echo "Contactos:"
curl -X GET ${BASE_URL}/supervisors/agents/${AGENT}/${CAMPAIGN}/contacts
echo ""
echo ""

echo "✅ Configuración completa!"
echo ""
echo "Ahora puedes iniciar el CLI con:"
echo "  Usuario: erick"
echo "  Campaña: prueba"
echo "  Palabra del día: sol-brillante-2024"
```

**Cómo ejecutar el script:**
```bash
# Dar permisos de ejecución
chmod +x setup-campaign.sh

# Ejecutar
./setup-campaign.sh
```

---

**Última actualización**: Diciembre 20, 2024
**Versión**: 1.0.0
