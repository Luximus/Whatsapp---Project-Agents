/**
 * Contratos agnósticos de proveedor para la capa de IA.
 *
 * Toda la lógica de negocio (transcripción, asistente, agentes) debe depender
 * SOLO de estas interfaces, nunca de un SDK concreto. Así cambiar de OpenAI a
 * Anthropic/Gemini/etc. es elegir otro adaptador, sin tocar el negocio.
 */

export const AI_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "minimax",
  "grok"
] as const;

export type AiProviderName = (typeof AI_PROVIDERS)[number];

export function isAiProviderName(value: string): value is AiProviderName {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Identificador de la tool invocada, requerido cuando role === "tool". */
  toolCallId?: string;
  /** Nombre de la tool, útil para algunos proveedores. */
  name?: string;
  /**
   * Tool calls emitidas por el asistente en este turno. Deben reenviarse al
   * proveedor junto al mensaje "assistant" para que los mensajes "tool"
   * posteriores tengan a qué llamada responder (OpenAI, Anthropic y Gemini lo
   * exigen).
   */
  toolCalls?: ChatToolCall[];
}

export interface ChatToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema de los parámetros (draft-07 compatible). */
  parameters: Record<string, unknown>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  /** Argumentos crudos en JSON tal como los devuelve el modelo. */
  arguments: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  /** Si se omite, el adaptador usa el modelo por defecto del proveedor. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ChatToolDefinition[];
}

export interface ChatCompletionResult {
  text: string;
  toolCalls: ChatToolCall[];
  model: string;
  provider: AiProviderName;
  /** Respuesta cruda del proveedor, por si el negocio necesita metadatos. */
  raw?: unknown;
}

export interface ChatProvider {
  readonly name: AiProviderName;
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export interface TranscriptionRequest {
  data: Buffer;
  mimeType?: string | null;
  filename?: string | null;
  model?: string;
}

export interface TranscriptionProvider {
  readonly name: AiProviderName;
  transcribe(request: TranscriptionRequest): Promise<string>;
}

export interface SpeechSynthesisRequest {
  /** Texto a sintetizar en voz. */
  text: string;
  /** Voz/locutor del proveedor (p.ej. "alloy" en OpenAI, "Kore" en Gemini). */
  voice?: string;
  /** Modelo TTS; si se omite, el adaptador usa el de su env. */
  model?: string;
  /**
   * Formato de salida deseado. "opus" => audio/ogg, el único contenedor que
   * WhatsApp acepta como NOTA DE VOZ real (`voice: true`). El resto se envía
   * como audio normal reproducible.
   */
  format?: string;
}

export interface SpeechSynthesisResult {
  /** Bytes del audio sintetizado. */
  data: Buffer;
  /** MIME del audio (p.ej. "audio/ogg", "audio/mpeg", "audio/wav"). */
  mimeType: string;
  /** Extensión sugerida para el archivo, sin punto (p.ej. "ogg", "mp3"). */
  extension: string;
}

export interface SpeechProvider {
  readonly name: AiProviderName;
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}

/** Error normalizado de cualquier proveedor de IA. */
export class AiProviderError extends Error {
  readonly provider: AiProviderName;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(
    provider: AiProviderName,
    message: string,
    options?: { statusCode?: number; details?: unknown }
  ) {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.statusCode = options?.statusCode;
    this.details = options?.details;
  }
}
