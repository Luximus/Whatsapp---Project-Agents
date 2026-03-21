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

function parseProjectDatabases(value: string) {
  const raw = value.trim();
  if (!raw) return {} as Record<string, string>;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_project_databases_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_project_databases_json");
  }

  const output: Record<string, string> = {};
  for (const [key, dbUrl] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof dbUrl !== "string") continue;
    const normalizedKey = key.trim().toLowerCase();
    const normalizedUrl = dbUrl.trim();
    if (!normalizedKey || !normalizedUrl) continue;
    output[normalizedKey] = normalizedUrl;
  }
  return output;
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

  WHATSAPP_DEFAULT_PROJECT: z.string().optional().default("luxichat"),
  PROJECT_DATABASES_JSON: z.string().optional().default("{}"),
  AGENTS_DIR: z.string().optional().default("./agents"),
  ORCHESTRATOR_AGENT_DIR: z.string().optional().default("./agents/luxisoft"),

  BRIDGE_PROJECTS_JSON: z.string().optional().default("{}"),
  BRIDGE_OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  BRIDGE_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  BRIDGE_CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(7000),
  BRIDGE_EVENT_MAX_RETRIES: z.coerce.number().int().min(1).default(6),
  BRIDGE_EVENT_RETRY_BASE_SECONDS: z.coerce.number().int().min(5).default(20),
  BRIDGE_EVENT_DISPATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(50),
  BRIDGE_DISPATCH_TOKEN: z.string().optional().default("")
});

const raw = envSchema.parse(process.env);

export const env = {
  ...raw,
  corsOrigins: csvToArray(raw.CORS_ORIGIN),
  defaultProject: raw.WHATSAPP_DEFAULT_PROJECT.trim().toLowerCase() || "luxichat",
  projectDatabases: parseProjectDatabases(raw.PROJECT_DATABASES_JSON),
  bridgeProjects: parseBridgeProjects(raw.BRIDGE_PROJECTS_JSON)
};
