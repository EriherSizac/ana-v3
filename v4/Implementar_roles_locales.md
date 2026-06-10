# Roles & Permisos — Guía general de implementación

Cómo conectar **cualquier producto** al sistema compartido de Roles & Permisos y\
hacer que respete permisos propios, de cero hasta el almacén de datos. Pensada\
para que cualquier desarrollador (o LLM) la ejecute sin contexto previo. No es\
específica de iMery — iMery aparece solo como **ejemplo de referencia** (§10).

Se apoya en:

- `roles.md` — la **API externa de Roles & Permisos** (roles,\
  jerarquía, catálogo de permisos). Infraestructura **compartida** entre todos\
  los productos.
- `roles-permissions-imery.md` — ejemplo de\
  catálogo de permisos de un producto concreto.

---

## La idea central (léela antes de tocar nada)

Hay **dos responsabilidades separadas**. Mézclalas y nada funciona.

| Responsabilidad | Quién es dueño | Identificador | Compartido |
| --- | --- | --- | --- |
| **Quién es quién**: roles, campaña, jerarquía, asignación usuario→rol | **API externa de Roles** | `role_id` (UUID) | Sí — uno para todos los productos |
| **Qué puede hacer un rol en *tu* producto**: tus permisos | **Tu producto** (su propio almacén) | nombre de permiso (`<módulo>:...`) | No — cada producto el suyo |

La API externa es la **fuente de verdad de identidad/estructura**. Tu producto\
es la **fuente de verdad de sus propios permisos**. Tu app **resuelve el acceso**\
**de un usuario** así:

```
usuario ──(API externa)──> sus role_ids + campañas
   por cada role_id ──(tu almacén local)──> permisos que ese rol tiene en tu producto
   UNION de todo ──────────> { roleIds, campaigns, permissions } efectivos del usuario
```

> El catálogo externo de permisos (`POST /permissions`,\
> `PATCH /roles/{id}/permissions`, con UUIDs) existe para productos que quieran\
> centralizar ahí. **Pero el patrón recomendado y el que sigue iMery es: cada**\
****producto define y almacena sus permisos localmente** (más rápido de cambiar,\
> sin coordinar despliegues con el servicio central, sin acoplarse a UUIDs). El\
> resto de esta guía asume el patrón local.

---

## 0. Decisiones que tomas una vez por producto

Antes de escribir código, define:

1. **Prefijo de módulo** para tus permisos. Formato:\
   `módulo:alcance:recurso:acción`. Ej.: `crm:admin:credits:create`,\
   `imery:chat:message:send`, `billing:owner:invoice:void`.
2. **Tu catálogo de permisos**: la lista cerrada de strings que tu app entiende.\
   Vívela como una constante en código (única fuente para UI + checks + docs).
3. **Tu almacén local de asignaciones rol→permisos**: una tabla/colección\
   indexada por `role_id`. DynamoDB, Postgres, Redis… lo que use tu producto.
4. **Política de scoping por campaña** (si aplica): cómo trata tu app\
   `campaign_name` y el comodín `"*"`.

---

## 1. Coordenadas de la API externa de Roles

|  |  |
| --- | --- |
| Base URL DEV | `https://2egq6rek0a.execute-api.us-east-2.amazonaws.com` |
| Base URL PROD | `https://8emg4wx2t8.execute-api.us-east-2.amazonaws.com` |
| Auth | header `X-Api-Key: <ROLES_API_KEY>` |

Endpoints que vas a usar (detalle completo en `roles.md`):

| Acción | Endpoint |
| --- | --- |
| Crear rol | `POST /roles` |
| Ver un rol | `GET /roles/{role_id}` |
| Crear/editar jerarquía | `POST` / `PUT /roles/hierarchy` |
| Jerarquía de un rol | `GET /roles/{role_id}/hierarchy` |
| Roles de un usuario | `GET /users/{username}` |
| (Opcional) catálogo central | `GET/POST /permissions`, `PATCH /roles/{id}/permissions` |

---

## 2. Flujo completo (de cero a rol funcional en tu producto)

```
1. Crear el rol            → API externa  POST /roles                  → role_id
2. Colgarlo en jerarquía   → API externa  POST /roles/hierarchy        (superior/subordinado)
3. Asignar usuarios al rol → sistema externo / IdP (Cognito, etc.)     (fuera de este doc)
4. Otorgar TUS permisos    → tu almacén local, keyado por role_id      (API propia o write directo)
5. Tu app resuelve acceso  → une los permisos locales de todos los roles del usuario
```

