# WhatsApp Verification Service

Backend para WhatsApp Cloud API enfocado en verificacion por codigo.

## Flujos principales

- Bridge OTP para proyectos externos.
- Verificacion de numero por WhatsApp.
- Login por WhatsApp.
- Registro por WhatsApp.
- Recuperacion por WhatsApp.

## Arquitectura actual

- El webhook de WhatsApp recibe texto o audio.
- Si llega audio, se transcribe con OpenAI antes de extraer el codigo.
- Los codigos se validan contra sesiones `bridge` o contra solicitudes almacenadas en PostgreSQL.
- Cuando una sesion `bridge` queda verificada, se disparan callbacks pendientes.
- Se genera un reporte diario operativo por email.

## Variables de entorno

Copia base:

```bash
cp .env.example .env
```

Claves minimas para produccion:

- `DATABASE_URL`
- `WHATSAPP_VERIFY_NUMBER_E164`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `OPENAI_API_KEY` si quieres transcripcion de audios

Opcionales importantes:

- `WHATSAPP_DEFAULT_PROJECT`
- `WHATSAPP_REPLY_CONTEXT_PROBABILITY`
- `WHATSAPP_MARK_AS_READ_PROBABILITY`
- `WHATSAPP_TYPING_INDICATOR_PROBABILITY`
- `BRIDGE_PROJECTS_JSON`
- `BRIDGE_DISPATCH_TOKEN`
- `SMTP_*`
- `REPORT_EMAIL_TO`
- `REPORT_CRON`
- `REPORT_TIMEZONE`

## Ejecucion

```bash
npm install
npm run dev
```

Build y start:

```bash
npm run build
npm start
```

PM2:

```bash
pm2 start npm --name whatsapp-verification -- start
pm2 save
pm2 restart whatsapp-verification --update-env
```

## Endpoints

Bridge:

- `POST /api/bridge/webhooks/request`
- `POST /api/bridge/webhooks/verify`
- `POST /api/bridge/sessions/start`
- `GET /api/bridge/sessions/:session_id`
- `POST /api/bridge/events/dispatch`

WhatsApp verification:

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

WhatsApp webhook:

- `GET /api/webhooks/whatsapp`
- `POST /api/webhooks/whatsapp`
