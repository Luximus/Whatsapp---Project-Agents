# WhatsApp & Messenger Bridge & Verification Service

Backend multicanal sobre WhatsApp Cloud API y Facebook Messenger: Bridge OTP para
apps externas, verificacion por codigo para apps LUXISOFT y un mismo asistente
multi-agente. Proceso pm2 `whatsapp-bridge` (puerto `PORT`, default `4010`).

> Estado operativo, incidencias y deuda verificada: **`STATUS.md`**.
> Instagram está deshabilitado. El guion histórico para una posible revisión
> futura se conserva en **`META_APP_REVIEW.md`**.

## Bandeja corporativa y control humano

El bridge persiste los hilos activos de WhatsApp y Messenger en
`whatsapp_inbox_*`. La API `/api/bridge/inbox/*` está protegida por las
credenciales de proyecto y es consumida por Luxisoft backend; nunca debe
exponerse directamente al navegador.

- `ai_active`: responde el agente IA.
- `waiting_human`: la IA queda pausada y se notifica a `quote@luxisoft.com`.
- `human_active`: un único operador asignado responde en el mismo canal.
- Cerrar la atención libera al operador y devuelve el control a la IA.

Los bloques enriquecidos soportan botones, listas, imágenes, enlaces y tarjetas
con degradación segura a texto. Las campañas de WhatsApp usan únicamente
plantillas aprobadas. Messenger se usa para conversación individual; el envío
masivo fuera de ventana se rechaza mientras no exista un mecanismo de
notificación autorizado y consentimiento demostrable.

## Mejora continua supervisada

El proceso PM2 `whatsapp-learning-worker` ejecuta el análisis diario a las
`00:10` en `America/Bogota`. Lee los mensajes útiles del día anterior, redacta
datos personales y secretos, evalúa calidad y crea propuestas; conserva el
texto de conversaciones durante 30 días. Usa la cadena CLI estricta
`codex,codex-qwen,claude` con fallback automático.

Los administradores revisan las propuestas en **Plataforma → WhatsApp → Mejoras
IA**. “Aplicar” genera un cambio en un worktree aislado y ejecuta diff-check,
TypeScript, lint, pruebas y build. El diff debe aprobarse de nuevo con
“Publicar cambio”; una publicación puede revertirse desde la misma vista.

## Flujos principales

- Bridge OTP para proyectos externos (con callbacks firmados HMAC).
- Verificacion de numero por WhatsApp.
- Login por WhatsApp.
- Registro por WhatsApp.
- Recuperacion por WhatsApp.
- Runtime multi-agente opcional (flag `WHATSAPP_AGENT_ENABLED`) para mensajes
  sin codigo OTP.
- Vinculo del telefono con cuentas LP/LUXIPANEL y acceso autenticado a perfil,
  saldo, paneles y servidores (flag `WHATSAPP_SERVICES_ENABLED`).
- Operacion de servidores mediante el asistente en background de LUXIPANEL.
- Atención comercial y soporte del mismo agente por Messenger
  (`META_MESSENGER_ENABLED`). La memoria se separa por canal e identidad.

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
- El webhook Meta recibe `object=page` (Messenger), verifica la misma firma HMAC,
  ignora echoes/recibos, deduplica reintentos y confirma (`200`) antes de ejecutar
  el agente. Las respuestas salen con el Page Access Token.
- Messenger solo recibe las tools comerciales (catálogo, reuniones y
  escalamiento). Las tools privadas de cuenta/servidor siguen restringidas a
  WhatsApp porque dependen de un teléfono verificado. El adaptador Instagram
  permanece en el código, pero su flag está apagado y no tiene suscripción Meta.

### Capas internas

- **`src/lib/ai/`** — capa de IA agnóstica de proveedor. Interfaces
  `ChatProvider` / `TranscriptionProvider` y adaptadores para **OpenAI,
  Anthropic, Gemini, Deepseek, MiniMax y Grok**. El proveedor por defecto se
  elige con `AI_CHAT_PROVIDER` / `AI_TRANSCRIPTION_PROVIDER`. Para chat,
  `AI_CHAT_CHAIN` activa motores CLI con fallback automático; producción usa
  Codex Luna → Codex-Qwen 3.7 → Claude Opus 4.8. Cada proveedor API admite
  `<PROV>_BASE_URL` (útil para gateways o modelos self-hosted compatibles).
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
- **`src/lib/services/`** — connectors enchufables para LP, LUXIPANEL y LuxiChat;
  persistencia de vinculos, sesiones de autenticacion y sesiones a servidor.
  Las acciones sensibles pasan por `authGate.ts`. `serverAssistant.ts` emite una
  sesion SSO corta en LP, la canjea en LUXIPANEL y mantiene solo el identificador
  estable de conversacion, no el bearer.
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

