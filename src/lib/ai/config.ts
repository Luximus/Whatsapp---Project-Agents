import { env } from "../../env.js";
import type { AiProviderName } from "./types.js";

export interface ProviderCredentials {
  apiKey: string;
  /** URL base sin barra final. Cada proveedor tiene un default sensato. */
  baseUrl: string;
  defaultChatModel: string;
}

const DEFAULT_BASE_URLS: Record<AiProviderName, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  minimax: "https://api.minimaxi.chat/v1",
  grok: "https://api.x.ai/v1"
};

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** Devuelve credenciales + URL base resueltas para un proveedor. */
export function getProviderCredentials(provider: AiProviderName): ProviderCredentials {
  switch (provider) {
    case "openai":
      return {
        apiKey: env.openaiApiKey,
        baseUrl: stripTrailingSlash(env.openaiBaseUrl || DEFAULT_BASE_URLS.openai),
        defaultChatModel: env.openaiChatModel
      };
    case "anthropic":
      return {
        apiKey: env.anthropicApiKey,
        baseUrl: stripTrailingSlash(env.anthropicBaseUrl || DEFAULT_BASE_URLS.anthropic),
        defaultChatModel: env.anthropicChatModel
      };
    case "gemini":
      return {
        apiKey: env.geminiApiKey,
        baseUrl: stripTrailingSlash(env.geminiBaseUrl || DEFAULT_BASE_URLS.gemini),
        defaultChatModel: env.geminiChatModel
      };
    case "deepseek":
      return {
        apiKey: env.deepseekApiKey,
        baseUrl: stripTrailingSlash(env.deepseekBaseUrl || DEFAULT_BASE_URLS.deepseek),
        defaultChatModel: env.deepseekChatModel
      };
    case "minimax":
      return {
        apiKey: env.minimaxApiKey,
        baseUrl: stripTrailingSlash(env.minimaxBaseUrl || DEFAULT_BASE_URLS.minimax),
        defaultChatModel: env.minimaxChatModel
      };
    case "grok":
      return {
        apiKey: env.grokApiKey,
        baseUrl: stripTrailingSlash(env.grokBaseUrl || DEFAULT_BASE_URLS.grok),
        defaultChatModel: env.grokChatModel
      };
  }
}

export { DEFAULT_BASE_URLS };
