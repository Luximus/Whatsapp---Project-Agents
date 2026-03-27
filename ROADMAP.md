# ROADMAP — Reestructuración Arquitectónica

> Rama de trabajo: `claude`
> Fecha: 2026-03-26
> Objetivo: Refactorizar el proyecto completo para lograr código limpio, arquitectura en capas,
> separación de responsabilidades y mejores prácticas, sin perder ninguna funcionalidad.

---

## Análisis del estado actual

### Qué hace el proyecto

**luxisoft-whatsapp** es un servidor Fastify/TypeScript que integra:

1. **Agente de IA para WhatsApp** — Recibe mensajes de usuarios, los procesa con OpenAI (con debounce de 10 s para agrupar mensajes rápidos), ejecuta herramientas (tools) del agente y responde en texto o audio (ElevenLabs TTS).
2. **Bridge de autenticación por WhatsApp** — Permite a apps externas usar el número de WhatsApp como segundo factor (OTP) para verificación, login, registro y recuperación de contraseña. Incluye reintento de eventos con backoff exponencial.
3. **Flujos de autenticación propios** — Verificación de número, login, registro y recuperación de cuenta (Firebase + PostgreSQL).
4. **Reporte diario automático** — Envía un email con métricas de actividad (mensajes, respuestas de IA, reuniones, tickets) vía cron programado.
5. **Sistema de agentes por proyecto** — Carga agentes desde el sistema de ficheros (`agents/<project>/`), cada uno con un prompt (`services.txt`) y scripts de herramientas JS/TS.

### Problemas arquitectónicos identificados

| # | Archivo | Problema |
|---|---------|----------|
| 1 | `src/lib/projectAgent.ts` | **God object** de ~1600 líneas. Mezcla: tipos, estado conversacional, caché de conocimiento, construcción de tools OpenAI, ejecución del runner, lógica de email, lógica de escalada. Imposible de testear o mantener. |
| 2 | `src/lib/bridge.ts` | Estado de sesiones y eventos en `Map` en memoria como almacenamiento **primario** (no como caché), compitiendo con la base de datos. Riesgo de pérdida de datos en restart. |
| 3 | `src/lib/reporting.ts` | Mezcla tracking de métricas en memoria + envío de email + generación de PDF en un único módulo. |
| 4 | `src/routes/webhooks.ts` | Lógica de negocio (debounce, transcripción, síntesis de audio, routing de OTP) mezclada con la capa HTTP. |
| 5 | `src/routes/whatsapp.ts` | Queries SQL escritas directamente en las rutas. Sin capa de acceso a datos. |
| 6 | `src/env.ts` | Parsers complejos de configuración mezclados con el schema Zod. Difícil de leer. |
| 7 | `src/types/fastify.d.ts` | Solo hay un fichero de tipos. Tipos de dominio dispersos por todo `projectAgent.ts`. |
| 8 | Rutas en general | `resolveProjectKey` y `requireUser` están duplicados en múltiples ficheros. |
| 9 | Errores HTTP | Se crean con `Object.assign(new Error(...), { statusCode })` en cada lugar. Sin clase de error centralizada. |
| 10 | Agente (scripts) | Los scripts del agente son `.js` puro sin tipos. La carga dinámica con `import()` es frágil. |
| 11 | Sin tests | No hay ninguna prueba automatizada. |
| 12 | Sin linter/formatter | No hay ESLint ni Prettier configurados. |

---

## Nueva estructura de carpetas propuesta