Pasos 1–3 = "generar el rol" (compartido). Paso 4 = "implementarlo en tu\
producto". Paso 5 = lo que codeas una vez y corre solo.

---

## 3. Paso 1 — Crear el rol (API externa)

```bash
BASE=https://2egq6rek0a.execute-api.us-east-2.amazonaws.com   # dev

ROLE_RESPONSE=$(curl -s -X POST "$BASE/roles" \
  -H "X-Api-Key: $ROLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Supervisor BanCoppel",
    "description": "Supervisor de la campaña BanCoppel",
    "section": "crm,dashboard",
    "campaign_name": "bancoppel",
    "has_ip_restriction": true,
    "requires_location_validation": false,
    "requires_2fa": true
  }')

ROLE_ID=$(echo "$ROLE_RESPONSE" | jq -r '.role_id')
echo "role_id=$ROLE_ID"
```

Campos relevantes:

- `campaign_name`: campaña del rol. `"*"` = el rol **ignora** el scoping por\
  campaña (perfiles globales: developer, supervisores cross-campaña). Otro valor\
  = acotado a esa campaña.
- `name`, `description`, `section` y los flags (`has_ip_restriction`,\
  `requires_2fa`, etc.) son obligatorios al crear. `section` y los flags los\
  consume el sistema de auth/IdP; tu producto puede ignorarlos si no aplican.

Respuestas y campos completos: `roles.md`.

---

## 4. Paso 2 — Jerarquía (API externa)

La jerarquía define relaciones superior/subordinado entre roles. Úsala si tu\
producto necesita lógica basada en rango (p. ej. quién puede contactar a quién,\
quién aprueba a quién). Si no la necesitas, puedes omitir este paso — pero\
entonces los roles quedan "sueltos" (`unrelated` entre sí).

```bash
curl -s -X POST "$BASE/roles/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"create\",
    \"role_id\": \"$ROLE_ID\",
    \"reports_to_role_id\": \"<UUID-del-rol-superior>\"
  }"
```

- `reports_to_role_id` = a quién reporta. `null` si es raíz.
- No se permiten ciclos. Para reasignar usa `PUT /roles/hierarchy`(`action: update`).

Cómo consumirla: `GET /roles/{id}/hierarchy` devuelve `hierarchy_up` /\
`hierarchy_down` con `level_up` / `level_down`. De ahí derivas, para cada rol,\
su `depth` (distancia a la raíz), sus `ancestors` y `descendants`. Para comparar\
dos usuarios, compara el **rol de mayor jerarquía** (menor `depth`) de cada uno →\
`superior` / `inferior` / `peer` / `unrelated`. (Implementación de referencia:\
§10.)

---

## 5. Paso 4 — Otorgar TUS permisos (almacén local) — el patrón

Este es el paso que hace que **tu producto** respete el rol. El patrón, en\
abstracto:

1. **Define tu catálogo** como constante en código. Ejemplo genérico:

   ```ts
   export const MY_PERMISSIONS = {
     ITEM_CREATE: 'myapp:core:item:create',
     ITEM_DELETE: 'myapp:core:item:delete',
     REPORT_VIEW: 'myapp:reports:report:view',
   } as const;
   ```

   Esta constante es la **única** fuente: la usan la UI, los checks del backend y\
   la documentación. Nada de strings sueltos regados por el código.

2. **Guarda las asignaciones rol→permisos** en tu almacén, **keyadas por**\
   `role_id`, con los **nombres** de permiso (no UUIDs). Forma mínima del\
   registro:

   ```jsonc
   {
     "roleId": "<uuid>",
     "roleName": "Supervisor BanCoppel",   // opcional, etiqueta para UI
     "permissions": ["myapp:core:item:create", "myapp:reports:report:view"],
     "updatedAt": "2026-06-05T12:00:00.000Z"
   }
   ```

   Semántica de escritura: **reemplazo total** (la lista enviada es la lista\
   final; incluye todo lo que debe quedar). Deduplica al guardar.

3. **Exponlo de dos maneras** (elige según quién escribe):

   - **API propia con auth de admin** — para la UI de administración y operación\
     normal. Debe invalidar caché al escribir (paso 6).
   - **Escritura directa al almacén** — para seeds, migraciones, infra, sin\
     sesión de admin.