El archivo `.env.example` cubre el runtime base y el Bridge. La lista de la capa
de servicios se documenta abajo mientras se completa esa plantilla. Claves
minimas para produccion (`assertProductionEnv` exige las marcadas con \*):

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
- `WHATSAPP_SERVICES_ENABLED` (default `false`): habilita vinculos, consultas de
  cuenta y operacion de servidores. Requiere también el agente para exponer las
  tools por conversacion.

Capa de servicios:

- `AUTH_SESSION_TTL_SECONDS` (default `3600`): TTL deslizante de la sesion
  autenticada; el proceso purga sesiones inactivas cada cinco minutos.
- `LINK_OTP_TTL_SECONDS` / `LINK_OTP_MAX_ATTEMPTS`: compatibilidad con vinculos
  pendientes y reautenticacion. El flujo nuevo de `startLink` enlaza directamente
  cuando LP confirma que el telefono ya fue verificado por WhatsApp.
- `LP_API_BASE_URL`, `LP_S2S_TOKEN`, `LP_S2S_TIMEOUT_MS`: autoridad de identidad,
  2FA, paneles, accesos SSH y emision de SSO.
- `LUXIPANEL_API_BASE_URL`, `LUXIPANEL_SESSION_COOKIE_NAME`,
  `LUXIPANEL_ASSISTANT_PROVIDER`: canje SSO y asistente del servidor.
- `LUXICHAT_API_BASE_URL`, `LUXICHAT_S2S_TOKEN`: connector opcional; sin ambas
  variables se anuncia como no disponible.

Capa de IA multi-proveedor (`AI_CHAT_PROVIDER` / `AI_TRANSCRIPTION_PROVIDER` /
`AI_SPEECH_PROVIDER`, default `openai`; chat soporta `anthropic`, `gemini`,
`deepseek`, `minimax`, `grok`; TTS soporta `openai`/`deepseek`/`grok`
(compat. OpenAI `/audio/speech`), `gemini` y `minimax`):

- `<PROV>_API_KEY`, `<PROV>_BASE_URL`, `<PROV>_CHAT_MODEL` por proveedor.
- `AI_CHAT_CHAIN`: lista ordenada de motores CLI. La cadena efectiva es
  `codex,codex-qwen,claude`, con modelos `gpt-5.6-luna`, `qwen3.7-max` y
  `claude-opus-4-8`. Un fallo de cuota, autenticación, proceso o timeout hace
  switch al siguiente motor; los fallos entran temporalmente en enfriamiento.
- `AI_CHAT_CLI_TIMEOUT_MS` / `AI_CHAT_CLI_CONCURRENCY`: tiempo máximo por motor
  y límite de procesos simultáneos. `CODEX_CHAT_*`, `QWEN_CHAT_*` y
  `CLAUDE_CHAT_*` fijan binario/modelo/perfil. Codex y Claude reutilizan las
  sesiones CLI del usuario del proceso; Qwen requiere `QWEN_API_KEY`.
- TTS (voz **siempre femenina**, fija por proveedor): `OPENAI_SPEECH_MODEL`/
  `_VOICE`/`_FORMAT` (formato `opus` => audio/ogg, la única nota de voz real en
  WhatsApp; voz `nova`), `GEMINI_SPEECH_MODEL`/`_VOICE` (PCM→WAV; voz `Kore`),
  `MINIMAX_SPEECH_MODEL`/`_VOICE` + `MINIMAX_GROUP_ID` (mp3; voz `female-*`).
- **Identidad por proveedor de chat:** el nombre del asistente cambia según
  `AI_CHAT_PROVIDER` vía `<PROV>_ASSISTANT_NAME` (defaults femeninos: Luisa/
  Valeria/Sofía/Camila/Daniela/Valentina). El prompt usa el token
  `{{ASSISTANT_NAME}}`, que el runtime sustituye por el nombre del proveedor activo.
  También sustituye `{{CHANNEL_NAME}}` para conservar la misma persona sin decir
  “WhatsApp” cuando atiende en Messenger o Instagram.

Meta Messaging:

- `META_MESSENGER_ENABLED` (default `false`): activa Messenger.
- `META_INSTAGRAM_ENABLED` (default `false`): activa Instagram de forma
  independiente; producción lo mantiene apagado.
- `META_GRAPH_VERSION`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID` y
  `META_INSTAGRAM_ACCOUNT_ID`: transporte y activos de la Página.
- `META_WEBHOOK_VERIFY_TOKEN` y `META_APP_SECRET`: challenge y firma. Si están
  vacíos, reutilizan los equivalentes `WHATSAPP_*` de la misma Meta App.

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

Antes de considerar un despliegue sano, ejecutar la calidad y comprobar tanto
el health local como el HTTPS publico. La fotografia mas reciente esta en
`STATUS.md`.

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

Facebook Messenger webhook:

- `GET /api/webhooks/meta`
- `POST /api/webhooks/meta`
