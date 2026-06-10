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
  ${BASE_URL}/credentials/upload \
  -H "Content-Type: application/json" \
  -d '{
    "campaign": "'${CAMPAIGN}'",
    "csv": "'"$(cat credenciales-${CAMPAIGN}.csv | sed ':a;N;$!ba;s/\n/\\n/g')"'"
  }'

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
