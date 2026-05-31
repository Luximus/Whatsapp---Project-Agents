import { env } from "../../../env.js";
import { getProviderCredentials } from "../config.js";
import {
  isAiProviderName,
  type AiProviderName,
  type SpeechProvider,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult
} from "../types.js";
import { OpenAiCompatibleSpeechProvider } from "./openaiCompatible.js";
import { GeminiSpeechProvider } from "./gemini.js";
import { MiniMaxSpeechProvider } from "./minimax.js";

// Proveedores con TTS compatible con el endpoint `/audio/speech` de OpenAI.
const OPENAI_COMPATIBLE: ReadonlySet<AiProviderName> = new Set(["openai", "deepseek", "grok"]);

const cache = new Map<AiProviderName, SpeechProvider>();

/** Crea (o reusa) el proveedor de síntesis de voz indicado. */
export function createSpeechProvider(provider: AiProviderName): SpeechProvider {
  const cached = cache.get(provider);
  if (cached) return cached;

  let instance: SpeechProvider;
  if (provider === "gemini") {
    instance = new GeminiSpeechProvider();
  } else if (provider === "minimax") {
    instance = new MiniMaxSpeechProvider();
  } else if (OPENAI_COMPATIBLE.has(provider)) {
    instance = new OpenAiCompatibleSpeechProvider(provider);
  } else {
    throw new Error(`unsupported_speech_provider:${provider}`);
  }

  cache.set(provider, instance);
  return instance;
}

/** Proveedor de síntesis de voz por defecto según `AI_SPEECH_PROVIDER`. */
export function getDefaultSpeechProvider(): SpeechProvider {
  const name = env.aiSpeechProvider;
  if (!isAiProviderName(name)) {
    throw new Error(`invalid_ai_speech_provider:${name}`);
  }
  return createSpeechProvider(name);
}

/**
 * ¿Está el proveedor por defecto configurado (tiene API key)? Permite a la capa
 * de rutas decidir si intentar voz sin disparar una excepción evitable.
 */
export function isSpeechConfigured(): boolean {
  const name = env.aiSpeechProvider;
  if (!isAiProviderName(name)) return false;
  const creds = getProviderCredentials(name);
  if (!creds.apiKey) return false;
  // MiniMax exige además GroupId para t2a.
  if (name === "minimax" && !env.minimaxGroupId) return false;
  return true;
}

/** Atajo de negocio: sintetiza voz con el proveedor por defecto. */
export function synthesizeSpeech(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
  return getDefaultSpeechProvider().synthesize(request);
}