### Genérico: tabla SQL (ejemplo)

```sql
CREATE TABLE role_permissions (
  role_id     uuid PRIMARY KEY,
  role_name   text,
  permissions text[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- upsert (reemplazo total)
INSERT INTO role_permissions (role_id, role_name, permissions, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (role_id)
DO UPDATE SET role_name = EXCLUDED.role_name,
              permissions = EXCLUDED.permissions,
              updated_at = now();
```

### Genérico: store key-value / DynamoDB

Elige un patrón de clave estable y documéntalo. Lo importante: poder **leer por**\
`role_id` en O(1). Ejemplo (el de iMery, single-table DynamoDB):

| Atributo | Valor |
| --- | --- |
| `PK` | `"ROLEPERMS"` (constante) |
| `SK` | `"ROLE#<roleId>"` |
| `roleId` | `<roleId>` |
| `roleName` | etiqueta opcional |
| `permissions` | lista de **nombres** de permiso, sin duplicados |
| `updatedAt` | ISO 8601 |

```bash
aws dynamodb put-item --table-name "$TABLE" --item '{
  "PK":          {"S": "ROLEPERMS"},
  "SK":          {"S": "ROLE#'"$ROLE_ID"'"},
  "roleId":      {"S": "'"$ROLE_ID"'"},
  "roleName":    {"S": "Supervisor BanCoppel"},
  "permissions": {"L": [
    {"S": "myapp:core:item:create"},
    {"S": "myapp:reports:report:view"}
  ]},
  "updatedAt":   {"S": "2026-06-05T12:00:00.000Z"}
}'
```

> Mantén el patrón de clave **idéntico** entre quien escribe y quien lee, o la\
> lectura no encontrará el registro.

---

## 6. Paso 5 — Resolver el acceso en runtime (el patrón)

Codéalo una vez. Entrada: `username`. Salida: el acceso efectivo del usuario.

```
resolveUserAccess(username):
  1. cache hit?  → devuélvelo            (caché en 2 capas, ver abajo)
  2. miss        → GET /users/{username} (API externa) → roles[] + campañas
  3. por cada role.role_id → lee permisos de TU almacén local
  4. resultado = {
       username,
       roleIds:   roles.map(role_id),
       roleNames: roles.map(role_name),
       campaigns: unión de role.campaign_name,
       permissions: UNIÓN de los permisos locales de todos sus roles,
     }
  5. escribe caché y devuelve
  6. si la API externa falla → sirve caché stale en vez de denegar
```

Checas con `access.permissions.includes('myapp:core:item:create')` en backend y\
UI.

### Caché (recomendado, 2 capas)

- **L1 en memoria** del proceso/contenedor (TTL corto, \~15 s) — fast path.
- **L2 compartida** (DynamoDB/Redis, TTL \~15 min) — para que todos los\
  contenedores reúsen una sola llamada externa. Idealmente con TTL nativo que\
  recolecte entradas viejas.

### Invalidación (crítico)

Cuando cambian los permisos de un rol, los usuarios con ese rol tienen acceso\
cacheado. Dos caminos:

- **Vía tu API de admin**: tras escribir, **invalida** el caché de todos los\
  usuarios con ese `role_id` (búscalos en la caché L2 y bórralos) y, si tienes\
  realtime, emite un evento (`permissions.update`) para que los clientes\
  recarguen en segundos.
- **Vía escritura directa**: no invalida nada. O borras las entradas de caché a\
  mano, o esperas a que expire el TTL (≤15 min).

---

## 7. Scoping por campaña (si tu producto lo usa)

`campaign_name` viene de la API externa por rol. Patrón típico:

- Rol con `campaign_name = "*"` → acceso cross-campaña total (ignora el filtro).
- Rol con campaña específica → solo opera dentro de su campaña, **salvo** que\
  tenga un permiso explícito de cruce (define el tuyo, p. ej.\
  `myapp:core:resource:cross_campaign`).

Decide tu política y aplícala en los checks junto a `permissions`.

---

## 8. Feature flag de enforcement (muy recomendado)

Despliega el código de enforcement **apagado** y enciéndelo cuando esté\
validado. Sin el flag, un bug de permisos te bloquea a todos en producción.

- Flag de backend (idealmente toggleable sin redeploy: config en DB/SSM).
- Flag espejo en el front para no ocultar/inhabilitar UI antes de tiempo.
- Cada check hace **early-return "permitir"** cuando el flag está off.
- Para activar: ambos a `true` por stage, sincronizados (UI y backend).