```
/var/www/whatsapp/
├── agents/                          # Datos de agentes (directorio externo, sin cambios)
│   └── luxisoft/
│       ├── services.txt
│       └── scripts/
│           ├── classify_service_intent.js
│           ├── extract_prospect_profile.js
│           ├── lookup_project_status.js
│           ├── next_intake_question.js
│           ├── register_project_followup.js
│           ├── register_support_ticket.js
│           ├── reset_case_state.js
│           ├── schedule_meeting_request.js
│           └── scrape_project_knowledge.js
│
├── db/
│   ├── schema.sql
│   └── seed.sql
│
├── scripts/
│   └── db-apply.ts
│
├── src/
│   ├── config/                      # [NUEVO] Configuración y constantes
│   │   ├── env.ts                   # Schema Zod + export del env validado
│   │   └── constants.ts             # Constantes globales (timeouts, límites, etc.)
│   │
│   ├── errors/                      # [NUEVO] Errores de dominio tipados
│   │   └── HttpError.ts             # Clase HttpError con statusCode
│   │
│   ├── domain/                      # [NUEVO] Lógica de negocio pura (sin Fastify, sin DB)
│   │   ├── agent/
│   │   │   ├── types.ts             # ConversationState, LeadProfile, MeetingProfile, etc.
│   │   │   ├── stateManager.ts      # CRUD del estado conversacional en memoria
│   │   │   ├── knowledgeCache.ts    # Caché de conocimiento de proyectos (scraping)
│   │   │   ├── toolBuilder.ts       # Construcción de OpenAI tools desde AgentScript[]
│   │   │   └── runner.ts            # Ejecución del runner OpenAI (extraído de projectAgent.ts)
│   │   │
│   │   ├── bridge/
│   │   │   ├── types.ts             # BridgeSessionRow, BridgeEventRow, BridgeFlow
│   │   │   ├── otp.ts               # Generación y validación de OTP
│   │   │   └── backoff.ts           # Cálculo de backoff exponencial para reintentos
│   │   │
│   │   ├── whatsapp/
│   │   │   ├── types.ts             # WebhookMessage, WebhookStatus
│   │   │   ├── inboundBuffer.ts     # Lógica de debounce/buffer de mensajes entrantes
│   │   │   └── otpExtractor.ts      # extractOtp(), normalizeE164()
│   │   │
│   │   └── reporting/
│   │       ├── types.ts             # DailyMetrics, MeetingRecord, ModelUsage
│   │       └── tracker.ts           # Singleton de métricas en memoria + funciones track*
│   │
│   ├── infrastructure/              # [NUEVO] Adaptadores de servicios externos
│   │   ├── db/
│   │   │   ├── pool.ts              # Pool de conexiones pg (extraído del plugin)
│   │   │   └── queries/             # Módulos de queries por dominio
│   │   │       ├── accounts.ts      # findAccountByFirebase, findAccountByPhone, upsertAccount
│   │   │       ├── projects.ts      # ensureProject, isProjectActive
│   │   │       ├── verification.ts  # findVerification, upsertVerification
│   │   │       ├── loginRequests.ts
│   │   │       ├── registerRequests.ts
│   │   │       ├── recoveryRequests.ts
│   │   │       └── bridge.ts        # Queries de bridge_sessions y bridge_events
│   │   │
│   │   ├── ai/
│   │   │   ├── openai.ts            # Cliente OpenAI (provider, agent factory)
│   │   │   ├── transcription.ts     # transcribeAudioWithOpenAI (extraído)
│   │   │   └── elevenlabs.ts        # synthesizeSpeech (extraído)
│   │   │
│   │   ├── messaging/
│   │   │   ├── whatsappApi.ts       # Llamadas a la Graph API de WhatsApp
│   │   │   └── mailer.ts            # Nodemailer transport + sendMail helper
│   │   │
│   │   ├── firebase/
│   │   │   └── admin.ts             # getFirebaseAdminAuth (extraído)
│   │   │
│   │   └── scraping/
│   │       └── textWeb.ts           # scrapePageTextFromHtml (sin cambios)
│   │
│   ├── application/                 # [NUEVO] Casos de uso (orquestación)
│   │   ├── agent/
│   │   │   └── handleAgentMessage.ts  # handleProjectAgentMessage (extraído y limpio)
│   │   │
│   │   ├── whatsapp/
│   │   │   ├── handleInbound.ts     # processBufferedInbound (texto + audio + reply)
│   │   │   └── handleOtp.ts         # consumeBridgeOtp + respuesta de verificación
│   │   │
│   │   ├── bridge/
│   │   │   ├── createSession.ts     # Crear sesión bridge + enviar OTP
│   │   │   ├── verifySession.ts     # Verificar código OTP
│   │   │   └── dispatchEvents.ts    # Dispatch de eventos pendientes a callbacks
│   │   │
│   │   └── reporting/
│   │       ├── sendDailyReport.ts   # Lógica de composición y envío del reporte
│   │       └── generatePdf.ts       # Generación del PDF del reporte
│   │
│   ├── http/                        # [NUEVO] Capa HTTP (Fastify)
│   │   ├── plugins/
│   │   │   ├── db.ts                # Plugin que inyecta el pool en fastify
│   │   │   └── auth.ts              # Plugin que registra fastify.authenticate
│   │   │
│   │   ├── helpers/
│   │   │   ├── projectKey.ts        # resolveProjectKey() centralizado
│   │   │   └── requestUser.ts       # requireUser() centralizado
│   │   │
│   │   └── routes/
│   │       ├── health.ts
│   │       ├── webhooks.ts          # Solo parsing HTTP + llamada a application/whatsapp
│   │       ├── whatsapp.ts          # Flujos auth (verification/login/register/recovery)
│   │       ├── bridge.ts            # API bridge (start/verify/status/dispatch)
│   │       └── agents.ts            # Admin de agentes (list/get/context)
│   │
│   ├── agents/                      # Cargador de agentes del filesystem
│   │   └── repository.ts            # Sin cambios funcionales, solo reorganizado
│   │
│   ├── emails/                      # Templates React Email
│   │   ├── tailwind.config.ts
│   │   └── templates/
│   │       ├── LuxisoftEmailTemplate.tsx
│   │       └── WhatsappDailyReportEmail.tsx
│   │
│   ├── jobs/                        # [NUEVO] Tareas programadas
│   │   └── dailyReport.ts           # startDailyReportScheduler / stopDailyReportScheduler
│   │
│   ├── types/
│   │   └── fastify.d.ts             # Augmentaciones de Fastify (pg, authenticate, user)
│   │
│   ├── app.ts                       # buildApp(): registra plugins y rutas
│   └── server.ts                    # Entry point: listen + señales OS
│
├── .env.example
├── package.json
├── tsconfig.json
└── ROADMAP.md
```

