# WhatsApp Bridge Service (LuxiSoft)

Servicio central para actuar como puente entre:
- usuarios por WhatsApp,
- y multiples proyectos (`project_key`) de LuxiSoft o externos.

Soporta dos modos de integracion:
- `API`: proyectos inician sesiones OTP y consultan estado.
- `Webhook in/out`: proyectos envian solicitud por webhook y el bridge responde por webhook.

## Arquitectura

Flujo recomendado:
1. Backend del proyecto envia solicitud al bridge `POST /api/bridge/webhooks/request`.
2. Bridge crea sesion OTP.
3. Bridge envia callback `bridge.session.requested` al `callback_url` del proyecto.
4. Proyecto muestra/usa la informacion de entrega (`wa_url` o `cloud_api`).
5. Usuario responde por WhatsApp al numero del bridge.
6. Meta llama el webhook central `POST /api/webhooks/whatsapp`.
7. Bridge valida OTP, marca sesion verificada, encola evento y entrega callback `bridge.session.verified`.
8. Backend del proyecto actualiza su estado interno y responde `2xx`.

Importante:
- El bridge no consulta bases de datos externas de proyectos en este modo.
- La integracion entre proyectos ocurre por webhooks firmados.

Notas de despliegue:
- Si el proyecto esta en el mismo servidor (otra carpeta), usa `callback_url` local (`http://127.0.0.1:puerto/...`).
- Si esta en otro servidor, usa URL HTTPS publica.

## Estructura de agentes

- Orquestador principal: `agents/luxisoft/scripts/*` y `agents/luxisoft/luxisoft.txt`.
- Agentes por proyecto: `agents/<proyecto>/scripts/*` y `agents/<proyecto>/<proyecto>.txt`.

## Variables de entorno

Copiar `.env.example` a `.env` y configurar:

- Base:
  - `DATABASE_URL`
  - `CORS_ORIGIN`
  - `WHATSAPP_DEFAULT_PROJECT`
- WhatsApp/Firebase:
  - `WHATSAPP_VERIFY_NUMBER_E164`
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - `WHATSAPP_APP_SECRET`
  - `FIREBASE_SERVICE_ACCOUNT_JSON` o `FIREBASE_SERVICE_ACCOUNT_PATH`
- Bridge:
  - `BRIDGE_PROJECTS_JSON`
  - `BRIDGE_OTP_TTL_SECONDS`
  - `BRIDGE_OTP_MAX_ATTEMPTS`
  - `BRIDGE_CALLBACK_TIMEOUT_MS`
  - `BRIDGE_EVENT_MAX_RETRIES`
  - `BRIDGE_EVENT_RETRY_BASE_SECONDS`
  - `BRIDGE_EVENT_DISPATCH_LIMIT`
  - `BRIDGE_DISPATCH_TOKEN` (opcional para despacho manual/cron)

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
npm run db:apply
npm run dev
```

Build de produccion:

```bash
npm run build
npm run start
```

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
npm run db:apply
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

4. (Opcional) Cron para despacho de callbacks pendientes:

```bash
*/1 * * * * curl -sS -X POST "https://bridge.tudominio.com/api/bridge/events/dispatch" \
  -H "x-bridge-dispatch-token: TU_TOKEN" \
  -H "content-type: application/json" \
  -d '{"limit":50}' >/dev/null 2>&1
```

## Uso desde otros proyectos (backend)

### 1) Iniciar sesion OTP

```bash
curl -X POST "https://bridge.tudominio.com/api/bridge/webhooks/request" \
  -H "x-project-key: luxichat" \
  -H "x-project-api-key: change_me_luxichat" \
  -H "content-type: application/json" \
  -d '{
    "flow":"login",
    "phone_e164":"+573001112233",
    "user_ref":"user_123",
    "correlation_id":"req-987",
    "delivery_mode":"wa_link"
  }'
```

Respuesta HTTP esperada:
- `accepted=true`
- `session_id`

Respuesta funcional principal:
- callback `bridge.session.requested` al backend del proyecto.

### 2) Consultar estado

```bash
curl "https://bridge.tudominio.com/api/bridge/sessions/<session_id>" \
  -H "x-project-key: luxichat" \
  -H "x-project-api-key: change_me_luxichat"
```

### 3) Recibir callback del bridge en backend del proyecto

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
- `POST /api/bridge/sessions/start`
- `GET /api/bridge/sessions/:session_id`
- `POST /api/bridge/events/dispatch`

Webhook WhatsApp:
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

- No exponer ni versionar secretos reales en `.env.example`.
- Rotar `api_key` y `callback_secret` por proyecto.
- Restringir IPs de entrada al callback del proyecto cuando sea posible.
- Forzar HTTPS en bridge y callbacks.
- Configurar monitoreo de eventos `failed` en `whatsapp_bridge_events`.