---

## 9. Checklist (para ejecutar la tarea)

- \[ \] Definiste prefijo de módulo, catálogo (constante en código) y almacén local.
- \[ \] **Crear rol**: `POST /roles` → guarda `role_id`. `campaign_name` correcto.
- \[ \] **Jerarquía** (si aplica): `POST /roles/hierarchy` con `reports_to_role_id`.
- \[ \] **Asignar usuarios** al rol (IdP / sistema externo).
- \[ \] **Permisos** sobre el `role_id`, usando **nombres** del catálogo (no UUIDs):
  - \[ \] API de admin propia, o
  - \[ \] escritura directa al almacén (seed/infra).
- \[ \] Implementaste `resolveUserAccess` (unión de permisos locales por rol) + caché.
- \[ \] Implementaste invalidación de caché al cambiar permisos.
- \[ \] Si escribiste directo, invalidaste caché o esperaste el TTL.
- \[ \] Flag de enforcement en el estado deseado.

---

## 10. Ejemplo de referencia: iMery

iMery es una implementación concreta de este patrón. Úsala como plantilla.

| Pieza del patrón | Dónde está en iMery |
| --- | --- |
| Catálogo (constante) | `IMERY_PERMISSIONS` en `packages/shared/src/permissions.ts` |
| Almacén local | DynamoDB `imery-<stage>-main`, `PK=ROLEPERMS`, `SK=ROLE#{roleId}` |
| Helper de escritura | `setRolePermissions()` — `apps/api/src/lib/repos/rolePerms.ts` |
| Helper de lectura | `getRolePermissions()` — mismo archivo |
| Resolver acceso + caché | `resolveUserAccess()` — `apps/api/src/lib/rolesApi.ts` (L1 memoria 15s, L2 DynamoDB 15min) |
| Invalidación | `invalidateAccessByRole()` + evento realtime `permissions.update` |
| API de admin | `PUT /admin/role-permissions/{roleId}` (servicio `api-admin`, auth JWT admin) |
| UI de admin | Settings → Admin → "Permisos por rol" (`/admin/role-permissions`) |
| Jerarquía | `getRoleHierarchy()` / `hierarchyRelation()` — `rolesApi.ts` |
| Scoping campaña | comodín `"*"` + permisos `*:cross_campaign` |
| Feature flag | `PERMISSIONS_ENFORCED` (backend) + `NEXT_PUBLIC_PERMISSIONS_ENFORCED` (web) |

Catálogo de permisos de iMery (ejemplo de cómo se ve uno real):

| Permiso | Capacidad |
| --- | --- |
| `imery:chat:group:create` | Crear grupos |
| `imery:chat:member:add` | Agregar miembros a un grupo |
| `imery:chat:message:send` | Enviar mensajes (base) |
| `imery:chat:message:cross_campaign` | Escribir a conversación de otra campaña |
| `imery:chat:dm:cross_campaign` | Iniciar DM con usuario de otra campaña |
| `imery:chat:call:start` | Iniciar llamada voz/video |
| `imery:chat:broadcast:send` | Enviar broadcast administrativo |

Detalle de qué gatea cada uno y reglas de jerarquía/solicitudes:\
`roles-permissions-imery.md`.

---

## 11. Errores comunes (no los cometas)

- ❌ Mezclar las dos fuentes de verdad: meter permisos de producto en la API\
  externa esperando que tu app los lea, o roles en tu almacén local.
- ❌ Guardar **UUIDs** de permiso en tu almacén local. Guarda **nombres**(`módulo:...`); son los que comparas en los checks.
- ❌ Patrón de clave inconsistente entre escritura y lectura del almacén.
- ❌ No cachear → una llamada externa por request (lento y frágil).
- ❌ Cachear sin invalidar → cambios de permisos que tardan en aplicar o no\
  aplican.
- ❌ Escribir directo al almacén y esperar efecto inmediato sin invalidar caché.
- ❌ Olvidar la jerarquía cuando tu lógica depende de rango → relaciones\
  `unrelated`.
- ❌ Encender enforcement sin flag y sin validar → bloqueo masivo en producción.

---

## 12. Referencia completa de la API externa de Roles

Documentación íntegra de la API compartida (espejo de `roles.md`),\
para que esta guía sea autocontenida. **Base URLs** y auth en §1.

