# 📋 Guía para Supervisores - Gestión de Campañas

## 🎯 Endpoints Disponibles

### 1. Gestión de Credenciales por Campaña

#### 📤 Subir CSV de Credenciales
Sube un CSV con usuarios y sus palabras del día para una campaña.

**Endpoint:**
```
POST /credentials/{campaign}
```

**Formato del CSV:**
```csv
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
agente2,viento-suave-primavera
```

**Ejemplo con curl:**
```bash
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/prueba \
  -H "Content-Type: text/csv" \
  --data-binary @credenciales.csv
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Credenciales subidas correctamente",
  "data": {
    "campaign": "prueba",
    "key": "agents/prueba/credentials.csv",
    "usersCount": 4,
    "timestamp": "2024-12-19T20:00:00.000Z"
  }
}
```

---

#### 📥 Obtener CSV de Credenciales
Descarga el CSV de credenciales actual de una campaña.

**Endpoint:**
```
GET /credentials/{campaign}
```

**Ejemplo con curl:**
```bash
curl https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/prueba
```

**Respuesta:**
```csv
user,dailyPassword
erick,sol-brillante-2024
admin,luna-plateada-noche
agente1,estrella-fugaz-cielo
```

---

#### 🔄 Regenerar Palabras del Día
Genera nuevas palabras aleatorias para todos los usuarios de una campaña.

**Endpoint:**
```
POST /credentials/{campaign}/regenerate
```

**Ejemplo con curl:**
```bash
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/prueba/regenerate
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Palabras del día regeneradas correctamente",
  "data": {
    "campaign": "prueba",
    "updatesCount": 4,
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
      }
    ],
    "timestamp": "2024-12-19T20:00:00.000Z"
  }
}
```

---

### 2. Gestión de Contactos de Agentes

#### 📤 Subir CSV de Contactos
Sube un CSV con los contactos asignados a un agente específico y el mensaje que se enviará.

**Endpoint:**
```
POST /supervisors/agents/{agent}/{campaign}/contacts
```

**Formato del Request (JSON):**
```json
{
  "csv": "phone,first_name,credit,total_balance,discount,product\n5215513023544,Juan,12345,5000,10,Producto A\n5215513023545,María,12346,3000,15,Producto B",
  "message": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}. Descuento: {{discount}}%. Producto: {{product}}."
}
```

**Formato del CSV (sin columna message):**
```csv
phone,first_name,credit,total_balance,discount,product
5215513023544,Juan,12345,5000,10,Producto A
5215513023545,María,12346,3000,15,Producto B
```

**El sistema agregará automáticamente la columna `message` a cada fila.**

**Ejemplo con curl:**
```bash
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "phone,first_name,credit,total_balance,discount,product\n5215513023544,Juan,12345,5000,10,Producto A\n5215513023545,María,12346,3000,15,Producto B",
    "message": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}."
  }'
```

**Respuesta:**
```json
{
  "success": true,
  "message": "CSV subido correctamente con mensaje agregado",
  "data": {
    "agent": "erick",
    "campaign": "prueba",
    "key": "agents/prueba/erick-contacts.csv",
    "contactCount": 2,
    "messageAdded": "Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}...",
    "timestamp": "2024-12-19T20:00:00.000Z"
  }
}
```

**CSV Resultante en S3:**
```csv
phone,first_name,credit,total_balance,discount,product,message
5215513023544,Juan,12345,5000,10,Producto A,"Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}."
5215513023545,María,12346,3000,15,Producto B,"Hola {{first_name}}, te contactamos sobre tu crédito {{credit}}. Saldo: ${{total_balance}}."
```

---

#### 📥 Obtener CSV de Contactos
Descarga el CSV de contactos de un agente.

**Endpoint:**
```
GET /supervisors/agents/{agent}/{campaign}/contacts
```

**Ejemplo con curl:**
```bash
curl https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/erick/prueba/contacts
```

**Respuesta:**
```csv
phone,first_name,credit,total_balance,discount,product
5215513023544,Juan,12345,5000,10,Producto A
5215513023545,María,12346,3000,15,Producto B
```

---

## 🔐 Flujo de Autenticación

### Cómo Funciona:

1. **Supervisor crea CSV de credenciales** para una campaña
2. **Sube el CSV** usando `POST /credentials/{campaign}`
3. **Agentes inician sesión** con su usuario, campaña y palabra del día
4. **Backend verifica** contra el CSV de la campaña en S3
5. **Supervisor puede regenerar** palabras diariamente con `/regenerate`

### Estructura en S3:

```
ana-backend-storage-dev/
└── agents/
    ├── prueba/
    │   ├── credentials.csv          # Credenciales de la campaña
    │   ├── erick-contacts.csv       # Contactos de erick
    │   └── admin-contacts.csv       # Contactos de admin
    ├── ventas/
    │   ├── credentials.csv
    │   ├── agente1-contacts.csv
    │   └── agente2-contacts.csv
    └── cobranza/
        ├── credentials.csv
        └── agente3-contacts.csv
```

---

## 📝 Ejemplos de Uso

### Ejemplo 1: Configurar Nueva Campaña

```bash
# 1. Crear CSV de credenciales
cat > credenciales-ventas.csv << EOF
user,dailyPassword
vendedor1,montana-nevada-alta
vendedor2,rio-cristalino-fluye
supervisor,bosque-verde-espeso
EOF

# 2. Subir credenciales
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/ventas \
  -H "Content-Type: text/csv" \
  --data-binary @credenciales-ventas.csv

# 3. Subir contactos para vendedor1
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/vendedor1/ventas/contacts \
  -H "Content-Type: text/csv" \
  --data-binary @contactos-vendedor1.csv
```

### Ejemplo 2: Cambiar Palabras Diariamente

```bash
# Regenerar todas las palabras de la campaña
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/ventas/regenerate

# Ver las nuevas palabras
curl https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/credentials/ventas
```

### Ejemplo 3: Actualizar Contactos de un Agente

```bash
# Descargar CSV actual
curl https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/vendedor1/ventas/contacts \
  > contactos-actuales.csv

# Editar el CSV (agregar/quitar contactos)
nano contactos-actuales.csv

# Subir CSV actualizado
curl -X POST \
  https://ow24p7ablb.execute-api.us-east-1.amazonaws.com/supervisors/agents/vendedor1/ventas/contacts \
  -H "Content-Type: text/csv" \
  --data-binary @contactos-actuales.csv
```

---

## 🎨 Frases Disponibles para Palabras del Día

El sistema genera automáticamente frases de 5+ caracteres:

- `sol-brillante-2024`
- `luna-plateada-noche`
- `estrella-fugaz-cielo`
- `viento-suave-primavera`
- `oceano-azul-profundo`
- `montana-nevada-alta`
- `rio-cristalino-fluye`
- `bosque-verde-espeso`
- Y 22 más...

---

## ⚠️ Notas Importantes

1. **Seguridad**: Las credenciales se almacenan en S3, no en código
2. **Palabras del día**: Deben tener al menos 5 caracteres
3. **Formato CSV**: Debe incluir header `user,dailyPassword`
4. **Case insensitive**: Los usuarios se convierten a minúsculas
5. **Regeneración**: Cambia TODAS las palabras de la campaña
6. **Backup**: Descarga el CSV antes de regenerar por seguridad

---

## 🚀 Desplegar Backend

```bash
cd ana-backend
npm install
serverless deploy
```

---

## 📞 Soporte

Si tienes problemas:
1. Verifica que el CSV tenga el formato correcto
2. Revisa los logs de CloudWatch
3. Confirma que la campaña existe
4. Verifica permisos de S3
