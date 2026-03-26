# WhatsApp Bridge Service (LuxiSoft)

Backend para WhatsApp Cloud API con dos flujos principales:
- Bridge OTP para proyectos externos.
- Asistente comercial de IA (Valeria) para `luxisoft`.

## Arquitectura actual

- Agente unico: `agents/luxisoft/services.txt`.
- Tools dinamicas por proyecto: `agents/luxisoft/scripts/*.js|*.ts`.
- Carga automatica de tools desde `src/agents/repository.ts`.
- Scraping web como tool (`scrape_project_knowledge`) para grounding de respuestas.
- Buffer de entrada configurable para agrupar mensajes de usuario:
  - `WHATSAPP_INBOUND_DEBOUNCE_MS` (reinicia contador en cada mensaje nuevo).

## Flujo del asistente IA

1. Llega mensaje por webhook.
2. Se agrupa por numero durante el debounce configurado.
3. Se procesa con `handleProjectAgentMessage`.
4. Si la respuesta supera 250 chars y audio esta habilitado, responde con ElevenLabs.
5. Si el usuario quiere agendar reunion, se recopilan datos y se notifica al agente humano.

## Reporte diario

- Cron configurable por `REPORT_CRON` (default `59 23 * * *`).
- Genera metricas operativas + consumo OpenAI por modelo.
- Envia email con HTML + PDF adjunto (sin guardar PDF en disco).
- Notifica por WhatsApp al agente humano si el envio fue exitoso o fallo.

## Estructura de agentes

```text
agents/
  luxisoft/
    services.txt
    scripts/
      classify_service_intent.js
      extract_prospect_profile.js
      next_intake_question.js
      scrape_project_knowledge.js
```

## Variables de entorno

Copia base:

```bash
cp .env.example .env
```

Claves minimas para produccion:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `OPENAI_API_KEY`
- `AGENTS_DIR`
- `AGENT_PROJECT_SOURCES_JSON`
- `WHATSAPP_DEFAULT_PROJECT` (recomendado `luxisoft`)

Opcionales importantes:
- `WHATSAPP_INBOUND_DEBOUNCE_MS`
- `WHATSAPP_AUDIO_REPLY_ENABLED`
- `WHATSAPP_AUDIO_REPLY_INCLUDE_TEXT`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `AGENT_HUMAN_TRANSFER_NUMBER_E164`
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
pm2 start npm --name whatsapp-bridge -- start
pm2 save
pm2 restart whatsapp-bridge --update-env
```

## Endpoints

Bridge:
- `POST /api/bridge/webhooks/request`
- `POST /api/bridge/webhooks/verify`
- `POST /api/bridge/sessions/start`
- `GET /api/bridge/sessions/:session_id`
- `POST /api/bridge/events/dispatch`

WhatsApp webhook:
- `GET /api/webhooks/whatsapp`
- `POST /api/webhooks/whatsapp`

Agentes:
- `GET /api/agents`
- `GET /api/agents/:project_key`
- `GET /api/agents/:project_key/context`
