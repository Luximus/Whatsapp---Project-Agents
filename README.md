# WhatsApp Bridge & Verification Service

Backend dual sobre WhatsApp Cloud API: Bridge OTP como servicio para apps
externas + verificacion por codigo para apps LUXISOFT. Proceso pm2
`whatsapp-bridge` (puerto `PORT`, default `4010`).

## Flujos principales

- Bridge OTP para proyectos externos (con callbacks firmados HMAC).
- Verificacion de numero por WhatsApp.
- Login por WhatsApp.
- Registro por WhatsApp.
- Recuperacion por WhatsApp.
- Runtime multi-agente opcional (flag `WHATSAPP_AGENT_ENABLED`) para mensajes
  sin codigo OTP.

## Arquitectura actual

- El webhook de WhatsApp recibe texto o audio. El `POST` verifica la firma
  `X-Hub-Signature-256` (HMAC con `WHATSAPP_APP_SECRET`) sobre el cuerpo crudo.
- Si llega audio, se transcribe vía la capa de IA (`src/lib/ai/`) antes de
  extraer el codigo.
- Los codigos se validan contra sesiones `bridge` o contra solicitudes almacenadas en PostgreSQL.
- Cuando una sesion `bridge` queda verificada, se disparan callbacks pendientes.
- Si el mensaje **no** trae codigo OTP y `WHATSAPP_AGENT_ENABLED=true`, se enruta
  al runtime multi-agente (`agents/<proyecto>/`); si el agente falla o esta
  desactivado, cae al mensaje de ayuda de verificacion.
- Las respuestas de usuario salen del catalogo i18n (`src/i18n/`, `es`/`en`/`pt`).
- Se genera un reporte diario operativo por email.

### Capas internas

- **`src/lib/ai/`** — capa de IA agnóstica de proveedor. Interfaces
  `ChatProvider` / `TranscriptionProvider` y adaptadores para **OpenAI,
  Anthropic, Gemini, Deepseek, MiniMax y Grok**. El proveedor por defecto se
  elige con `AI_CHAT_PROVIDER` / `AI_TRANSCRIPTION_PROVIDER`. Cada proveedor
  admite `<PROV>_BASE_URL` (útil para gateways o modelos self-hosted compatibles).
- **`src/lib/agents/`** — runtime multi-agente propio (loop de tool-calling
  sobre `ChatProvider`, sin SDKs externos). `handleAgentMessage` carga
  `agents/<proyecto>/services.txt` (prompt) + `agents/<proyecto>/scripts/*.js`
  (tools) por `import()` dinámico y corre el loop (default 6 turnos). El webhook
  lo invoca tras el flag `WHATSAPP_AGENT_ENABLED` (default off). Submódulo
  `conversation/` da **memoria de conversación** por número (carga el historial
  reciente antes de responder y persiste cada turno en `whatsapp_agent_messages`;
  postgres si hay pool, si no memoria), para que la charla mantenga contexto y
  sobreviva a reinicios.
- **`src/lib/bridge/`** — store pluggable del Bridge (`factory.ts` elige backend
  por `BRIDGE_STORE`): `memoryStore` (default, sin persistencia) o `postgresStore`
  (`whatsapp_bridge_sessions`/`_events`). Cae a memoria si se pide postgres sin
  pool disponible.
- **`src/lib/scraping/`** — `scrapePageTextFromHtml`, extractor de texto plano
  desde HTML (limpia scripts/estilos/ocultos, decodifica entidades, dedup).
- **`src/i18n/`** — `t(key, locale)` + detección de idioma de mensajes cortos.

