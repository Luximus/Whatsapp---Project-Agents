import { Runner } from "@openai/agents";
import { OpenAIProvider } from "@openai/agents";
import { env } from "../../config/env.js";

let _runner: Runner | null | undefined;

function resolveOpenAIBaseUrl() {
  const base = env.openaiBaseUrl.trim() || "https://api.openai.com/v1";
  return base.replace(/\/+$/, "");
}

/**
 * Returns the singleton OpenAI Runner, creating it on first call.
 * Returns null if no API key is configured.
 */
export function getProjectAgentRunner(): Runner | null {
  if (typeof _runner !== "undefined") {
    return _runner;
  }

  if (!env.openaiApiKey) {
    _runner = null;
    return _runner;
  }

  _runner = new Runner({
    modelProvider: new OpenAIProvider({
      apiKey: env.openaiApiKey,
      ...(env.openaiBaseUrl ? { baseURL: resolveOpenAIBaseUrl() } : {}),
      useResponses: true
    }),
    tracingDisabled: true,
    traceIncludeSensitiveData: false
  });

  return _runner;
}
