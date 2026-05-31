import { env } from "../../../env.js";
import {
  isAiProviderName,
  type AiProviderName,
  type TranscriptionProvider,
  type TranscriptionRequest
} from "../types.js";
import { OpenAiCompatibleTranscriptionProvider } from "./openaiCompatible.js";

// Proveedores con endpoint de transcripción compatible con OpenAI/Whisper.
const SUPPORTED: ReadonlySet<AiProviderName> = new Set(["openai", "deepseek", "grok"]);

const cache = new Map<AiProviderName, TranscriptionProvider>();

export function createTranscriptionProvider(provider: AiProviderName): TranscriptionProvider {
  const cached = cache.get(provider);
  if (cached) return cached;
  if (!SUPPORTED.has(provider)) {
    throw new Error(`unsupported_transcription_provider:${provider}`);
  }
  const instance = new OpenAiCompatibleTranscriptionProvider(provider);
  cache.set(provider, instance);
  return instance;
}

export function getDefaultTranscriptionProvider(): TranscriptionProvider {
  const name = env.aiTranscriptionProvider;
  if (!isAiProviderName(name)) {
    throw new Error(`invalid_ai_transcription_provider:${name}`);
  }
  return createTranscriptionProvider(name);
}

/** Atajo de negocio: transcribe con el proveedor por defecto. */
export function transcribeAudio(request: TranscriptionRequest): Promise<string> {
  return getDefaultTranscriptionProvider().transcribe(request);
}
