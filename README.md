# WhatsApp Bridge Service (LuxiSoft)

Puente de WhatsApp para:
- Entrega de codigos OTP enviados por otros proyectos (webhook -> WhatsApp).
- Respuesta de entrega positiva/negativa al proyecto solicitante.
- Atencion por agentes OpenAI: un orquestador y subagentes por proyecto (`luxisoft`, `navai`, `luxichat`).
- Transferencia a agente humano por WhatsApp con resumen de la conversacion.

## Flujo de autenticacion actual (Proyecto X genera el codigo)

1. Proyecto X genera su `user_code` de 6 digitos.
2. Proyecto X llama `POST /api/bridge/webhooks/request`.
3. Este servicio envia ese `user_code` al WhatsApp del usuario.
4. Responde inmediatamente si la entrega a Meta fue `delivery_ok=true` o `false`.
5. Opcionalmente envia callback firmado al `callback_url` del proyecto.

No se persisten OTP/sesiones en base de datos para este flujo bridge. Se maneja en memoria con TTL e intentos maximos.

## Request y response del endpoint principal

### Solicitud

`POST /api/bridge/webhooks/request`

Headers:
- `x-project-key: <project_key>`
- `x-project-api-key: <api_key_del_proyecto>`
- `content-type: application/json`

Body:

```json
{
  "flow": "login",
  "phone_e164": "+573019289464",
  "user_code": "123456",
  "user_ref": "user_123",
  "correlation_id": "req_001"
}
```

`user_code` es obligatorio en esta ruta.

### Respuesta

```json
{
  "accepted": true,
  "project_key": "luxichat",
  "session_id": "uuid",
  "otp_code": "123456",
  "wa_message_id": "wamid....",
  "delivery_ok": true,
  "delivery_error": null
}
```

Si falla entrega a Meta:
- `accepted=false`
- `delivery_ok=false`
- `delivery_error` con detalle.

## Callbacks a proyecto (opcionales pero recomendados)

Si en `BRIDGE_PROJECTS_JSON` configuras `callback_url` y `callback_secret`, el bridge envia eventos:
- `bridge.session.requested`
- `bridge.session.verified` (si usas verificacion posterior)

Headers de firma:
- `x-bridge-event-id`
- `x-bridge-event-type`
- `x-bridge-timestamp`
- `x-bridge-signature` (`sha256=<hmac>`)

## Agentes por proyecto en WhatsApp

Cuando llega un mensaje de usuario a `POST /api/webhooks/whatsapp`:
- Si parece OTP, intenta validacion contra sesiones en memoria.
- Si no, entra al flujo de agentes OpenAI.

Arquitectura:
- `agents/orchestrator/services.txt`: prompt del orquestador principal.
- `agents/<proyecto>/services.txt`: prompt del subagente del proyecto.
- `agents/<proyecto>/scripts/*.js`: tools/funciones que ese subagente puede ejecutar.

Regla de estructura:
- En cada proyecto solo debe existir `services.txt` como archivo `.txt`.
- En `scripts/` solo deben existir archivos `.js`.

Resolucion de proyecto:
- Detecta por texto (`luxisoft`, `navai`, `luxichat`, `audeo`).
- Si no detecta, usa `WHATSAPP_DEFAULT_PROJECT`.

Fuentes de conocimiento:
- Agentes locales en `agents/<project>`.
- Fuentes extra en `AGENT_PROJECT_SOURCES_JSON` (URLs o rutas locales).

Transferencia a humano:
- Palabras como `agente humano`, `asesor`, `contacto`, `soporte humano`.
- Envia resumen al numero `AGENT_HUMAN_TRANSFER_NUMBER_E164`.

## Variables de entorno

Copia:

```bash
cp .env.example .env
```

Config minima para bridge + WhatsApp:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_DEFAULT_PROJECT`
- `BRIDGE_PROJECTS_JSON`

Config de agentes:
- `AGENTS_DIR`
- `ORCHESTRATOR_AGENT_DIR`
- `AGENT_PROJECT_SOURCES_JSON`
- `AGENT_HUMAN_TRANSFER_NUMBER_E164`
- `OPENAI_API_KEY`
- `OPENAI_ORCHESTRATOR_MODEL`
- `OPENAI_PROJECT_MODEL`
- `OPENAI_AGENT_MAX_TOOL_STEPS`

Compatibilidad legacy:
- `DATABASE_URL`, `PROJECT_DATABASES_JSON`, Firebase se mantienen para rutas antiguas.

### Ejemplo `BRIDGE_PROJECTS_JSON`

```json
{
  "luxichat": {
    "api_key": "luxichat_bridge_key_2026",
    "callback_url": "https://api.luxichat.com/api/integrations/whatsapp/bridge",
    "callback_secret": "luxichat_bridge_callback_2026"
  },
  "navai": {
    "api_key": "navai_bridge_key_2026",
    "callback_url": "https://api.navai.com/api/integrations/whatsapp/bridge",
    "callback_secret": "navai_bridge_callback_2026"
  }
}
```

### Ejemplo `AGENT_PROJECT_SOURCES_JSON`

```json
{
  "luxisoft": ["https://luxisoft.com"],
  "navai": ["https://navai.luxisoft.com"],
  "luxichat": ["C:/Users/jwmg1/OneDrive/Documentos/Desarrollo/audeo"]
}
```

### Config OpenAI minima

```env
OPENAI_API_KEY=sk-...
OPENAI_ORCHESTRATOR_MODEL=gpt-5.4-mini
OPENAI_PROJECT_MODEL=gpt-5.4-mini
OPENAI_AGENT_MAX_TOOL_STEPS=6
```

## Ejecucion

Local:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm start
```

PM2 (produccion):

```bash
pm2 start npm --name whatsapp-bridge -- start
pm2 save
```

## Endpoints

Bridge:
- `POST /api/bridge/webhooks/request`
- `POST /api/bridge/webhooks/verify`
- `POST /api/bridge/sessions/start`
- `GET /api/bridge/sessions/:session_id`
- `POST /api/bridge/events/dispatch`

Meta webhook:
- `GET /api/webhooks/whatsapp` (verificacion Meta)
- `POST /api/webhooks/whatsapp` (mensajes/status)
