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

function parseAgentProjectSources(value: string) {
  const raw = value.trim();
  if (!raw) return {} as Record<string, string[]>;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_agent_project_sources_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_agent_project_sources_json");
  }

  const output: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    const projectKey = key.trim().toLowerCase();
    if (!projectKey) continue;

    const sources: string[] = [];
    if (typeof item === "string") {
      const value = item.trim();
      if (value) sources.push(value);
    } else if (Array.isArray(item)) {
      for (const source of item) {
        if (typeof source !== "string") continue;
        const normalized = source.trim();
        if (!normalized) continue;
        sources.push(normalized);
      }
    }

    if (sources.length > 0) {
      output[projectKey] = Array.from(new Set(sources));
    }
  }

  return output;
}

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

  WHATSAPP_DEFAULT_PROJECT: z.string().optional().default("luxichat"),
  AGENTS_DIR: z.string().optional().default("./agents"),
  ORCHESTRATOR_AGENT_DIR: z.string().optional().default("./agents/luxisoft"),
  AGENT_PROJECT_SOURCES_JSON: z.string().optional().default("{}"),
  AGENT_HUMAN_TRANSFER_NUMBER_E164: z.string().optional().default(""),

  BRIDGE_PROJECTS_JSON: z.string().optional().default("{}"),
  BRIDGE_OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  BRIDGE_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  BRIDGE_CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(7000),
  BRIDGE_EVENT_MAX_RETRIES: z.coerce.number().int().min(1).default(6),
  BRIDGE_EVENT_RETRY_BASE_SECONDS: z.coerce.number().int().min(5).default(20),
  BRIDGE_EVENT_DISPATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(50),
  BRIDGE_DISPATCH_TOKEN: z.string().optional().default(""),

  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().optional().default(""),
  OPENAI_ORCHESTRATOR_MODEL: z.string().optional().default("gpt-5.4-mini"),
  OPENAI_PROJECT_MODEL: z.string().optional().default("gpt-5.4-mini"),
  OPENAI_AGENT_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  OPENAI_AUDIO_TRANSCRIBE_MODEL: z.string().optional().default("gpt-4o-mini-transcribe"),

  ELEVENLABS_API_KEY: z.string().optional().default(""),
  ELEVENLABS_BASE_URL: z.string().optional().default("https://api.elevenlabs.io"),
  ELEVENLABS_VOICE_ID: z.string().optional().default(""),
  ELEVENLABS_MODEL_ID: z.string().optional().default("eleven_multilingual_v2"),
  ELEVENLABS_OUTPUT_FORMAT: z.string().optional().default("mp3_44100_128"),
  WHATSAPP_AUDIO_REPLY_ENABLED: z.string().optional().default("false"),
  WHATSAPP_AUDIO_REPLY_INCLUDE_TEXT: z.string().optional().default("true")
});

const raw = envSchema.parse(process.env);

export const env = {
  ...raw,
  corsOrigins: csvToArray(raw.CORS_ORIGIN),
  defaultProject: raw.WHATSAPP_DEFAULT_PROJECT.trim().toLowerCase() || "luxichat",
  bridgeProjects: parseBridgeProjects(raw.BRIDGE_PROJECTS_JSON),
  agentProjectSources: parseAgentProjectSources(raw.AGENT_PROJECT_SOURCES_JSON),
  humanTransferNumber: raw.AGENT_HUMAN_TRANSFER_NUMBER_E164.trim(),
  openaiApiKey: raw.OPENAI_API_KEY.trim(),
  openaiBaseUrl: raw.OPENAI_BASE_URL.trim(),
  openaiOrchestratorModel: raw.OPENAI_ORCHESTRATOR_MODEL.trim() || "gpt-5.4-mini",
  openaiProjectModel: raw.OPENAI_PROJECT_MODEL.trim() || "gpt-5.4-mini",
  openaiAgentMaxToolSteps: raw.OPENAI_AGENT_MAX_TOOL_STEPS,
  openaiAudioTranscribeModel: raw.OPENAI_AUDIO_TRANSCRIBE_MODEL.trim() || "gpt-4o-mini-transcribe",
  elevenlabsApiKey: raw.ELEVENLABS_API_KEY.trim(),
  elevenlabsBaseUrl: raw.ELEVENLABS_BASE_URL.trim() || "https://api.elevenlabs.io",
  elevenlabsVoiceId: raw.ELEVENLABS_VOICE_ID.trim(),
  elevenlabsModelId: raw.ELEVENLABS_MODEL_ID.trim() || "eleven_multilingual_v2",
  elevenlabsOutputFormat: raw.ELEVENLABS_OUTPUT_FORMAT.trim() || "mp3_44100_128",
  whatsappAudioReplyEnabled: parseBooleanFlag(raw.WHATSAPP_AUDIO_REPLY_ENABLED, false),
  whatsappAudioReplyIncludeText: parseBooleanFlag(raw.WHATSAPP_AUDIO_REPLY_INCLUDE_TEXT, true)
};