---

## Fases y pasos detallados

Cada paso está diseñado para ser ejecutado de forma **atómica y verificable**: el servidor debe arrancar sin errores después de cada paso completado.

---

### FASE 1 — Fundamentos: Errores, Configuración y Tipos

#### Paso 1.1 — Crear clase `HttpError`

**Archivo nuevo:** `src/errors/HttpError.ts`

Reemplazar el patrón `Object.assign(new Error(...), { statusCode })` usado en más de 30 lugares.

```ts
// src/errors/HttpError.ts
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(message = "not_found") { return new HttpError(404, message); }
export function badRequest(message: string) { return new HttpError(400, message); }
export function unauthorized() { return new HttpError(401, "unauthorized"); }
export function conflict(message: string) { return new HttpError(409, message); }
export function tooManyRequests(message = "too_many_requests") { return new HttpError(429, message); }
export function internalError(message = "internal_error") { return new HttpError(500, message); }
```

**Actualizar** `src/app.ts`: el error handler ya detecta `statusCode` en el error, solo cambiar la lectura de `error?.statusCode` a `error instanceof HttpError ? error.statusCode : ...`.

---

#### Paso 1.2 — Extraer constantes de `env.ts`

**Archivo nuevo:** `src/config/constants.ts`

Mover todas las constantes que hoy están hardcodeadas en múltiples archivos:

```ts
// src/config/constants.ts
export const WHATSAPP_GRAPH_API_VERSION = "v20.0";
export const OTP_CODE_LENGTH = 4;
export const OTP_EXPIRES_IN_MS = 5 * 60 * 1000;
export const MAX_TEXT_REPLY_CHARS = 250;
export const KNOWLEDGE_CACHE_TTL_MS = 10 * 60 * 1000;
```

---

#### Paso 1.3 — Refactorizar `src/env.ts` → `src/config/env.ts`

Mover el archivo a `src/config/env.ts`. El contenido no cambia, solo la ubicación. Actualizar todos los imports que apunten a `../env.js` para que apunten a `../config/env.js` (o con alias de path si se configuran).

> **Verificación:** `npm run build` debe pasar sin errores.

---

#### Paso 1.4 — Crear `src/domain/agent/types.ts`

Extraer de `src/lib/projectAgent.ts` todos los tipos puros (sin lógica):

