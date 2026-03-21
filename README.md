# WhatsApp Bridge Service (LuxiSoft)

Servicio puente para autenticacion por WhatsApp entre multiples proyectos (`project_key`) y usuarios finales.

## Flujo de autenticacion (sin BD)

Flujo actual de bridge auth:
1. Proyecto X envia `POST /api/bridge/webhooks/request` con `phone_e164`.
2. El bridge genera un OTP de **6 digitos** en memoria (TTL + intentos maximos).
3. El bridge envia el codigo al WhatsApp del usuario (Cloud API).
4. El bridge envia callback firmado `bridge.session.requested` al `callback_url` del proyecto, incluyendo `session.id` y `session.code`.
5. Usuario ingresa el codigo en el sistema del proyecto X.
6. Proyecto X envia `POST /api/bridge/webhooks/verify` con `session_id` y `code`.
7. El bridge valida el codigo en memoria y responde resultado.
8. Si verifica, el bridge envia callback firmado `bridge.session.verified` al proyecto.

Importante:
- Este flujo de autenticacion **no persiste sesiones/codigos en base de datos**.
- La integracion entre proyectos se hace por webhooks firmados (`x-bridge-signature`).

## Estructura de agentes

- Orquestador principal: `agents/luxisoft/scripts/*` y `agents/luxisoft/luxisoft.txt`.
- Agentes por proyecto: `agents/<proyecto>/scripts/*` y `agents/<proyecto>/<proyecto>.txt`.

## Variables de entorno

Copiar `.env.example` a `.env` y configurar:

- Base:
  - `PORT`, `HOST`, `LOG_LEVEL`
  - `CORS_ORIGIN`
- WhatsApp Cloud API:
  - `WHATSAPP_VERIFY_NUMBER_E164`
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - `WHATSAPP_APP_SECRET`
- Bridge:
  - `BRIDGE_PROJECTS_JSON`
  - `BRIDGE_OTP_TTL_SECONDS`
  - `BRIDGE_OTP_MAX_ATTEMPTS`
  - `BRIDGE_CALLBACK_TIMEOUT_MS`
  - `BRIDGE_EVENT_MAX_RETRIES`
  - `BRIDGE_EVENT_RETRY_BASE_SECONDS`
  - `BRIDGE_EVENT_DISPATCH_LIMIT`
  - `BRIDGE_DISPATCH_TOKEN` (opcional para despacho manual)

Ejemplo `BRIDGE_PROJECTS_JSON`:

```json
{
  "luxichat": {
    "api_key": "change_me_luxichat",
    "callback_url": "https://api.luxichat.com/api/integrations/whatsapp/bridge",
    "callback_secret": "change_me_luxichat_callback"
  },
  "navai": {
    "api_key": "change_me_navai",
    "callback_url": "https://api.navai.com/api/integrations/whatsapp/bridge",
    "callback_secret": "change_me_navai_callback"
  }
}
```

## Levantar en local

```bash
npm install
cp .env.example .env
npm run dev
```

Build de produccion:

```bash
npm run build
npm run start
```

Nota:
- `npm run db:apply` solo es necesario para rutas legacy que siguen usando tablas SQL.
- El flujo bridge auth (`/api/bridge/webhooks/*`) funciona en memoria.

## Despliegue en servidor (Ubuntu + PM2)

1. Instalar runtime:

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

2. Publicar app:

```bash
git clone <repo_url> whatsapp-bridge
cd whatsapp-bridge
npm ci
cp .env.example .env
# editar .env con tus valores reales
npm run build
pm2 start dist/server.js --name whatsapp-bridge
pm2 save
pm2 startup
```

3. Reverse proxy (Nginx):

```nginx
server {
  listen 80;
  server_name bridge.tudominio.com;

  location / {
    proxy_pass http://127.0.0.1:4010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

4. (Opcional) Cron para despacho manual de callbacks pendientes:

```bash
*/1 * * * * curl -sS -X POST "https://bridge.tudominio.com/api/bridge/events/dispatch" \
  -H "x-bridge-dispatch-token: TU_TOKEN" \
  -H "content-type: application/json" \
  -d '{"limit":50}' >/dev/null 2>&1
```

## Uso desde otros proyectos (backend)

### 1) Solicitar autenticacion OTP

```bash
curl -X POST "https://bridge.tudominio.com/api/bridge/webhooks/request" \
  -H "x-project-key: luxichat" \
  -H "x-project-api-key: change_me_luxichat" \
  -H "content-type: application/json" \
  -d '{
    "flow":"login",
    "phone_e164":"+573001112233",
    "user_ref":"user_123",
    "correlation_id":"req-987"
  }'
```

Respuesta HTTP:
- `accepted=true`
- `session_id`

Callback principal al proyecto:
- `bridge.session.requested` (incluye `session.code` de 6 digitos)

### 2) Validar codigo ingresado por el usuario

```bash
curl -X POST "https://bridge.tudominio.com/api/bridge/webhooks/verify" \
  -H "x-project-key: luxichat" \
  -H "x-project-api-key: change_me_luxichat" \
  -H "content-type: application/json" \
  -d '{
    "session_id":"<session_uuid>",
    "code":"123456"
  }'
```

Respuesta:
- `status`: `verified`, `invalid` o `expired`
- `verified`: `true/false`

Si `verified=true`, se emite callback `bridge.session.verified`.

### 3) Consultar estado de sesion

```bash
curl "https://bridge.tudominio.com/api/bridge/sessions/<session_id>" \
  -H "x-project-key: luxichat" \
  -H "x-project-api-key: change_me_luxichat"
```

### 4) Recibir callback del bridge en backend del proyecto

El bridge envia `POST` al `callback_url` configurado, con headers:
- `x-bridge-event-id`
- `x-bridge-event-type`
- `x-bridge-timestamp`
- `x-bridge-signature` (`sha256=<hmac_hex>`)

Verificacion de firma (Node.js):

```ts
import crypto from "node:crypto";

function verifyBridgeSignature(secret: string, timestamp: string, rawBody: string, headerSig: string) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const received = String(headerSig || "").replace(/^sha256=/, "");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
```

Eventos emitidos:
- `bridge.session.requested`
- `bridge.session.verified`

## Endpoints actuales

Bridge:
- `POST /api/bridge/webhooks/request`
- `POST /api/bridge/webhooks/verify`
- `POST /api/bridge/sessions/start`
- `GET /api/bridge/sessions/:session_id`
- `POST /api/bridge/events/dispatch`

Webhook WhatsApp (Meta):
- `GET /api/webhooks/whatsapp`
- `POST /api/webhooks/whatsapp`

Flujos legacy (compatibilidad):
- `POST /api/whatsapp/verification/start`
- `GET /api/whatsapp/verification/status`
- `POST /api/whatsapp/login/start`
- `GET /api/whatsapp/login/status`
- `POST /api/whatsapp/register/start`
- `GET /api/whatsapp/register/status`
- `POST /api/whatsapp/register/complete`
- `POST /api/whatsapp/recovery/start`
- `GET /api/whatsapp/recovery/status`
- `POST /api/whatsapp/recovery/complete`

Agentes:
- `GET /api/agents`
- `GET /api/agents/:project_key`
- `GET /api/agents/:project_key/context`

## Seguridad recomendada

- No exponer ni versionar secretos reales en `.env`.
- Rotar `api_key` y `callback_secret` por proyecto.
- Restringir IPs de entrada al callback del proyecto cuando sea posible.
- Forzar HTTPS en bridge y callbacks.
- Monitorear callbacks `failed` y reintentos.
