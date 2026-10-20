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
npm run test:dependencies # regresiones locales de dependencias transitivas
npm run format        # prettier --write   (format:check para verificar)
npm run db:apply      # aplica db/schema.sql contra DATABASE_URL
```

CI: `.github/workflows/ci.yml` (dependencias → typecheck → lint → test → build).

El lockfile y los overrides fijan `websocket-driver` 0.7.5, `protobufjs` 7.6.6
y `fast-xml-parser` 5.11.1 dentro de los rangos de sus consumidores. Las pruebas
de dependencias siguen las resoluciones reales de Firebase y comprueban límites
de tramas, round trips Protobuf y entidades XML con fixtures locales. No requieren
credenciales, conexiones a proveedores ni una base de datos. Mantener estos casos
al actualizar el lockfile; una alerta de dependencia por sí sola no demuestra
explotación a través de las rutas de la aplicación.

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


### HTTP and provider dependency patches (2026-10-18)

Fastify remains on major 5 and its routing/URI dependencies satisfy their
consumers' declared ranges. The new serializer 7 uses fast-uri 4.2.2, while
AJV keeps fast-uri 3.1.8 through a major-scoped override. The dependency regression suite uses in-process injection to verify
malformed URL isolation, authenticated fallback access, JSON validation with
content-type whitespace, primitive-body type consistency and restrictive proxy
trust. Multipart fixtures resolve the parser through Firebase and use finite
synthetic data. No fixture opens an HTTP listener, sends provider requests or
reads application credentials.

Provider transitives use compatible fixes: Busboy 3.2.3, gRPC JS 1.14.6,
fast-uri 3.1.8, find-my-way 9.10.0 and the published form-data 2.5.6 backport.
The subsequent Firebase Admin 13.10.0 update below removes Forge, including the
remaining [RSA verification advisory](https://github.com/digitalbazaar/forge/security/advisories/GHSA-86w9-cpqp-85rv),
by using Node crypto. Audit production and development dependencies explicitly;
absence of high/critical advisories does not establish complete application security.

Primary references: [Fastify malformed URLs](https://github.com/fastify/fastify/security/advisories/GHSA-p68q-wchp-6fh7),
[primitive body validation](https://github.com/fastify/fastify/security/advisories/GHSA-w2qp-rph6-63g4),
[restrictive proxy trust](https://github.com/fastify/fastify/security/advisories/GHSA-444r-cwp2-x5xf),
[Busboy multipart headers](https://github.com/fastify/busboy/security/advisories/GHSA-gxm5-99cw-xjw9)
and [gRPC malformed messages](https://github.com/grpc/grpc-node/security/advisories/GHSA-99f4-grh7-6pcq).

An affected package version does not establish an application exploit. In this
application, body validation primarily uses Zod; the HTTP2, custom fallback and
restrictive-proxy configurations from several advisories are not enabled.
Firebase provider-response parsing and configured service-account key parsing
have different trust boundaries from inbound application input. Tests establish
patched component behavior and application compatibility separately.

Nodemailer moves to 10.1.6 after a targeted compatibility review: Node 22
meets its Node >=20 requirement and reporting uses SMTP options, inline
HTML/text and Buffer attachments. It uses no remote-content fetch, raw message,
OAuth2 token endpoint or custom proxy. Synthetic stream-transport tests cover
its actual reporting templates, recipient envelope and rejection of forbidden
raw file/URL access. No SMTP server is contacted. See the
[official changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md).
The Vitest/lint toolchain findings are also tracked separately; this HTTP/provider
update preserves those tools instead of mixing a test-runner migration into it.

### Firebase credential parser update (2026-10-18)

Firebase Admin 13.10.0 replaces Forge with Node's built-in crypto while retaining
this application's `admin` namespace and authentication wrapper. The runtime
Node 22 satisfies the SDK's Node >=18 requirement. See the [official release](https://github.com/firebase/firebase-admin-node/releases/tag/v13.10.0).

`npm run test:firebase` exercises the real wrapper with ephemeral RSA PKCS8 and
PKCS1 keys, validates locally signed custom tokens, rejects malformed identity
tokens and invalid PEM, and walks Firebase's resolved production dependencies
to ensure Forge is absent. The fixture refuses checkouts containing `.env` and
blocks sockets, HTTP(S) and fetch; it never reads service credentials or sends
provider requests. Existing authentication/webhook tests remain required.

This is a compatible SDK update, not an upgrade to Firebase 14, which removes
the namespace API used here. Runtime installation still requires the reviewed
selective dependency manifest and preservation of operational configuration.


### Development toolchain hardening (2026-10-18)

Vitest is pinned to 4.1.12 and Vite to 7.3.6. Vitest 4 removes the Tinypool
worker dependency, while the application keeps its existing Node test environment
and explicit discovery of `src/**/*.test.ts` and `test/**/*.test.ts`. Both test
and watch commands use one worker with file parallelism disabled to respect
the shared host budget. No UI or
browser server is enabled. See the [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration.html).

The [Vitest UI advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
requires an exposed test API or the documented Windows UI/browser conditions.
The [Tinypool advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr)
requires prototype pollution reaching worker options. These are toolchain risks;
this review did not demonstrate their exploitation through a production route.
Removing the vulnerable worker dependency also avoids forcing Tinypool 2 into
Vitest 3's incompatible declared dependency range.

Major-scoped overrides patch ESLint's brace expansion and YAML parsers and Vite's
PostCSS, Nano ID and source-map dependencies. `npm run test:toolchain` exercises
the copies resolved from actual consumers with small work budgets, valid mappings
and denied mock redirects; no server is opened. The complete existing application
suite, typecheck, lint and production dependency/authentication regressions remain
required. Production package versions must remain identical to the parent commit.

CI installs with `--ignore-scripts --include=dev` and runs `npm run audit:security`
with an explicit development-inclusive audit and a high-severity failure threshold.
This gate does not hide the remaining moderate/low findings. Release of development
packages to an execution checkout requires its own reviewed selective manifest;
this change does not authorize an unrestricted runtime install or deletion of
unrelated dependencies.

## Gestión de bandeja desde Luxisoft

El bridge expone etiquetas y borrado individual bajo `/api/bridge/inbox`, siempre
con la clave API del proyecto. `GET /tags` lista las etiquetas usadas; el listado
`GET /conversations` acepta `tag` junto con `status`, `channel` y `search`, antes
del límite. `PATCH /conversations/:id/tags` recibe `{userId,email,tags}` (máximo
10 etiquetas de 40 caracteres, persistidas en metadata). No sincroniza etiquetas
con la aplicación móvil de WhatsApp.

`POST /conversations/:id/clear` o `/delete` reciben
`{userId,email,lastMessageAt}`. La confirmación debe indicar el último mensaje
observado: si cambia, devuelve 409 sin borrar. Ambos eliminan en una transacción
el archivo de mensajes, resúmenes/eventos y memoria de compatibilidad del mismo
proyecto/canal/contacto; `clear` conserva chat/asignación/etiquetas y `delete`
retira también la conversación. No borra CRM, consentimientos, sesiones de
cuenta, mensajes en teléfonos ni propuestas de aprendizaje ya generadas. Una
respuesta externa que ya esté en curso no se cancela; actividad nueva puede
volver a aparecer. El consumidor Luxisoft restringe estas dos rutas a sus
administradores y fija el actor desde la sesión. No hay operación masiva.

Instalación sin migración: publicar y compilar en worktree limpio; instalar solo
`src/lib/inboxManagement` y `src/routes/inbox` (TS/JS), preservando los módulos
runtime de historial duradero y menús que difieren de main. Verificar los hashes,
el proceso y los canarios de historial antes del despliegue del frontend.