- `LeadProfile`
- `MeetingProfile`
- `SupportOwnership`
- `ActiveProcessKind`
- `ConversationState`
- `ReplyStyle`
- `LinkPolicy`
- `ReplyPlan`
- `ProjectKnowledgeSource`
- `ProjectKnowledgeDictionary`
- `CachedKnowledge`
- `CrawledKnowledgePage`
- `ProjectAgentResult`
- `TurnAnalysis` (interfaz, no el schema Zod)
- `ConversationCaseAnalysis`
- `AgentReply`

> **Verificación:** Importar los tipos en `projectAgent.ts` y confirmar que el build compila.

---

#### Paso 1.5 — Crear `src/domain/bridge/types.ts`

Extraer de `src/lib/bridge.ts`:

- `BridgeFlow` / `BRIDGE_FLOWS`
- `BridgeSessionStatus`
- `BridgeEventStatus`
- `BridgeSessionRow`
- `BridgeEventRow`
- `BridgeProjectConfig` (mover desde `env.ts`)

---

### FASE 2 — Infraestructura: DB, Mensajería, IA

#### Paso 2.1 — Crear módulo de pool DB

**Archivo nuevo:** `src/infrastructure/db/pool.ts`

```ts
import { Pool } from "pg";
import { env } from "../../config/env.js";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: env.DATABASE_URL });
  return _pool;
}

export async function closePool() {
  if (_pool) { await _pool.end(); _pool = null; }
}
```

Actualizar `src/http/plugins/db.ts` para usar `getPool()` y `closePool()` en lugar de crear el pool inline.

---

#### Paso 2.2 — Crear queries de DB por dominio

**Directorio nuevo:** `src/infrastructure/db/queries/`

Crear un módulo por tabla/dominio. Cada función recibe un `Pool` (inyección explícita) y retorna tipos fuertemente tipados.

**`accounts.ts`** — Extraer de `src/routes/whatsapp.ts`:
```ts
export async function findAccountByFirebase(pool, projectKey, firebaseUid): Promise<AccountRow | null>
export async function upsertAccountByFirebase(pool, projectKey, firebaseUid, email, name): Promise<AccountRow>
export async function findAccountByPhone(pool, projectKey, phoneE164): Promise<AccountRow | null>
```

**`projects.ts`** — Extraer de `src/routes/whatsapp.ts`:
```ts
export async function ensureProjectActive(pool, projectKey): Promise<void>  // lanza HttpError si inactivo
```

**`verification.ts`**, **`loginRequests.ts`**, **`registerRequests.ts`**, **`recoveryRequests.ts`** — Extraer las queries SQL de `src/routes/whatsapp.ts`.

**`bridge.ts`** — Extraer las queries de `src/lib/bridge.ts`.

> **Verificación:** Las rutas y la lib bridge usan los módulos de queries. El build compila.

---

#### Paso 2.3 — Extraer cliente WhatsApp API

**Archivo nuevo:** `src/infrastructure/messaging/whatsappApi.ts`

Mover desde `src/lib/whatsapp.ts`:
- `sendWhatsappRequest()` (privado)
- `sendWhatsappText()`
- `sendWhatsappAudio()`
- `markWhatsappMessageAsRead()`
- `sendWhatsappTypingIndicator()`
- `downloadWhatsappMedia()`
- `uploadWhatsappMedia()`

Mantener en `src/domain/whatsapp/otpExtractor.ts`:
- `extractOtp()`
- `normalizeE164()`
- `toWaMeNumber()`
- `buildWaUrl()`

El archivo original `src/lib/whatsapp.ts` pasa a ser un re-export de ambos módulos para no romper imports durante la transición.

---

#### Paso 2.4 — Extraer clientes de IA

**`src/infrastructure/ai/transcription.ts`** — Mover `transcribeAudioWithOpenAI` de `src/lib/openaiAudio.ts`.

**`src/infrastructure/ai/elevenlabs.ts`** — Mover `synthesizeSpeechWithElevenLabs` e `isElevenLabsConfigured` de `src/lib/elevenlabs.ts`.

Los archivos originales pasan a ser re-exports para no romper imports.

---

#### Paso 2.5 — Extraer mailer

**Archivo nuevo:** `src/infrastructure/messaging/mailer.ts`

