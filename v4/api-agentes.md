# API de agentes (telefonomanual)

Cómo el motor obtiene los **agentes activos** de una campaña para repartir los
contactos del canal `telefonomanual`. Fuente: el dashboard (imery).

Implementado en
[`src/master/src/handlers/plannedMaster.ts`](../src/master/src/handlers/plannedMaster.ts)
dentro de `processChannelUpload` (rama `action === "telefonomanual"`).

---

## 1. Endpoint

```
GET {DASHBOARD_BASE_PATH}/users/campaign/{campaign_name}
```

| Parte | Valor |
|-------|-------|
| `DASHBOARD_BASE_PATH` | env de la lambda `plannedMaster`. Prod: `https://8emg4wx2t8.execute-api.us-east-2.amazonaws.com` |
| `{campaign_name}` | nombre de la campaña (URL-encoded), ej. `bancoppel` |

### Headers

```
X-Api-Key: 6706bb8ef958b3f12759c471855f9aa50b357f78e2d1eee0c533b94daec11a38
```

> ⚠️ La API key está **hardcodeada** en el handler (y en el registro de
> asignación). Pendiente moverla a env (`DASHBOARD_API_KEY`).

---

## 2. Respuesta esperada

```jsonc
{
  "users": [
    {
      "username": "agente.uno",
      "email": "agente.uno@externo.com",
      "active": true,
      "roles": [
        { "id": "3fa70ebd-dc2c-4ec6-9ff9-bc42489f950d", "name": "AGENTE ZENDERE" }
      ]
    }
  ]
}
```

Campos usados por el motor: `username` (o `user_id`), `email`, `active`,
`roles[].id`, `roles[].name`.

Si la respuesta no es `2xx`, el motor lanza error y el canal `telefonomanual`
falla esa corrida.

---

## 3. Filtro de "agente elegible"

Un agente pasa solo si cumple **las tres**:

1. **Activo** — `active === true`.
2. **Email no interno** — el email NO contiene `@pernexium.com.mx` ni `@dirsa`.
3. **Rol requerido** (por campaña) — si la campaña tiene un rol configurado, el
   agente debe traerlo en `roles[].id`. Campañas sin rol configurado **no**
   exigen rol (basta activo + email externo).

Razones de rechazo registradas (`rejection_counts`): `inactive`,
`excluded_email_pattern`, `missing_required_role`.

### Rol por campaña

```ts
const ROLE_BY_CAMPAIGN = {
  zendere: "3fa70ebd-dc2c-4ec6-9ff9-bc42489f950d", // AGENTE ZENDERE
};
```

- Override por campaña con env: `TELEFONOMANUAL_ROLE_<CAMPAÑA_MAYÚS>`
  (ej. `TELEFONOMANUAL_ROLE_BANCOPPEL=<role_id>`).
- Campaña sin entrada ni env → sin filtro de rol.

Si **ningún** agente queda elegible, el canal lanza:

```
No eligible agents (active + <required role|any role> + non-pernexium email)
for campaign <campaign> (telefonomanual)
```

---

## 4. Qué se hace con los agentes elegibles

1. Los contactos de la hora se reparten **equitativamente** entre los agentes
   (round-robin por bloques).
2. Se arma un XLSX con una fila por contacto y la columna **`AGENTE`** asignada.
3. Se sube a S3:
   ```
   {TELEFONOMANUAL_BUCKET|BUCKET_NAME}/raw/{campaign}/supervisor_agent_assignments/{YYYY_MM}/{ts}_assignment.xlsx
   ```
4. Se registra la asignación en el CRM:
   ```
   POST {CRM_BASE_PATH}/supervisor-agent-assignment
   header: X-Api-Key: 6706bb8e...11a38
   body: { supervisor_user_id, campaign_id, file_url, allowed_attempts }
   ```

---

## 5. Variables de entorno relevantes

| Env | Uso |
|-----|-----|
| `DASHBOARD_BASE_PATH` | base del endpoint de agentes |
| `CRM_BASE_PATH` | base para registrar la asignación |
| `TELEFONOMANUAL_BUCKET` | bucket de los archivos de asignación (fallback `BUCKET_NAME`) |
| `TELEFONOMANUAL_SUPERVISOR_USER_ID` | supervisor por defecto del registro |
| `TELEFONOMANUAL_ROLE_<CAMPAÑA>` | (opcional) rol requerido por campaña |

---

## 6. Notas

- **"iMery"** en comentarios del código se refiere al sistema de
  **notificaciones** (`notifyExternal` → `NOTIFY_URL`), no a los agentes.
- Los endpoints `/supervisors/agents/{agente}/{campaña}/contacts` (en master.ts
  y la rama whatsapp de plannedMaster) **empujan** contactos a un agente; no
  obtienen la lista de activos.
- Pendientes sugeridos: mover las API keys hardcodeadas a env y extraer la
  obtención/filtrado de agentes a una función reusable.
