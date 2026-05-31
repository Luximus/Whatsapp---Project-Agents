import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(here, "..", ".env")
];
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
  const normalized = String(value ?? "").trim().toLowerCase();
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

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_BASE_URL: z.string().optional().default(""),
  ANTHROPIC_CHAT_MODEL: z.string().optional().default("claude-sonnet-4-6"),

  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_BASE_URL: z.string().optional().default(""),
  GEMINI_CHAT_MODEL: z.string().optional().default("gemini-2.5-flash"),

  DEEPSEEK_API_KEY: z.string().optional().default(""),
  DEEPSEEK_BASE_URL: z.string().optional().default(""),
  DEEPSEEK_CHAT_MODEL: z.string().optional().default("deepseek-chat"),

  MINIMAX_API_KEY: z.string().optional().default(""),
  MINIMAX_BASE_URL: z.string().optional().default(""),
  MINIMAX_CHAT_MODEL: z.string().optional().default("MiniMax-Text-01"),

  GROK_API_KEY: z.string().optional().default(""),
  GROK_BASE_URL: z.string().optional().default(""),
  GROK_CHAT_MODEL: z.string().optional().default("grok-3"),

  OPENAI_CHAT_MODEL: z.string().optional().default("gpt-4o-mini"),

  WHATSAPP_REPLY_CONTEXT_PROBABILITY: z.coerce.number().min(0).max(100).default(35),
  WHATSAPP_MARK_AS_READ_PROBABILITY: z.coerce.number().min(0).max(100).default(100),
  WHATSAPP_TYPING_INDICATOR_PROBABILITY: z.coerce.number().min(0).max(100).default(100),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.string().optional().default("true"),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default(""),
  MEETING_QUOTE_EMAIL_TO: z.string().optional().default("quote@luxisoft.com"),
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
  bridgeProjects: parseBridgeProjects(raw.BRIDGE_PROJECTS_JSON),
  bridgeStore: raw.BRIDGE_STORE.trim().toLowerCase() === "postgres" ? "postgres" : "memory",
  openaiApiKey: raw.OPENAI_API_KEY.trim(),
  openaiBaseUrl: raw.OPENAI_BASE_URL.trim(),
  openaiAudioTranscribeModel: raw.OPENAI_AUDIO_TRANSCRIBE_MODEL.trim() || "gpt-4o-mini-transcribe",

  aiChatProvider: raw.AI_CHAT_PROVIDER.trim().toLowerCase() || "openai",
  aiChatModel: raw.AI_CHAT_MODEL.trim(),
  aiTranscriptionProvider: raw.AI_TRANSCRIPTION_PROVIDER.trim().toLowerCase() || "openai",

  anthropicApiKey: raw.ANTHROPIC_API_KEY.trim(),
  anthropicBaseUrl: raw.ANTHROPIC_BASE_URL.trim(),
  anthropicChatModel: raw.ANTHROPIC_CHAT_MODEL.trim() || "claude-sonnet-4-6",

  geminiApiKey: raw.GEMINI_API_KEY.trim(),
  geminiBaseUrl: raw.GEMINI_BASE_URL.trim(),
  geminiChatModel: raw.GEMINI_CHAT_MODEL.trim() || "gemini-2.5-flash",

  deepseekApiKey: raw.DEEPSEEK_API_KEY.trim(),
  deepseekBaseUrl: raw.DEEPSEEK_BASE_URL.trim(),
  deepseekChatModel: raw.DEEPSEEK_CHAT_MODEL.trim() || "deepseek-chat",

  minimaxApiKey: raw.MINIMAX_API_KEY.trim(),
  minimaxBaseUrl: raw.MINIMAX_BASE_URL.trim(),
  minimaxChatModel: raw.MINIMAX_CHAT_MODEL.trim() || "MiniMax-Text-01",

  grokApiKey: raw.GROK_API_KEY.trim(),
  grokBaseUrl: raw.GROK_BASE_URL.trim(),
  grokChatModel: raw.GROK_CHAT_MODEL.trim() || "grok-3",

  openaiChatModel: raw.OPENAI_CHAT_MODEL.trim() || "gpt-4o-mini",
  whatsappReplyContextProbability: raw.WHATSAPP_REPLY_CONTEXT_PROBABILITY,
  whatsappMarkAsReadProbability: raw.WHATSAPP_MARK_AS_READ_PROBABILITY,
  whatsappTypingIndicatorProbability: raw.WHATSAPP_TYPING_INDICATOR_PROBABILITY,
  smtpHost: raw.SMTP_HOST.trim(),
  smtpPort: raw.SMTP_PORT,
  smtpSecure: parseBooleanFlag(raw.SMTP_SECURE, true),
  smtpUser: raw.SMTP_USER.trim(),
  smtpPass: raw.SMTP_PASS.trim(),
  smtpFrom: raw.SMTP_FROM.trim(),
  meetingQuoteEmailTo: raw.MEETING_QUOTE_EMAIL_TO.trim() || "quote@luxisoft.com",
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