Extraer de `src/lib/reporting.ts`:
- Creación del transporte Nodemailer
- `sendMail(options)` helper tipado

---

### FASE 3 — Dominio: Agente, Bridge, Reporting

#### Paso 3.1 — Extraer gestor de estado conversacional

**Archivo nuevo:** `src/domain/agent/stateManager.ts`

Extraer de `src/lib/projectAgent.ts`:
- El `Map<string, ConversationState>` de estados por teléfono
- `getOrCreateState(phoneE164, projectKey)`
- `updateState(phoneE164, partial)`
- `pruneExpiredStates()`

El gestor de estado solo opera sobre el tipo `ConversationState` ya definido en `types.ts`. No conoce nada de OpenAI ni de WhatsApp.

---

#### Paso 3.2 — Extraer caché de conocimiento

**Archivo nuevo:** `src/domain/agent/knowledgeCache.ts`

Extraer de `src/lib/projectAgent.ts`:
- El `Map<string, CachedKnowledge>`
- `getOrFetchKnowledge(projectKey, sources)`
- `searchKnowledge(query, options)`

Depende de `src/infrastructure/scraping/textWeb.ts` para el scraping.

---

#### Paso 3.3 — Extraer builder de tools OpenAI

**Archivo nuevo:** `src/domain/agent/toolBuilder.ts`

Extraer de `src/lib/projectAgent.ts` la función que convierte un `AgentScript[]` en un array de OpenAI `tool()`:
```ts
export function buildOpenAiTools(scripts: AgentScript[], context: AgentScriptRuntimeContext): ToolDef[]
```

---

#### Paso 3.4 — Extraer runner del agente

**Archivo nuevo:** `src/domain/agent/runner.ts`

Extraer de `src/lib/projectAgent.ts` la función que:
1. Crea el `Agent` de OpenAI con el prompt y las tools
2. Ejecuta el `Runner`
3. Retorna `ProjectAgentResult`

```ts
export async function runProjectAgent(input: {
  prompt: string;
  tools: ToolDef[];
  history: AgentInputItem[];
  userMessage: string;
  previousResponseId: string | null;
}): Promise<ProjectAgentResult>
```

---

#### Paso 3.5 — Extraer lógica de reporting

**`src/domain/reporting/types.ts`** — Mover: `DailyMetrics`, `MeetingRecord`, `ModelUsage`, tipos de email input.

**`src/domain/reporting/tracker.ts`** — Extraer de `src/lib/reporting.ts`:
- `metricsByDate` / `meetingsByDate` Maps
- `ensureDailyMetrics()`
- `trackInboundMessage()`, `trackOutboundMessage()`, `trackAgentReplyGenerated()`, etc.
- `getDailySnapshot()` — nuevo método para obtener los datos sin enviarlos

**`src/application/reporting/sendDailyReport.ts`** — Extraer:
- `buildReportSections()` (compone el contenido del email)
- `sendDailyEmailReport()` (usa mailer + React Email)

**`src/application/reporting/generatePdf.ts`** — Extraer la lógica de PDF con pdfkit.

**`src/jobs/dailyReport.ts`** — Solo el scheduler (node-cron): llama a `sendDailyReport`.

---

#### Paso 3.6 — Extraer lógica de bridge

**`src/domain/bridge/otp.ts`** — Extraer de `src/lib/bridge.ts`:
- `generateOtpCode()`
- `verifyOtpCode()`
- Cálculo de expiración

**`src/domain/bridge/backoff.ts`** — Extraer:
- `nextRetryAt(attempts)` — cálculo de backoff exponencial
- `sessionRetentionMs()`

El módulo principal `src/lib/bridge.ts` queda reducido a la orquestación de sesiones usando los módulos de queries de DB (Paso 2.2) y los módulos de dominio (otp, backoff).

---

### FASE 4 — Capa de Aplicación (Casos de Uso)

#### Paso 4.1 — Crear `application/agent/handleAgentMessage.ts`

Extraer de `src/lib/projectAgent.ts` la función pública `handleProjectAgentMessage`:

```ts
export async function handleProjectAgentMessage(input: {
  phoneE164: string;
  text: string;
}): Promise<AgentReply>
```

