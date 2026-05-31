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
