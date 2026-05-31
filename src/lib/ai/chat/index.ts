import { env } from "../../../env.js";
import { isAiProviderName, type AiProviderName, type ChatProvider } from "../types.js";
import { OpenAiCompatibleChatProvider } from "./openaiCompatible.js";
import { AnthropicChatProvider } from "./anthropic.js";
import { GeminiChatProvider } from "./gemini.js";

const OPENAI_COMPATIBLE: ReadonlySet<AiProviderName> = new Set([
  "openai",
  "deepseek",
  "minimax",
  "grok"
]);

const cache = new Map<AiProviderName, ChatProvider>();

/** Crea (o reusa) el proveedor de chat indicado. */
export function createChatProvider(provider: AiProviderName): ChatProvider {
  const cached = cache.get(provider);
  if (cached) return cached;

  let instance: ChatProvider;
  if (provider === "anthropic") {
    instance = new AnthropicChatProvider();
  } else if (provider === "gemini") {
    instance = new GeminiChatProvider();
  } else if (OPENAI_COMPATIBLE.has(provider)) {
    instance = new OpenAiCompatibleChatProvider(provider);
  } else {
    throw new Error(`unsupported_chat_provider:${provider}`);
  }

  cache.set(provider, instance);
  return instance;
}

/** Proveedor de chat por defecto según `AI_CHAT_PROVIDER`. */
export function getDefaultChatProvider(): ChatProvider {
  const name = env.aiChatProvider;
  if (!isAiProviderName(name)) {
    throw new Error(`invalid_ai_chat_provider:${name}`);
  }
  return createChatProvider(name);
}