Internamente orquesta:
1. `stateManager.getOrCreateState()`
2. `loadProjectAgent()` desde el repositorio
3. `knowledgeCache.searchKnowledge()`
4. `toolBuilder.buildOpenAiTools()`
5. `runner.runProjectAgent()`
6. `stateManager.updateState()`
7. Lógica de escalada (envío de emails a través de `mailer`)

Después de este paso, `src/lib/projectAgent.ts` puede eliminarse.

---

#### Paso 4.2 — Crear `application/whatsapp/handleInbound.ts`

Extraer de `src/routes/webhooks.ts`:
- `processBufferedInbound()` — orquesta: llamar al agente, sintetizar audio, enviar respuesta
- `enqueueInbound()` — gestión del debounce buffer
- La lógica `safeReply()` / `safeAudioReply()`

```ts
export type InboundBuffer = Map<string, PendingInbound>;

export function createInboundBuffer(): InboundBuffer
export function enqueueInbound(buffer: InboundBuffer, input: {...}, onFlush: FlushFn): void
export function drainBuffer(buffer: InboundBuffer): void
```

---

#### Paso 4.3 — Crear `application/whatsapp/handleOtp.ts`

Extraer de `src/routes/webhooks.ts`:
- Detección de OTP en mensaje entrante
- Llamada a `consumeBridgeOtp()`
- Generación de respuesta ("Código verificado" / "Código inválido")

```ts
export async function handleOtpMessage(fastify, input: {
  from: string;
  text: string;
  incomingMessageId: string | null;
}): Promise<{ handled: boolean }>
```

---

#### Paso 4.4 — Refactorizar `application/bridge/`

Crear tres módulos limpios en `src/application/bridge/`:

- **`createSession.ts`** — `createBridgeSession()`: genera OTP, persiste en DB, envía WhatsApp
- **`verifySession.ts`** — `verifyBridgeSessionCode()`: valida OTP en DB, marca como verificado
- **`dispatchEvents.ts`** — `dispatchDueBridgeEvents()`: lee eventos pendientes, hace POST al callback, actualiza estado en DB

Cada uno usa los módulos de queries de DB (Paso 2.2) directamente, sin Maps en memoria.

---

### FASE 5 — Capa HTTP (Limpieza de Rutas)

#### Paso 5.1 — Centralizar helpers de rutas

**`src/http/helpers/projectKey.ts`**:
```ts
export function resolveProjectKey(request: FastifyRequest, explicit?: string): string
```

**`src/http/helpers/requestUser.ts`**:
```ts
export function requireUser(request: FastifyRequest): { uid: string; email: string | null; name: string | null }
```

Eliminar las copias duplicadas en `src/routes/whatsapp.ts` y `src/routes/bridge.ts`.

---

#### Paso 5.2 — Limpiar `src/routes/webhooks.ts`

Después de los pasos 4.2 y 4.3, el archivo webhook queda reducido a:
1. Parsear el body del webhook de WhatsApp
2. Iterar mensajes y statuses
3. Delegar a `handleOtpMessage()` o `enqueueInbound()`
4. Retornar `{ ok: true }`

Sin lógica de negocio inline.

---

#### Paso 5.3 — Limpiar `src/routes/whatsapp.ts`

Reemplazar todas las queries SQL inline por llamadas a los módulos de `src/infrastructure/db/queries/`. El archivo solo debe: parsear body, llamar a query/service, retornar respuesta.

---

#### Paso 5.4 — Mover plugins a `src/http/plugins/`

Mover `src/plugins/db.ts` → `src/http/plugins/db.ts`
Mover `src/plugins/auth.ts` → `src/http/plugins/auth.ts`

Actualizar imports en `src/app.ts`.

---

#### Paso 5.5 — Mover rutas a `src/http/routes/`

Mover todos los archivos de `src/routes/` → `src/http/routes/`. Actualizar imports en `src/app.ts`.

---

### FASE 6 — Calidad y Herramientas

#### Paso 6.1 — Agregar ESLint

Instalar y configurar:
```bash
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-import
```

Crear `eslint.config.js` con:
- Reglas TypeScript estrictas
- `no-explicit-any` como warning (hay muchos `any` heredados, migrar gradualmente)
- `import/order` para imports ordenados

---

#### Paso 6.2 — Agregar Prettier

