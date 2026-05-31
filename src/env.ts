import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(here, "..", ".env")];
for (const filePath of candidates) {
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath });
    break;
  }
}

function csvToArray(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export type BridgeProjectConfig = {
  apiKey: string;
  callbackUrl: string | null;
  callbackSecret: string | null;
};

function parseBridgeProjects(value: string) {
  const raw = value.trim();
  if (!raw) return {} as Record<string, BridgeProjectConfig>;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_bridge_projects_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_bridge_projects_json");
  }

  const output: Record<string, BridgeProjectConfig> = {};
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) continue;

    const rawEntry = item as Record<string, unknown>;
    const apiKeyValue = rawEntry.api_key ?? rawEntry.apiKey;
    const callbackUrlValue = rawEntry.callback_url ?? rawEntry.callbackUrl;
    const callbackSecretValue = rawEntry.callback_secret ?? rawEntry.callbackSecret;

    if (typeof apiKeyValue !== "string" || !apiKeyValue.trim()) {
      throw new Error(`invalid_bridge_project_api_key:${normalizedKey}`);
    }

    const callbackUrl =
      typeof callbackUrlValue === "string" && callbackUrlValue.trim()
        ? callbackUrlValue.trim()
        : null;
    const callbackSecret =
      typeof callbackSecretValue === "string" && callbackSecretValue.trim()
        ? callbackSecretValue.trim()
        : null;

    if (callbackUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(callbackUrl);
      } catch {
        throw new Error(`invalid_bridge_project_callback_url:${normalizedKey}`);
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(`invalid_bridge_project_callback_url:${normalizedKey}`);
      }
      if (!callbackSecret) {
        throw new Error(`missing_bridge_project_callback_secret:${normalizedKey}`);
      }
    }

    output[normalizedKey] = {
      apiKey: apiKeyValue.trim(),
      callbackUrl,
      callbackSecret
    };
  }

  return output;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4010),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),

  CORS_ORIGIN: z.string().optional().default(""),

  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(""),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional().default(""),

  WHATSAPP_VERIFY_NUMBER_E164: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),

  WHATSAPP_DEFAULT_PROJECT: z.string().optional().default("luxisoft"),
  // Si está activo, los mensajes sin código OTP se enrutan al asistente
  // multi-agente (agents/<proyecto>/). Default off: el webhook solo hace OTP.
  WHATSAPP_AGENT_ENABLED: z.string().optional().default("false"),
  // Memoria de conversación del agente: vida del historial (ventana deslizante,
  // cada turno renueva el vencimiento) y nº máx. de mensajes recientes a recordar.
  WHATSAPP_AGENT_MEMORY_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),
  WHATSAPP_AGENT_MEMORY_MAX_MESSAGES: z.coerce.number().int().min(2).max(100).default(20),

  // ── Capa de servicios (vínculo teléfono↔cuenta + operar servicios) ──────────
  // Opt-in: habilita las tools de vínculo/consulta de cuenta y operación de
  // servicios externos (LP, LUXIPANEL, LuxiChat...). Default off para no cambiar
  // el runtime hasta activarlo y verificarlo explícitamente.
  WHATSAPP_SERVICES_ENABLED: z.string().optional().default("false"),
  // Ventana para confirmar el vínculo (enviar el código 2FA) tras iniciarlo.
  LINK_OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  LINK_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  // Sesión 2FA del chat: vida e inactividad máxima antes de borrar chat+sesión y
  // re-autenticar (default 1h). Sliding: cada acción de cuenta/servidor la renueva.
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  // LP-LICENSE-SERVER (autoridad): base URL + secreto compartido S2S. El backend
  // de LP corre en el mismo host (loopback) por defecto.
  LP_API_BASE_URL: z.string().optional().default("http://127.0.0.1:3300"),
  LP_S2S_TOKEN: z.string().optional().default(""),
  LP_S2S_TIMEOUT_MS: z.coerce.number().int().min(1000).default(8000),
  // LUXIPANEL (panel del cliente): base URL para canjear el token SSO y
  // conducir el módulo asistente. Corre en el mismo host (loopback) por defecto.
  LUXIPANEL_API_BASE_URL: z.string().optional().default("http://127.0.0.1:8080"),
  // Nombre de la cookie de sesión que LUXIPANEL emite en /api/sso/callback.
  // DEBE coincidir con SESSION_COOKIE_NAME del backend de LUXIPANEL (default allá:
  // "luxipanel_session"). El bridge la lee del Set-Cookie y la usa como bearer.
  LUXIPANEL_SESSION_COOKIE_NAME: z.string().optional().default("luxipanel_session"),
  // Proveedor por defecto del asistente al operar por WhatsApp.
  LUXIPANEL_ASSISTANT_PROVIDER: z.string().optional().default("claude"),
  // LuxiChat (opcional; el connector se degrada si falta config).
  LUXICHAT_API_BASE_URL: z.string().optional().default(""),
  LUXICHAT_S2S_TOKEN: z.string().optional().default(""),

  BRIDGE_PROJECTS_JSON: z.string().optional().default("{}"),
  BRIDGE_OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  BRIDGE_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  BRIDGE_CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(7000),
  BRIDGE_EVENT_MAX_RETRIES: z.coerce.number().int().min(1).default(6),
  BRIDGE_EVENT_RETRY_BASE_SECONDS: z.coerce.number().int().min(5).default(20),
  BRIDGE_EVENT_DISPATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(50),
  BRIDGE_DISPATCH_TOKEN: z.string().optional().default(""),
  // Backend de almacenamiento del Bridge: "memory" (default, sin persistencia)
  // o "postgres" (persiste en whatsapp_bridge_sessions/_events).
  BRIDGE_STORE: z.string().optional().default("memory"),

  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().optional().default(""),
  OPENAI_AUDIO_TRANSCRIBE_MODEL: z.string().optional().default("gpt-4o-mini-transcribe"),

  // -----------------------------
  // Capa multi-proveedor de IA
  // -----------------------------
  // Selección de proveedor/modelo por defecto. Cada proyecto/agente podrá
  // sobreescribir esto más adelante (Fase 3). Proveedores soportados:
  // openai | anthropic | gemini | deepseek | minimax | grok
  AI_CHAT_PROVIDER: z.string().optional().default("openai"),
  AI_CHAT_MODEL: z.string().optional().default(""),
  AI_TRANSCRIPTION_PROVIDER: z.string().optional().default("openai"),
  // Proveedor TTS (texto→voz) para responder con nota de voz:
  // openai | deepseek | grok (compat. OpenAI) | gemini | minimax
  AI_SPEECH_PROVIDER: z.string().optional().default("openai"),

  // Nombre del asistente (femenino) por proveedor de chat: la identidad cambia
  // según AI_CHAT_PROVIDER y es la misma siempre para ese proveedor.
  OPENAI_ASSISTANT_NAME: z.string().optional().default("Luisa"),
  ANTHROPIC_ASSISTANT_NAME: z.string().optional().default("Valeria"),
  GEMINI_ASSISTANT_NAME: z.string().optional().default("Sofía"),
  DEEPSEEK_ASSISTANT_NAME: z.string().optional().default("Camila"),
  MINIMAX_ASSISTANT_NAME: z.string().optional().default("Daniela"),
  GROK_ASSISTANT_NAME: z.string().optional().default("Valentina"),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_BASE_URL: z.string().optional().default(""),
  ANTHROPIC_CHAT_MODEL: z.string().optional().default("claude-sonnet-4-6"),

  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_BASE_URL: z.string().optional().default(""),
  GEMINI_CHAT_MODEL: z.string().optional().default("gemini-2.5-flash"),
  GEMINI_SPEECH_MODEL: z.string().optional().default("gemini-2.5-flash-preview-tts"),
  // Voz femenina de Gemini (Kore, Aoede, Leda… son femeninas).
  GEMINI_SPEECH_VOICE: z.string().optional().default("Kore"),

  DEEPSEEK_API_KEY: z.string().optional().default(""),
  DEEPSEEK_BASE_URL: z.string().optional().default(""),
  DEEPSEEK_CHAT_MODEL: z.string().optional().default("deepseek-chat"),

  MINIMAX_API_KEY: z.string().optional().default(""),
  MINIMAX_BASE_URL: z.string().optional().default(""),
  MINIMAX_CHAT_MODEL: z.string().optional().default("MiniMax-Text-01"),
  MINIMAX_SPEECH_MODEL: z.string().optional().default("speech-02-hd"),
  // Voz femenina de MiniMax (female-*).
  MINIMAX_SPEECH_VOICE: z.string().optional().default("female-shaonv"),
  // MiniMax exige GroupId como query param para t2a; sin él la síntesis falla.
  MINIMAX_GROUP_ID: z.string().optional().default(""),

  GROK_API_KEY: z.string().optional().default(""),
  GROK_BASE_URL: z.string().optional().default(""),
  GROK_CHAT_MODEL: z.string().optional().default("grok-3"),

  OPENAI_SPEECH_MODEL: z.string().optional().default("gpt-4o-mini-tts"),
  // Voz femenina de OpenAI (nova, shimmer, coral, sage son femeninas).
  OPENAI_SPEECH_VOICE: z.string().optional().default("nova"),
  // Formato de salida del TTS OpenAI-compat: opus (audio/ogg, nota de voz),
  // mp3, aac, flac, wav, pcm. "opus" es el único que WhatsApp trata como voz.
  OPENAI_SPEECH_FORMAT: z.string().optional().default("opus"),

  OPENAI_CHAT_MODEL: z.string().optional().default("gpt-4o-mini"),

  WHATSAPP_REPLY_CONTEXT_PROBABILITY: z.coerce.number().min(0).max(100).default(35),
  WHATSAPP_MARK_AS_READ_PROBABILITY: z.coerce.number().min(0).max(100).default(100),
  WHATSAPP_TYPING_INDICATOR_PROBABILITY: z.coerce.number().min(0).max(100).default(100),
  // Reparto del MODO de respuesta del asistente IA (pesos; se normalizan al
  // sumar). Por cada respuesta del agente se elige uno al azar según su peso:
  //  - TEXT   = texto plano (sin cita)
  //  - AUDIO  = nota de voz (TTS)
  //  - QUOTED = texto citando el mensaje del usuario (reply context)
  // Solo aplica a las respuestas del agente, no a OTP/verificación.
  WHATSAPP_REPLY_TEXT_PROBABILITY: z.coerce.number().min(0).max(100).default(35),
  WHATSAPP_REPLY_AUDIO_PROBABILITY: z.coerce.number().min(0).max(100).default(35),
  WHATSAPP_REPLY_QUOTED_PROBABILITY: z.coerce.number().min(0).max(100).default(30),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.string().optional().default("true"),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default(""),
  MEETING_QUOTE_EMAIL_TO: z.string().optional().default("quote@luxipanel.com"),
  SUPPORT_TICKET_EMAIL_TO: z.string().optional().default("support@luxisoft.com"),

  REPORT_EMAIL_TO: z.string().optional().default("reports@luxisoft.com"),
  REPORT_CRON: z.string().optional().default("59 23 * * *"),
  REPORT_TIMEZONE: z.string().optional().default("America/Bogota"),
  REPORT_LOGO_URL: z
    .string()
    .optional()
    .default(
      "https://imagedelivery.net/juOGhpzwqbGB3xBvV9fTTQ/e0ebede4-9c85-419b-57f6-40d8fc898000/product"
    )
});

