# CLAUDE.md — `whatsapp/` (whatsapp-bridge)

Backend sobre WhatsApp Cloud API. Proceso pm2 `whatsapp-bridge`, escucha en
`PORT` (default `4010`). Proyecto **independiente**: solo comparte despliegue en
`/var/www` (ver raíz `/var/www/CLAUDE.md`).

> Detalle de arquitectura, flujos, endpoints, schema y env: **`README.md`**.
> Este archivo es solo el contrato operativo para agentes.

## Qué es

Hoy el runtime en `main` es **Bridge OTP + verificación por WhatsApp**. El
asistente comercial "Valeria" fue retirado del runtime monolítico (vivía en
`lib/projectAgent.ts`, eliminado) y reimplementado sobre la **infraestructura
multi-agente nueva y agnóstica de proveedor** (`agents/luxisoft/`). El webhook
ya la invoca para mensajes **sin** código OTP, pero **solo si**
`WHATSAPP_AGENT_ENABLED=true` (default off); si está apagado o el agente falla,
el webhook solo procesa códigos OTP y cae al mensaje de ayuda de verificación.

| Componente                  | Estado                                                                | Para quién                                                                                          |
| --------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Bridge OTP**              | Activo                                                                | Apps externas (multi-proyecto, API key por proyecto). OTP + callbacks firmados HMAC con reintentos. |
| **Verificación WhatsApp**   | Activo                                                                | Apps LUXISOFT (login/registro/recuperación por código).                                             |
| **Capa IA multi-proveedor** | Activo (transcripción siempre; chat cuando el agente está activo)     | `src/lib/ai/` — chat + transcripción agnósticos de proveedor.                                       |
| **Runtime multi-agente**    | Conectado al webhook tras flag `WHATSAPP_AGENT_ENABLED` (default off) | `src/lib/agents/` + `agents/<proyecto>/`.                                                           |

## Mapa rápido

- `src/server.ts` entry · `src/app.ts` plugins+rutas+errores (llama `assertProductionEnv`)
- `src/env.ts` config validada con `zod` (incluye `assertProductionEnv`)
- `src/routes/` HTTP (`webhooks.ts`, `bridge.ts`, `whatsapp.ts`, `health.ts`)
- `src/lib/` negocio (`whatsapp.ts`, `bridge.ts`, `reporting.ts`,
  `whatsappVerification.ts`, `whatsappSignature.ts`, `firebaseAdmin.ts`,
  `scraping/textWeb.ts` = extractor de texto desde HTML,
  `openaiAudio.ts` = wrapper deprecado → usar `lib/ai/`)
- `src/lib/ai/` capa IA agnóstica: `types.ts`, `config.ts`, `chat/` (openai,
  anthropic, gemini, + openai-compatible: deepseek/minimax/grok), `transcription/`,
  `speech/` (TTS texto→voz: openai-compat `/audio/speech`, gemini PCM→WAV, minimax t2a;
  selección por `AI_SPEECH_PROVIDER`)
- `src/lib/agents/` runtime multi-agente: `registry.ts` (carga `agents/<proyecto>/`),
  `runtime.ts` (loop de tool-calling; sustituye el token `{{ASSISTANT_NAME}}` del
  prompt por el nombre femenino del proveedor de chat activo, ver `assistantNames`
  en `env.ts`), `index.ts` (router `handleAgentMessage`),
  `conversation/` (memoria de conversación por número: postgres si hay pool, si no
  memoria; tabla `whatsapp_agent_messages`)
- `src/i18n/` mensajes multi-idioma (`es`/`en`/`pt`) + detección de idioma
- `src/plugins/` `db.ts` (pool PG), `auth.ts` (Firebase)
- `agents/<proyecto>/` `services.txt` (prompt) + `scripts/*.js` (tools)
- `db/schema.sql` PostgreSQL

## Reglas para agentes

- **Dualidad de impacto:** tocar `routes/webhooks.ts`, `lib/whatsapp.ts`, el pool
  de DB o `db/schema.sql` afecta **Bridge y verificación**. Evaluar ambos antes
  de editar.
- **Webhook firmado:** `POST /api/webhooks/whatsapp` verifica
  `X-Hub-Signature-256` (HMAC con `WHATSAPP_APP_SECRET`) sobre el body crudo.
  No quitar esa verificación; el parser raw-body está encapsulado en esa ruta.
- **IA siempre vía `src/lib/ai/`** — nunca llamar a un SDK/HTTP de un proveedor
  directamente en el negocio. Añadir proveedor = nuevo adaptador en `chat/` y su
  entrada en la factoría. Selección por env `AI_CHAT_PROVIDER` / `<PROV>_*`.
- **Extender un agente = nuevo `agents/<proyecto>/scripts/*.js`** (export default
  `{name, description, parameters, execute}`) **+ prompt en `services.txt`.** No
  meter lógica de negocio en el runtime (`lib/agents/`). Los scripts se cargan por
  `import()` desde la carpeta del proyecto (sin `eval`); `safeProjectKey` evita
  path traversal.