## Calidad

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint   (lint:fix para autofix)
npm test              # vitest    (test:watch para modo watch)
npm run format        # prettier --write   (format:check para verificar)
npm run db:apply      # aplica db/schema.sql contra DATABASE_URL
```

CI: `.github/workflows/ci.yml` (typecheck → lint → test → build).

## Variables de entorno

Copia base:

```bash
cp .env.example .env
```

El archivo `.env.example` es la referencia completa. Claves minimas para
produccion (`assertProductionEnv` exige las marcadas con \*):

- `DATABASE_URL`
- `WHATSAPP_VERIFY_NUMBER_E164`
- `WHATSAPP_ACCESS_TOKEN` \*
- `WHATSAPP_PHONE_NUMBER_ID` \*
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` \*
- `WHATSAPP_APP_SECRET` \* (firma HMAC del webhook)
- `OPENAI_API_KEY` si quieres transcripcion de audios

Flags de activacion (defaults seguros, ver `CLAUDE.md`):

- `WHATSAPP_AGENT_ENABLED` (default `false`): enruta mensajes sin OTP al runtime
  multi-agente.
- `WHATSAPP_AGENT_MEMORY_TTL_SECONDS` (default `1800`) /
  `WHATSAPP_AGENT_MEMORY_MAX_MESSAGES` (default `20`): memoria de conversacion del
  agente (historial por numero en `whatsapp_agent_messages`; persiste entre
  reinicios si hay BD, cae a memoria si no).
- `BRIDGE_STORE` (default `memory`): backend del Bridge, `memory` o `postgres`.

Capa de IA multi-proveedor (`AI_CHAT_PROVIDER` / `AI_TRANSCRIPTION_PROVIDER` /
`AI_SPEECH_PROVIDER`, default `openai`; chat soporta `anthropic`, `gemini`,
`deepseek`, `minimax`, `grok`; TTS soporta `openai`/`deepseek`/`grok`
(compat. OpenAI `/audio/speech`), `gemini` y `minimax`):

- `<PROV>_API_KEY`, `<PROV>_BASE_URL`, `<PROV>_CHAT_MODEL` por proveedor.
- TTS (voz **siempre femenina**, fija por proveedor): `OPENAI_SPEECH_MODEL`/
  `_VOICE`/`_FORMAT` (formato `opus` => audio/ogg, la única nota de voz real en
  WhatsApp; voz `nova`), `GEMINI_SPEECH_MODEL`/`_VOICE` (PCM→WAV; voz `Kore`),
  `MINIMAX_SPEECH_MODEL`/`_VOICE` + `MINIMAX_GROUP_ID` (mp3; voz `female-*`).
- **Identidad por proveedor de chat:** el nombre del asistente cambia según
  `AI_CHAT_PROVIDER` vía `<PROV>_ASSISTANT_NAME` (defaults femeninos: Luisa/
  Valeria/Sofía/Camila/Daniela/Valentina). El prompt usa el token
  `{{ASSISTANT_NAME}}`, que el runtime sustituye por el nombre del proveedor activo.

Opcionales importantes:

- `WHATSAPP_DEFAULT_PROJECT`
- `WHATSAPP_REPLY_CONTEXT_PROBABILITY`
- `WHATSAPP_MARK_AS_READ_PROBABILITY`
- `WHATSAPP_TYPING_INDICATOR_PROBABILITY`
- `WHATSAPP_REPLY_TEXT_PROBABILITY` (35) / `WHATSAPP_REPLY_AUDIO_PROBABILITY`
  (35) / `WHATSAPP_REPLY_QUOTED_PROBABILITY` (30): pesos del modo de respuesta
  del **asistente IA** (texto plano · nota de voz · texto citando al usuario).
  Por cada respuesta se elige uno al azar según su peso. El peso de audio solo
  aplica si la respuesta supera `WHATSAPP_VOICE_REPLY_MIN_CHARS` (default `50`)
  y hay proveedor TTS configurado.
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
pm2 start npm --name whatsapp-bridge -- start
pm2 save
pm2 restart whatsapp-bridge --update-env
```

## Endpoints

Health:

- `GET /health`

Bridge:

- `POST /api/bridge/sessions/start`
- `POST /api/bridge/webhooks/request`
- `POST /api/bridge/webhooks/verify`
- `GET /api/bridge/sessions/:session_id`
- `POST /api/bridge/events/dispatch` (requiere `BRIDGE_DISPATCH_TOKEN`)

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
