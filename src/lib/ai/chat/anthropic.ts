import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatProvider,
  type ChatToolCall,
  type ChatToolDefinition
} from "../types.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Adaptador nativo de la API de mensajes de Anthropic (Claude).
 * Difiere del formato OpenAI: el `system` va aparte, los resultados de tools
 * se envían como bloques `tool_result` dentro de un mensaje de usuario.
 */
export class AnthropicChatProvider implements ChatProvider {
  readonly name = "anthropic" as const;

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const creds = getProviderCredentials("anthropic");
    if (!creds.apiKey) {
      throw new AiProviderError("anthropic", "anthropic_not_configured");
    }

    const model = request.model || creds.defaultChatModel;
    const systemPrompt = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: request.messages.filter((m) => m.role !== "system").map(toAnthropicMessage)
    };
    if (systemPrompt) body.system = systemPrompt;
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (request.tools?.length) body.tools = request.tools.map(toAnthropicTool);

    const response = await fetch(`${creds.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": creds.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new AiProviderError("anthropic", "anthropic_chat_failed", {
        statusCode: response.status,
        details: rawText
      });
    }

    let parsed: any;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new AiProviderError("anthropic", "anthropic_chat_invalid_json", { details: rawText });
    }

    const blocks: any[] = Array.isArray(parsed?.content) ? parsed.content : [];
    const text = blocks
      .filter((b) => b?.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("")
      .trim();
    const toolCalls: ChatToolCall[] = blocks
      .filter((b) => b?.type === "tool_use")
      .map((b) => ({
        id: String(b?.id ?? ""),
        name: String(b?.name ?? ""),
        arguments: JSON.stringify(b?.input ?? {})
      }));

    return {
      text,
      toolCalls,
      model: String(parsed?.model ?? model),
      provider: "anthropic",
      raw: parsed
    };
  }
}

function toAnthropicMessage(message: ChatMessage) {
  if (message.role === "tool") {
    return {
      role: "user" as const,
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: message.toolCallId ?? "",
          content: message.content
        }
      ]
    };
  }
  return {
    role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: message.content
  };
}

function toAnthropicTool(tool: ChatToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  };
}
