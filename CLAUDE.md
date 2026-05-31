# CLAUDE.md — `whatsapp/` (whatsapp-bridge)

Backend sobre WhatsApp Cloud API. Proceso pm2 `whatsapp-bridge`, escucha en
`PORT` (default `4010`). Proyecto **independiente**: solo comparte despliegue en
`/var/www` (ver raíz `/var/www/CLAUDE.md`).

> Detalle de arquitectura, flujos, endpoints, schema y env: **`README.md`**.
> Este archivo es solo el contrato operativo para agentes.

## Qué es

Hoy el runtime en `main` es **Bridge OTP + verificación por WhatsApp**. El
asistente comercial "Valeria" fue retirado del runtime (vivía en
`lib/projectAgent.ts`, eliminado); existe ahora **infraestructura multi-agente
nueva y agnóstica de proveedor** lista para reactivarlo, pero el webhook aún
**no** la invoca (solo procesa códigos OTP).

| Componente | Estado | Para quién |
|---|---|---|
| **Bridge OTP** | Activo | Apps externas (multi-proyecto, API key por proyecto). OTP + callbacks firmados HMAC con reintentos. |
| **Verificación WhatsApp** | Activo | Apps LUXISOFT (login/registro/recuperación por código). |
| **Capa IA multi-proveedor** | Activo (usado en transcripción) | `src/lib/ai/` — chat + transcripción agnósticos de proveedor. |
| **Runtime multi-agente** | Conectado al webhook tras flag `WHATSAPP_AGENT_ENABLED` (default off) | `src/lib/agents/` + `agents/<proyecto>/`. |

## Mapa rápido

- `src/server.ts` entry · `src/app.ts` plugins+rutas+errores (llama `assertProductionEnv`)
- `src/env.ts` config validada con `zod` (incluye `assertProductionEnv`)
- `src/routes/` HTTP (`webhooks.ts`, `bridge.ts`, `whatsapp.ts`, `health.ts`)
- `src/lib/` negocio (`whatsapp.ts`, `bridge.ts`, `reporting.ts`,
  `whatsappVerification.ts`, `whatsappSignature.ts`, `firebaseAdmin.ts`,
  `openaiAudio.ts` = wrapper deprecado → usar `lib/ai/`)
- `src/lib/ai/` capa IA agnóstica: `types.ts`, `config.ts`, `chat/` (openai,
  anthropic, gemini, + openai-compatible: deepseek/minimax/grok), `transcription/`
- `src/lib/agents/` runtime multi-agente: `registry.ts` (carga `agents/<proyecto>/`),
  `runtime.ts` (loop de tool-calling), `index.ts` (router `handleAgentMessage`)
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
- **Strings de usuario vía `src/i18n/` (`t(key, locale)`)** — no hardcodear texto
  en las rutas. Añadir idioma = nueva entrada en `messages.ts` con las mismas claves.
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
- `BRIDGE_STORE` (default `memory`): backend del Bridge. `postgres` persiste en
  `whatsapp_bridge_sessions`/`_events` (store en `lib/bridge/`). Cae a memoria
  si se pide postgres sin pool disponible.

Ambos vienen apagados para no cambiar el runtime de producción hasta activarlos
y verificarlos explícitamente.

## Deuda conocida

- El modo `BRIDGE_STORE=postgres` está implementado y con tests (pool mockeado)
  pero **no verificado contra la BD real** todavía; validar end-to-end antes de
  activarlo en producción.