> Todos los endpoints requieren `X-Api-Key: <ROLES_API_KEY>` y, en POST/PATCH/PUT,\
> `Content-Type: application/json`.

### Índice

- [Roles](#roles): `GET /roles/{role_id}`, `POST /roles`, `PATCH /roles/{role_id}`
- [Permisos (catálogo central)](#permisos-cat%C3%A1logo-central): `GET /permissions`, `POST /permissions`, `PATCH /permissions/{permission_id}`
- [Permisos de roles (central)](#permisos-de-roles-central): `GET /roles/{role_id}/permissions`, `PATCH /roles/{role_id}/permissions`
- [Jerarquías](#jerarqu%C3%ADas): `GET /roles/hierarchy`, `GET /roles/{role_id}/hierarchy`, `POST /roles/hierarchy`, `PUT /roles/hierarchy`
- [Usuarios](#usuarios): `GET /users/{username}`

---

### Roles

#### `GET /roles/{role_id}`

Obtiene un rol y sus roles relacionados en la jerarquía.

```bash
curl -X GET "$BASE/roles/c288ee3e-da7b-43aa-8ed1-0c56355a2bfd" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json"
```

Response `200`:

```json
{
  "roles": [
    {
      "id": "f8ebb710-5709-4b32-9829-0615151ed320",
      "name": "Agente BanCoppel",
      "description": "Agente del CRM para la campaña de BanCoppel",
      "section": "crm",
      "campaign_name": "bancoppel",
      "has_ip_restriction": true,
      "requires_location_validation": false,
      "requires_2fa": false
    }
  ]
}
```

Campos: `id` (UUID), `name`, `description`, `section` (`"*"` = todas),\
`campaign_name` (`"*"` = todas), `has_ip_restriction`,\
`requires_location_validation`, `requires_2fa` (booleans).

#### `POST /roles`

Crea un rol.

```bash
curl -X POST "$BASE/roles" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Test Role API",
    "description": "Role de prueba",
    "section": "dashboard",
    "campaign_name": "*",
    "has_ip_restriction": false,
    "requires_location_validation": false,
    "requires_2fa": false
  }'
```

Requeridos: `name`, `description`, `section`, `campaign_name`,\
`has_ip_restriction`, `requires_location_validation`, `requires_2fa`.

Response `200`:

```json
{ "message": "Rol creado exitosamente", "role_id": "bb15a3e5-3a0b-4e62-9d93-eeefc09509ce" }
```

#### `PATCH /roles/{role_id}`

Actualiza un rol. Envía solo los campos a cambiar.

```bash
curl -X PATCH "$BASE/roles/bb15a3e5-3a0b-4e62-9d93-eeefc09509ce" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "description": "Actualizado", "requires_2fa": true }'
```

Opcionales: `name`, `description`, `section`, `campaign_name`,\
`has_ip_restriction`, `requires_location_validation`, `requires_2fa`.

Response `200`:

```json
{
  "message": "Rol actualizado exitosamente",
  "role_id": "bb15a3e5-3a0b-4e62-9d93-eeefc09509ce",
  "mfa_sync_status": "No hay usuarios activos para sincronizar"
}
```

`mfa_sync_status`: al cambiar `requires_2fa`, intenta sincronizar MFA con los\
usuarios del rol.

---

### Permisos (catálogo central)

> Catálogo central opcional, basado en UUIDs. **Si sigues el patrón local de**\
****esta guía (recomendado), no lo necesitas** — tu producto guarda sus permisos\
> por nombre en su propio almacén (§5). Documentado por completitud.

#### `GET /permissions`

```bash
curl -X GET "$BASE/permissions" -H "X-Api-Key: $ROLES_API_KEY"
```

Response `200`:

```json
{
  "permissions": [
    {
      "id": "ada7ae2b-73ae-42a3-91e9-9b22b8346be4",
      "name": "ai_voice:admin:call_agent:create",
      "description": "Permite crear un nuevo perfil de call agent."
    }
  ]
}
```

#### `POST /permissions`

```bash
curl -X POST "$BASE/permissions" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "name": "test:api:documentation:read", "description": "Permiso de prueba" }'
```

Requeridos: `name` (formato `módulo:alcance:recurso:acción`), `description`.

Response `200`:

```json
{ "message": "Permiso creado exitosamente", "permission_id": "de0cde0b-8024-4e6e-84c9-2d1e2a44acad" }
```

#### `PATCH /permissions/{permission_id}`

```bash
curl -X PATCH "$BASE/permissions/de0cde0b-8024-4e6e-84c9-2d1e2a44acad" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "description": "Permiso actualizado" }'
```

Opcionales: `name`, `description`. Response `200` con `permission_id`.

---

### Permisos de roles (central)

> También parte del catálogo central por UUIDs. El patrón local (§5) reemplaza\
> esto con tu propio almacén.

#### `GET /roles/{role_id}/permissions`

```bash
curl -X GET "$BASE/roles/bb15a3e5-3a0b-4e62-9d93-eeefc09509ce/permissions" \
  -H "X-Api-Key: $ROLES_API_KEY"
```

Response `200`: `{ "permissions": [ { "id", "name", "description" }, ... ] }`.

#### `PATCH /roles/{role_id}/permissions`

Reemplaza **por completo** los permisos del rol (array de UUIDs).

```bash
curl -X PATCH "$BASE/roles/bb15a3e5-3a0b-4e62-9d93-eeefc09509ce/permissions" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "permissions": ["de0cde0b-8024-4e6e-84c9-2d1e2a44acad", "ada7ae2b-73ae-42a3-91e9-9b22b8346be4"] }'
```

Requerido: `permissions` (array de UUIDs). Para **agregar** uno, incluye todos\
los existentes + el nuevo.

Response `200`:

```json
{
  "message": "Permisos actualizados exitosamente",
  "role_id": "bb15a3e5-3a0b-4e62-9d93-eeefc09509ce",
  "permissions": ["de0cde0b-8024-4e6e-84c9-2d1e2a44acad", "ada7ae2b-73ae-42a3-91e9-9b22b8346be4"]
}
```

---

### Jerarquías

#### `GET /roles/hierarchy`

Jerarquía completa (vista básica).

```bash
curl -X GET "$BASE/roles/hierarchy" -H "X-Api-Key: $ROLES_API_KEY"
```

Response `200`:

```json
{
  "message": "Jerarquía obtenida exitosamente",
  "view_type": "basic",
  "data": {
    "hierarchy": [
      {
        "subordinate_role": {
          "id": "885fb2a8-3f98-40c0-b0f5-fcf6b1d09f6d",
          "name": "Gerente BanCoppel",
          "description": "Gerente de BanCoppel",
          "section": "crm,dashboard",
          "campaign_name": "bancoppel"
        },
        "superior_role": {
          "id": "c288ee3e-da7b-43aa-8ed1-0c56355a2bfd",
          "name": "Developer",
          "description": "Perfil de desarrollador dev",
          "section": "*",
          "campaign_name": "*"
        },
        "hierarchy_created_at": "2025-07-07T19:35:37.845868",
        "hierarchy_updated_at": "2025-07-07T19:35:37.845868"
      }
    ]
  }
}
```

#### `GET /roles/{role_id}/hierarchy`

Jerarquía ascendente y descendente de un rol. **Este es el endpoint que consume**\
**tu app** para derivar `depth`/`ancestors`/`descendants` (§4).

```bash
curl -X GET "$BASE/roles/c288ee3e-da7b-43aa-8ed1-0c56355a2bfd/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY"
```

Response `200` (abreviado):

```json
{
  "message": "Jerarquía del rol obtenida exitosamente",
  "data": {
    "role_id": "c288ee3e-da7b-43aa-8ed1-0c56355a2bfd",
    "base_role": { "id": "...", "name": "Developer", "campaign_name": "*" },
    "hierarchy_up": [
      { "id": "...", "name": "Developer", "level_up": 0, "path_up": "Developer", "relationship_type": "self" }
    ],
    "hierarchy_down": [
      { "id": "...", "name": "Prueba", "level_down": 1, "path_down": "Developer -> Prueba", "relationship_type": "subordinate" },
      { "id": "...", "name": "Agente BanCoppel", "level_down": 2, "path_down": "Developer -> Gerente BanCoppel -> Agente BanCoppel", "relationship_type": "subordinate" }
    ],
    "summary": { "supervisors_count": 0, "subordinates_count": 5, "direct_users_count": 6, "total_hierarchy_size": 6 }
  }
}
```

Claves para tu lógica:

- `hierarchy_up[*].level_up` — niveles hacia arriba (0 = self). `depth` del rol =\
  máximo `level_up`.
- `hierarchy_down[*].level_down` — niveles hacia abajo (1 = subordinado directo).
- `ancestors` = ids con `level_up > 0`; `descendants` = ids con `level_down > 0`.

#### `POST /roles/hierarchy`

Multi-acción vía campo `action`.

`action: create` — crea relación:

```bash
curl -X POST "$BASE/roles/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "action": "create", "role_id": "<sub>", "reports_to_role_id": "<sup>" }'
```

Requeridos: `action`, `role_id` (subordinado), `reports_to_role_id` (superior,\
o `null`). Validaciones: sin ciclos; ambos roles existen; el subordinado no debe\
tener ya una relación. Response `200` con `data.hierarchy_id`.

`action: info` — info de la relación:

```bash
curl -X POST "$BASE/roles/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "action": "info", "role_id": "<id>" }'
```

Devuelve `role_name`, `role_description`, `reports_to_name`,\
`reports_to_description`, `created_at`, `updated_at`.

`action: remove` — elimina la relación (el rol deja de reportar):

```bash
curl -X POST "$BASE/roles/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "action": "remove", "role_id": "<id>" }'
```

Response `200` con `data.removed: true`.

#### `PUT /roles/hierarchy`

`action: update` — reasigna el superior de un rol:

```bash
curl -X PUT "$BASE/roles/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{ "action": "update", "role_id": "<sub>", "reports_to_role_id": "<nuevo-sup>" }'
```

Requeridos: `action`, `role_id`, `reports_to_role_id` (o `null`). Validaciones:\
sin ciclos; ambos existen; el subordinado **debe** tener ya una relación.\
Response `200` con `data.hierarchy_id`.

---

### Usuarios

#### `GET /users/{username}`

Devuelve el usuario con sus roles. **Este es el endpoint que tu**\
`resolveUserAccess` **llama** (§6) para mapear usuario → roles + campañas.

```bash
curl -X GET "$BASE/users/ana.lopez" -H "X-Api-Key: $ROLES_API_KEY"
```

Forma relevante de la respuesta (cada rol trae al menos `role_id`, `role_name`,\
`campaign_name`):

```json
{
  "username": "ana.lopez",
  "roles": [
    { "role_id": "f8ebb710-5709-4b32-9829-0615151ed320", "role_name": "Agente BanCoppel", "campaign_name": "bancoppel" }
  ]
}
```

Un usuario puede tener **varios** roles → tu app une (`UNION`) los permisos\
locales de todos (§6).

---

### Códigos de error comunes

| Código | Significado |
| --- | --- |
| `400` | Parámetros faltantes o inválidos |
| `401` | API Key inválida o faltante |
| `404` | Recurso no encontrado |
| `405` | Método HTTP no permitido para el endpoint |
| `500` | Error interno del servidor |

### Notas de la API externa

1. **Jerarquías**: el sistema previene ciclos.
2. **Permisos centrales**: `PATCH /roles/{id}/permissions` **reemplaza** todo;\
   incluye siempre la lista completa deseada.
3. **Formato de permisos**: `módulo:alcance:recurso:acción`(ej. `crm:admin:credits:create`).
4. **Sync MFA**: cambiar `requires_2fa` intenta sincronizar con los usuarios del\
   rol.
5. **Acciones de jerarquía** (`POST`/`PUT /roles/hierarchy`): `create`,\
   `update`, `remove`, `info` vía el campo `action`.

### Ejemplo end-to-end (crear rol + jerarquía, patrón local para permisos)

```bash
BASE=https://2egq6rek0a.execute-api.us-east-2.amazonaws.com

# 1. Crear el rol
ROLE_ID=$(curl -s -X POST "$BASE/roles" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Supervisor de Ventas", "description": "Supervisor del equipo",
    "section": "crm,dashboard", "campaign_name": "ventas",
    "has_ip_restriction": true, "requires_location_validation": true, "requires_2fa": true
  }' | jq -r '.role_id')

# 2. Colgarlo en la jerarquía
curl -s -X POST "$BASE/roles/hierarchy" \
  -H "X-Api-Key: $ROLES_API_KEY" -H "Content-Type: application/json" \
  -d "{ \"action\": \"create\", \"role_id\": \"$ROLE_ID\", \"reports_to_role_id\": \"c288ee3e-da7b-43aa-8ed1-0c56355a2bfd\" }"

# 3. (usuarios) asignados vía IdP / sistema externo
# 4. Permisos de TU producto → tu almacén local, por nombre (ver §5), NO el catálogo central.
```