const raw = envSchema.parse(process.env);

export const env = {
  ...raw,
  corsOrigins: csvToArray(raw.CORS_ORIGIN),
  defaultProject: raw.WHATSAPP_DEFAULT_PROJECT.trim().toLowerCase() || "luxisoft",
  whatsappAgentEnabled: parseBooleanFlag(raw.WHATSAPP_AGENT_ENABLED, false),
  whatsappServicesEnabled: parseBooleanFlag(raw.WHATSAPP_SERVICES_ENABLED, false),
  linkOtpTtlSeconds: raw.LINK_OTP_TTL_SECONDS,
  linkOtpMaxAttempts: raw.LINK_OTP_MAX_ATTEMPTS,
  authSessionTtlSeconds: raw.AUTH_SESSION_TTL_SECONDS,
  lpApiBaseUrl: raw.LP_API_BASE_URL.trim().replace(/\/+$/, ""),
  lpS2sToken: raw.LP_S2S_TOKEN.trim(),
  lpS2sTimeoutMs: raw.LP_S2S_TIMEOUT_MS,
  luxipanelApiBaseUrl: raw.LUXIPANEL_API_BASE_URL.trim().replace(/\/+$/, ""),
  luxipanelSessionCookieName: raw.LUXIPANEL_SESSION_COOKIE_NAME.trim() || "luxipanel_session",
  luxipanelAssistantProvider: raw.LUXIPANEL_ASSISTANT_PROVIDER.trim().toLowerCase() || "claude",
  luxichatApiBaseUrl: raw.LUXICHAT_API_BASE_URL.trim().replace(/\/+$/, ""),
  luxichatS2sToken: raw.LUXICHAT_S2S_TOKEN.trim(),
  bridgeProjects: parseBridgeProjects(raw.BRIDGE_PROJECTS_JSON),
  bridgeStore: raw.BRIDGE_STORE.trim().toLowerCase() === "postgres" ? "postgres" : "memory",
  openaiApiKey: raw.OPENAI_API_KEY.trim(),
  openaiBaseUrl: raw.OPENAI_BASE_URL.trim(),
  openaiAudioTranscribeModel: raw.OPENAI_AUDIO_TRANSCRIBE_MODEL.trim() || "gpt-4o-mini-transcribe",

  aiChatProvider: raw.AI_CHAT_PROVIDER.trim().toLowerCase() || "openai",
  aiChatModel: raw.AI_CHAT_MODEL.trim(),
  aiTranscriptionProvider: raw.AI_TRANSCRIPTION_PROVIDER.trim().toLowerCase() || "openai",
  aiSpeechProvider: raw.AI_SPEECH_PROVIDER.trim().toLowerCase() || "openai",

  anthropicApiKey: raw.ANTHROPIC_API_KEY.trim(),
  anthropicBaseUrl: raw.ANTHROPIC_BASE_URL.trim(),
  anthropicChatModel: raw.ANTHROPIC_CHAT_MODEL.trim() || "claude-sonnet-4-6",

  geminiApiKey: raw.GEMINI_API_KEY.trim(),
  geminiBaseUrl: raw.GEMINI_BASE_URL.trim(),
  geminiChatModel: raw.GEMINI_CHAT_MODEL.trim() || "gemini-2.5-flash",
  geminiSpeechModel: raw.GEMINI_SPEECH_MODEL.trim() || "gemini-2.5-flash-preview-tts",
  geminiSpeechVoice: raw.GEMINI_SPEECH_VOICE.trim() || "Kore",

  deepseekApiKey: raw.DEEPSEEK_API_KEY.trim(),
  deepseekBaseUrl: raw.DEEPSEEK_BASE_URL.trim(),
  deepseekChatModel: raw.DEEPSEEK_CHAT_MODEL.trim() || "deepseek-chat",

  minimaxApiKey: raw.MINIMAX_API_KEY.trim(),
  minimaxBaseUrl: raw.MINIMAX_BASE_URL.trim(),
  minimaxChatModel: raw.MINIMAX_CHAT_MODEL.trim() || "MiniMax-Text-01",
  minimaxSpeechModel: raw.MINIMAX_SPEECH_MODEL.trim() || "speech-02-hd",
  minimaxSpeechVoice: raw.MINIMAX_SPEECH_VOICE.trim() || "female-shaonv",
  minimaxGroupId: raw.MINIMAX_GROUP_ID.trim(),

  grokApiKey: raw.GROK_API_KEY.trim(),
  grokBaseUrl: raw.GROK_BASE_URL.trim(),
  grokChatModel: raw.GROK_CHAT_MODEL.trim() || "grok-3",

  openaiChatModel: raw.OPENAI_CHAT_MODEL.trim() || "gpt-4o-mini",
  openaiSpeechModel: raw.OPENAI_SPEECH_MODEL.trim() || "gpt-4o-mini-tts",
  openaiSpeechVoice: raw.OPENAI_SPEECH_VOICE.trim() || "nova",
  openaiSpeechFormat: raw.OPENAI_SPEECH_FORMAT.trim().toLowerCase() || "opus",

  // Nombre (femenino) del asistente por proveedor de chat.
  assistantNames: {
    openai: raw.OPENAI_ASSISTANT_NAME.trim() || "Luisa",
    anthropic: raw.ANTHROPIC_ASSISTANT_NAME.trim() || "Valeria",
    gemini: raw.GEMINI_ASSISTANT_NAME.trim() || "Sofía",
    deepseek: raw.DEEPSEEK_ASSISTANT_NAME.trim() || "Camila",
    minimax: raw.MINIMAX_ASSISTANT_NAME.trim() || "Daniela",
    grok: raw.GROK_ASSISTANT_NAME.trim() || "Valentina"
  } as Record<string, string>,
  whatsappReplyContextProbability: raw.WHATSAPP_REPLY_CONTEXT_PROBABILITY,
  whatsappMarkAsReadProbability: raw.WHATSAPP_MARK_AS_READ_PROBABILITY,
  whatsappTypingIndicatorProbability: raw.WHATSAPP_TYPING_INDICATOR_PROBABILITY,
  whatsappReplyTextProbability: raw.WHATSAPP_REPLY_TEXT_PROBABILITY,
  whatsappReplyAudioProbability: raw.WHATSAPP_REPLY_AUDIO_PROBABILITY,
  whatsappReplyQuotedProbability: raw.WHATSAPP_REPLY_QUOTED_PROBABILITY,
  smtpHost: raw.SMTP_HOST.trim(),
  smtpPort: raw.SMTP_PORT,
  smtpSecure: parseBooleanFlag(raw.SMTP_SECURE, true),
  smtpUser: raw.SMTP_USER.trim(),
  smtpPass: raw.SMTP_PASS.trim(),
  smtpFrom: raw.SMTP_FROM.trim(),
  meetingQuoteEmailTo: raw.MEETING_QUOTE_EMAIL_TO.trim() || "quote@luxipanel.com",
  supportTicketEmailTo: raw.SUPPORT_TICKET_EMAIL_TO.trim() || "support@luxisoft.com",
  reportEmailTo: raw.REPORT_EMAIL_TO.trim() || "reports@luxisoft.com",
  reportCron: raw.REPORT_CRON.trim() || "59 23 * * *",
  reportTimezone: raw.REPORT_TIMEZONE.trim() || "America/Bogota",
  reportLogoUrl:
    raw.REPORT_LOGO_URL.trim() ||
    "https://imagedelivery.net/juOGhpzwqbGB3xBvV9fTTQ/e0ebede4-9c85-419b-57f6-40d8fc898000/product"
};

/**
 * Secretos/valores que pueden faltar en desarrollo (todos tienen default ""),
 * pero cuya ausencia en producción es un error de configuración silencioso y
 * peligroso. Llamar en el arranque para fallar rápido (`fail fast`).
 */
const REQUIRED_IN_PRODUCTION: ReadonlyArray<readonly [string, string]> = [
  ["WHATSAPP_ACCESS_TOKEN", env.WHATSAPP_ACCESS_TOKEN],
  ["WHATSAPP_PHONE_NUMBER_ID", env.WHATSAPP_PHONE_NUMBER_ID],
  ["WHATSAPP_WEBHOOK_VERIFY_TOKEN", env.WHATSAPP_WEBHOOK_VERIFY_TOKEN],
  ["WHATSAPP_APP_SECRET", env.WHATSAPP_APP_SECRET]
];

export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = REQUIRED_IN_PRODUCTION.filter(([, value]) => !String(value).trim()).map(
    ([key]) => key
  );
  if (missing.length) {
    throw new Error(`missing_required_env_in_production: ${missing.join(", ")}`);
  }
}