Instalar y configurar:
```bash
npm install -D prettier
```

Crear `.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "printWidth": 100,
  "trailingComma": "es5"
}
```

Agregar script `"format": "prettier --write src/"` en `package.json`.

---

#### Paso 6.3 — Configurar path aliases en `tsconfig.json`

```json
{
  "compilerOptions": {
    "paths": {
      "@config/*":         ["./src/config/*"],
      "@domain/*":         ["./src/domain/*"],
      "@infra/*":          ["./src/infrastructure/*"],
      "@app/*":            ["./src/application/*"],
      "@http/*":           ["./src/http/*"],
      "@errors":           ["./src/errors/HttpError"],
      "@agents/*":         ["./src/agents/*"],
      "@emails/*":         ["./src/emails/*"],
      "@jobs/*":           ["./src/jobs/*"]
    }
  }
}
```

---

#### Paso 6.4 — Escribir tests unitarios para dominio puro

Los módulos de dominio extraídos en las fases anteriores no tienen dependencias externas, lo que los hace directamente testeables.

Instalar:
```bash
npm install -D vitest @vitest/coverage-v8
```

Módulos prioritarios para testear:
- `src/domain/bridge/otp.ts` — generación/validación de OTP
- `src/domain/bridge/backoff.ts` — cálculo de backoff
- `src/domain/whatsapp/otpExtractor.ts` — parseo de mensajes
- `src/domain/agent/knowledgeCache.ts` — caché con TTL
- `src/config/env.ts` — validación de variables de entorno (con mock de `process.env`)
- `src/errors/HttpError.ts` — constructores de error

Agregar script `"test": "vitest run"` en `package.json`.

---

#### Paso 6.5 — Eliminar archivos de transición

Una vez que todos los imports apuntan a los nuevos módulos, eliminar:
- `src/lib/projectAgent.ts` (reemplazado por `application/agent/` + `domain/agent/`)
- `src/lib/reporting.ts` (reemplazado por `domain/reporting/` + `application/reporting/`)
- `src/lib/whatsapp.ts` (reemplazado por `infrastructure/messaging/whatsappApi.ts` + `domain/whatsapp/`)
- `src/lib/bridge.ts` (reemplazado por `application/bridge/` + `domain/bridge/`)
- `src/lib/elevenlabs.ts`, `src/lib/openaiAudio.ts`, `src/lib/firebaseAdmin.ts`, `src/lib/zod.ts`
- `src/routes/` (reemplazado por `src/http/routes/`)
- `src/plugins/` (reemplazado por `src/http/plugins/`)

Verificar con `npm run build` que no quedan imports rotos.

---

## Resumen de mejoras por fase

| Fase | Qué mejora |
|------|-----------|
| 1 | Errores tipados, configuración ordenada, tipos centralizados |
| 2 | Infraestructura desacoplada, queries tipadas, sin SQL inline en rutas |
| 3 | God object `projectAgent.ts` desaparecido, dominio puro y testeable |
| 4 | Casos de uso explícitos, rutas solo coordinan, no ejecutan lógica |
| 5 | HTTP limpio, helpers centralizados, plugins en su lugar |
| 6 | Linter, formatter, tests, aliases de path |

---

## Orden de ejecución recomendado para Claude Code

```
Fase 1 → Paso 1.1 → 1.2 → 1.3 → 1.4 → 1.5
  (build y arranque del servidor OK antes de continuar)

Fase 2 → Paso 2.1 → 2.2 → 2.3 → 2.4 → 2.5
  (build OK)

Fase 3 → Paso 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6
  (build OK, servidor arranca, prueba manual de webhook WhatsApp)

Fase 4 → Paso 4.1 → 4.2 → 4.3 → 4.4
  (build OK, prueba funcional completa)

Fase 5 → Paso 5.1 → 5.2 → 5.3 → 5.4 → 5.5
  (build OK, todos los endpoints responden igual que antes)

Fase 6 → Paso 6.1 → 6.2 → 6.3 → 6.4 → 6.5
  (linter sin errores, tests pasan, build OK)
```

> **Regla de oro:** Nunca avanzar a la siguiente fase si el servidor no arranca o `npm run build` falla. Cada paso debe dejar el código en un estado funcional.