- **Tools con efectos (enviar correo, etc.) NO importan módulos de `dist`:** la
  capa de rutas inyecta la implementación en `context.actions` (ver
  `AgentActions` en `lib/agents/types.ts`) y el script la invoca. Ej.: las tools
  `scheduleMeeting` (→ `sendMeetingQuoteEmail`, a `MEETING_QUOTE_EMAIL_TO` =
  `quote@luxipanel.com`) y `escalateToHuman` (→ `sendSupportTicketEmail`). La
  transferencia a humano se notifica **por correo, nunca por WhatsApp** (la Cloud
  API no permite escribir a quien no inició la conversación).
- **Strings de usuario vía `src/i18n/` (`t(key, locale)`)** — no hardcodear texto
  en las rutas. Añadir idioma = nueva entrada en `messages.ts` con las mismas claves.
- **Persona del agente (`services.txt`):** nombre femenino vía `{{ASSISTANT_NAME}}`
  (sustituido por proveedor), voz TTS siempre femenina, y **grounding estricto**:
  el asistente solo responde sobre LUXISOFT y la info de sus tools/cuenta; rechaza
  temas ajenos (cultura general, etc.) y trae reglas antiabuso (anti-jailbreak,
  insultos, contenido inseguro). No diluir estas reglas al editar el prompt.
- **Callbacks del Bridge van firmados (HMAC-SHA256):** no cambiar formato de
  payload ni de firma sin coordinar con los consumidores externos.
- **El comportamiento probabilístico** (`WHATSAPP_*_PROBABILITY`, debounce) es
  intencional para parecer humano; no volverlo determinista sin pedirlo.
- Secretos (`WHATSAPP_ACCESS_TOKEN`, `*_API_KEY`, `BRIDGE_DISPATCH_TOKEN`):
  nunca loguear ni devolver en respuestas.
- Validar entrada con `zod` en cualquier ruta nueva, como las existentes.

## Calidad

`npm run typecheck && npm run lint && npm test` (Vitest) deben pasar. CI en
`.github/workflows/ci.yml`. ESLint flat (`eslint.config.js`) + Prettier.

## Flags de activación (defaults seguros)

- `WHATSAPP_AGENT_ENABLED` (default `false`): si `true`, los mensajes entrantes
  **sin** código OTP se enrutan al runtime multi-agente (`agents/<proyecto>/`).
  Si el agente falla, cae al mensaje de ayuda de verificación.
- `WHATSAPP_AGENT_MEMORY_TTL_SECONDS` (default `1800`) y
  `WHATSAPP_AGENT_MEMORY_MAX_MESSAGES` (default `20`): memoria de conversación del
  agente. El webhook carga el historial reciente por número antes de invocar al
  agente y persiste cada turno (solo texto user/assistant) en
  `whatsapp_agent_messages`. TTL = ventana de inactividad antes de olvidar. Si no
  hay pool PG, cae a memoria de proceso.
- `WHATSAPP_REPLY_TEXT_PROBABILITY`/`_AUDIO_PROBABILITY`/`_QUOTED_PROBABILITY`
  (defaults `35`/`35`/`30`): pesos del **modo de respuesta del asistente IA**.
  Por cada respuesta del agente se elige uno al azar: texto plano · **nota de
  voz** · texto citando el mensaje del usuario. Solo aplica a respuestas del
  agente (no a OTP/verificación). La voz se sintetiza vía `src/lib/ai/speech/`
  (`AI_SPEECH_PROVIDER`); solo OGG/Opus (OpenAI `response_format=opus`) se envía
  como nota de voz real, el resto como audio normal. El peso de audio solo aplica
  si la respuesta supera `WHATSAPP_VOICE_REPLY_MIN_CHARS` (default `50`) y hay
  TTS configurado; ante cualquier fallo de TTS el webhook cae a texto.
- `BRIDGE_STORE` (default `memory`): backend del Bridge. `postgres` persiste en
  `whatsapp_bridge_sessions`/`_events` (store en `lib/bridge/`). Cae a memoria
  si se pide postgres sin pool disponible.

`WHATSAPP_AGENT_ENABLED` y `BRIDGE_STORE` vienen apagados para no cambiar el
runtime de producción hasta activarlos y verificarlos explícitamente.

## Deuda conocida

- El modo `BRIDGE_STORE=postgres` está implementado y con tests (pool mockeado)
  pero **no verificado contra la BD real** todavía; validar end-to-end antes de
  activarlo en producción. (La memoria de conversación del agente sobre
  `whatsapp_agent_messages` **sí** está verificada contra la BD real.)
- `npm run db:apply` aplica el `schema.sql` completo, pero el usuario de
  `DATABASE_URL` **no es dueño** de `set_updated_at()` (creada por un rol
  privilegiado) → falla en el `create or replace function` inicial. Para añadir
  una tabla nueva al runtime, aplicar solo su DDL con el usuario de la app, o
  correr el schema completo con un rol con privilegios. (El BOM UTF-8 que rompía
  el primer statement ya se eliminó de `db/schema.sql` y `db/seed.sql`.)
