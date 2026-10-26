# Spec Delta

## Purpose

Dar a admins y líderes una sección de ANA Admin para buscar y leer, en solo lectura, las conversaciones de cobranza legadas de sus campañas, sin riesgo de ejecutar contenido de los mensajes.

## ADDED Requirements

### Requirement: Sección Historial legacy
ANA Admin SHALL mostrar la sección "Historial legacy" (`/historial-legacy`) en la navegación solo a usuarios con `isAdmin` o `isLeader`; para cualquier otro usuario la sección MUST estar oculta, su URL MUST mostrar "Sin acceso" y las rutas `/api/campaigns/{campaign}/legacy-chats*` del BFF MUST responder 403.

#### Scenario: Agente sin rol de líder
- **WHEN** un usuario sin `isAdmin` ni `isLeader` abre `/historial-legacy`
- **THEN** la app muestra "Sin acceso" y la navegación no incluye "Historial legacy"

#### Scenario: Líder
- **WHEN** un líder inicia sesión
- **THEN** la navegación incluye "Historial legacy"

### Requirement: Búsqueda de conversaciones legadas en la consola
La página SHALL ofrecer un selector de campaña con búsqueda (campañas de `GET /api/campaigns`, catálogo ∩ campañas del usuario), filtros en pills por agente legado, teléfono y rango de fechas, y una tabla paginada con agente, teléfono, número de mensajes y fecha del último mensaje, con Skeleton mientras carga y estado vacío "Sin conversaciones".

#### Scenario: Filtrar por teléfono
- **WHEN** el líder elige `prueba` y filtra por `5512345678`
- **THEN** la tabla muestra solo las conversaciones cuyo teléfono contiene esos dígitos

#### Scenario: Campaña sin historial
- **WHEN** la campaña no tiene conversaciones legadas
- **THEN** la página muestra "Sin conversaciones"

### Requirement: Vista segura de la conversación
Al abrir una conversación, la página SHALL mostrar los mensajes en orden con remitente y fecha/hora en `America/Mexico_City`, y MUST renderizar `body` solo como texto: un contenido con etiquetas HTML o scripts se muestra literal y nunca se interpreta.

#### Scenario: Mensaje con HTML
- **WHEN** un mensaje tiene `body` igual a `<img src=x onerror=alert(1)>`
- **THEN** la página muestra ese texto literal y no crea ningún elemento `img`

#### Scenario: Conversación inexistente
- **WHEN** el backend responde 404
- **THEN** la página muestra "Conversación no encontrada" inline

### Requirement: Multimedia en la conversación
La página SHALL mostrar imágenes, audio y video con la URL prefirmada que entrega el backend y los demás tipos como enlace de descarga; un mensaje con `media: null` MUST mostrar "Multimedia no disponible". Si la URL expiró, la página MUST volver a pedir la conversación al reintentar en lugar de mostrar un error del navegador.

#### Scenario: URL vencida
- **WHEN** el usuario deja la conversación abierta más de 5 minutos y abre una imagen
- **THEN** la página vuelve a pedir la conversación y muestra la imagen con una URL nueva

#### Scenario: Multimedia faltante
- **WHEN** un mensaje trae `media: null`
- **THEN** la página muestra "Multimedia no disponible"
